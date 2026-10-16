// WP07: /api/ask — 带真实段落引用的 AI 问答
// 管线: 段落关键词检索 → 真实模型 → 结构化回答 → 引用ID 100% 校验 (虚构即拦截重试/剔除)
// 语料: data/sample-topic.json (随函数打包为静态资源, 由 fetch 相对路径读取 — Vercel 上从站点根)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { jsonError, getClientIp, sessionOf, loadProviderConfig, Budget, logCall } from './_lib.js';
import { loadCorpus, askPipeline } from './_ask.js';

export const config = { runtime: 'nodejs' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 开发: repo_stage/site/data/sample-topic.json; 生产: 站点根 data/
const CANDIDATES = [
  path.join(__dirname, '..', 'site', 'data', 'sample-topic.json'),
  path.join(__dirname, '..', 'data', 'sample-topic.json'),
  '/var/task/data/sample-topic.json',
];

let CORPUS = null, ARTICLE_META = null, CORPUS_VERSION = null;
function corpus() {
  if (CORPUS) return CORPUS;
  for (const p of CANDIDATES) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      CORPUS = loadCorpus(raw);
      // 语料版本: 对参与检索的全部文章 (title+段落 id+段落内容, 按稳定顺序) 做确定性 hash
      // — 修改任一篇内容/段落/ID 都会改变 hash; 相同内容重复构建不变 (验收标准)
      CORPUS_VERSION = buildCorpusVersion(raw);
      ARTICLE_META = {};
      for (const [aid, a] of Object.entries(raw.articles)) {
        ARTICLE_META[aid] = { title: a.title, date: a.date?.raw ?? '' };
      }
      console.log(JSON.stringify({ t: 'corpus_loaded', path: p, paras: CORPUS.length, version: CORPUS_VERSION }));
      return CORPUS;
    } catch { /* try next */ }
  }
  throw new Error('sample-topic.json not found');
}
function buildCorpusVersion(raw) {
  const hash = crypto.createHash('sha256');
  const aids = Object.keys(raw.articles ?? {}).sort();
  for (const aid of aids) {
    const a = raw.articles[aid];
    hash.update(aid).update('\u0000');
    hash.update(String(a.title ?? '')).update('\u0000');
    // 段落按 seq 稳定顺序 (id 含 seq, 直接 sort 亦稳定)
    const paras = [...(a.paragraphs ?? [])].sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0));
    for (const para of paras) {
      hash.update(String(para.id ?? '')).update('\u0000');
      hash.update(String(para.text ?? '')).update('\u0000');
    }
    hash.update('\u0001'); // 文章分隔符
  }
  return 'corpus-' + hash.digest('hex').slice(0, 20) + ':articles=' + aids.length + ':paras=' + CORPUS.length;
}

const RL_MAX = parseInt(process.env.ASK_RL_MAX_PER_MIN ?? '5', 10);
const rlBuckets = new Map();
function rateLimited(key) {
  const now = Date.now(), W = 60_000;
  let b = rlBuckets.get(key);
  if (!b || now - b.windowStart >= W) b = { windowStart: now, count: 0 };
  b.count += 1;
  rlBuckets.set(key, b);   // P0 修复: 此前创建/更新桶后未 set 回 Map → 计数永远丢失, 限流失效
  if (rlBuckets.size > 10_000) for (const [k, v] of rlBuckets) if (now - v.windowStart >= W) rlBuckets.delete(k);
  return b.count > RL_MAX;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return jsonError(res, 405, 'method_not_allowed', 'Use POST');
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN ?? 'https://aibigplayer.top');
  res.setHeader('Vary', 'Origin');

  const budget = Budget.load();
  if (!budget.configured) return jsonError(res, 503, 'budget_not_configured', 'AI 问答未配置预算, 已阻断。阅读与剧场不受影响。');
  if (budget.exhausted()) return jsonError(res, 402, 'budget_exhausted', 'AI 问答预算已耗尽, 已阻断。阅读与剧场不受影响。');

  let body;
  try { body = req.body ?? JSON.parse(req); } catch { return jsonError(res, 400, 'bad_json', 'body must be JSON'); }
  const q = (body?.question ?? '').toString().trim();
  if (!q) return jsonError(res, 400, 'empty_question', 'question is required');
  if (q.length > 300) return jsonError(res, 400, 'question_too_long', 'question max 300 chars');
  // 研究范围 (WP08 联动): articleIds 数组, 限制检索语料范围; 段落/场景级范围由前端转成 articleIds+可选 scopeNote
  const scope = Array.isArray(body?.scope?.articleIds)
    ? body.scope.articleIds.filter(x => /^[v]\d+n\d+$/.test(x)).slice(0, 5)
    : [];

  const ip = getClientIp(req);
  const { sid } = sessionOf(req, res);
  if (rateLimited(sid + '|' + ip)) {
    res.setHeader('Retry-After', '60');
    return jsonError(res, 429, 'rate_limited', '提问过于频繁, 请稍后再试。');
  }

  let provider, c;
  try { provider = loadProviderConfig(); } catch (e) {
    return jsonError(res, 503, 'provider_not_configured', e.message);
  }
  try { c = corpus(); } catch {
    return jsonError(res, 500, 'corpus_missing', '语料数据包未部署');
  }

  try {
    const out = await askPipeline(q, {
      provider, corpus: (scope.length ? c.filter(p => scope.includes(p.articleId)) : c),
      timeoutMs: provider.timeoutMs, maxRetries: 1,
      budget,   // 预占: 每次模型调用前 reserve, 耗尽抛 402 (P0-r4)
    }, e => console.log(JSON.stringify({ t: 'ask_' + e.t, ...e })));

    // 额度已由 askPipeline 在每次调用前预占 (reserve), 此处不再重复记账
    const calls = (out.attemptsLog ?? []).length || (out.attempts ?? 1);
    logCall({ ts: Date.now(), sid, qLen: q.length, qHead: q.slice(0, 24), model: out.model,
      calls, status: out.status, attempts: out.attempts ?? 1, nCitations: out.citations.length,
      fabricatedIntercepted: (out.fabricatedIntercepted ?? []).length + (out.badQuotesIntercepted ?? []).length,
      scope: scope.join(',') || null });

    return res.status(200).json({
      schemaVersion: '0.3', ok: true, model: out.model, promptVersion: out.promptVersion,
      corpusVersion: CORPUS_VERSION, status: out.status,
      answer: out.answer,
      citations: out.citations.map(c2 => ({
        id: c2.id, quote: c2.quote,
        articleId: c2.id.replace(/^p(v\d+n\d+)-.*$/, '$1'),
        articleTitle: ARTICLE_META?.[c2.id.replace(/^p(v\d+n\d+)-.*$/, '$1')]?.title ?? null,
      })),
      evidenceIds: out.evidenceIds, hitIds: out.hitIds ?? [], ms: out.ms,
      attempts: out.attempts ?? 1,
      usage: { calls, budgetUnit: 'upstream_calls', budgetLeft: budget.left() },
    });
  } catch (e) {
    if (e.code === 'BUDGET_EXHAUSTED') return jsonError(res, 402, 'budget_exhausted', 'AI 问答预算已耗尽, 已阻断。');
    if (e.status === 402) { budget.markExhausted(); return jsonError(res, 402, 'upstream_insufficient', '上游余额不足, 已熔断。'); }
    if (e.code === 'TIMEOUT') return jsonError(res, 504, 'upstream_timeout', '模型调用超时, 本次提问已阻断。');
    if (e.status === 429) { res.setHeader('Retry-After', '30'); return jsonError(res, 429, 'upstream_rate_limited', '上游限流, 请稍后再试。'); }
    if (e.code === 'citation_invalid') return jsonError(res, 502, 'citation_validation_failed', '模型输出未通过引用校验, 已拦截。');
    return jsonError(res, 502, 'upstream_error', String(e.message ?? e).slice(0, 160));
  }
}
