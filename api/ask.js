// P05: /api/ask — 带真实段落引用的 AI 问答 (范围契约 + 跨实例限流 + 台账 + 版本追踪)
// 管线: 范围契约校验 → 段落关键词检索 → 真实模型 → 结构化回答 → 引用ID/引文逐字校验
// 语料: data/sample-topic.json (v1n03+v1n04, 879 段)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { jsonError, getClientIp, sessionOf, loadProviderConfig, Budget, logCall } from './_lib.js';
import { loadCorpus, askPipeline, PROMPT_VERSION, PIPELINE_VERSION } from './_ask.js';
import { resolveScope, scopeParagraphs, ScopeError, rateLimit, recordUsage, newRequestId, kvConfigured, makeCnyBudget, costOfUsage } from './_govern.js';

export const config = { runtime: 'nodejs' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  path.join(__dirname, '..', 'site', 'data', 'sample-topic.json'),
  path.join(__dirname, '..', 'data', 'sample-topic.json'),
  '/var/task/data/sample-topic.json',
];
const TOPIC_CANDIDATES = [
  path.join(__dirname, '..', 'site', 'data', 'topic-jgs.json'),
  path.join(__dirname, '..', 'data', 'topic-jgs.json'),
  '/var/task/data/topic-jgs.json',
];

let CORPUS = null, ARTICLE_META = null, CORPUS_VERSION = null, TOPICS = {};
function corpus() {
  if (CORPUS) return CORPUS;
  for (const p of CANDIDATES) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      CORPUS = loadCorpus(raw);
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
function topics() {
  if (Object.keys(TOPICS).length) return TOPICS;
  for (const p of TOPIC_CANDIDATES) {
    try {
      const t = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (t && t.topicId) TOPICS[t.topicId] = { articles: (t.corpus?.articles ?? []), title: t.title ?? '' };
    } catch { /* try next */ }
  }
  return TOPICS;
}
function buildCorpusVersion(raw) {
  const hash = crypto.createHash('sha256');
  const aids = Object.keys(raw.articles ?? {}).sort();
  for (const aid of aids) {
    const a = raw.articles[aid];
    hash.update(aid).update('\u0000');
    hash.update(String(a.title ?? '')).update('\u0000');
    const paras = [...(a.paragraphs ?? [])].sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0));
    for (const para of paras) {
      hash.update(String(para.id ?? '')).update('\u0000');
      hash.update(String(para.text ?? '')).update('\u0000');
    }
    hash.update('\u0001');
  }
  return 'corpus-' + hash.digest('hex').slice(0, 20) + ':articles=' + aids.length + ':paras=' + CORPUS.length;
}

const RL_MAX = parseInt(process.env.ASK_RL_MAX_PER_MIN ?? '5', 10);

export default async function handler(req, res) {
  const requestId = newRequestId();
  const startedAt = Date.now();
  const fail = (status, code, message, extra) => {
    res.setHeader('X-Request-Id', requestId);
    recordUsage({ requestId, attemptId: 'final', status: 'error', code, calls: 0, costKnown: false, scope: null });
    return jsonError(res, status, code, message, extra);
  };

  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST');
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN ?? 'https://aibigplayer.top');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Request-Id', requestId);

  let body;
  try { body = req.body ?? JSON.parse(req); } catch { return fail(400, 'bad_json', 'body must be JSON'); }
  const q = (body?.question ?? '').toString().trim();
  if (!q) return fail(400, 'empty_question', 'question is required');
  if (q.length > 300) return fail(400, 'question_too_long', 'question max 300 chars');

  let c;
  try { c = corpus(); } catch {
    return fail(500, 'corpus_missing', '语料数据包未部署');
  }

  // P05.1 范围契约: 非法范围显式拒绝, 绝不静默扩大到全部语料
  // (先校验范围再做供应商检查: 范围错误属于请求错误, 不该被 503 掩盖)
  let scope;
  try {
    scope = resolveScope(body, {
      corpusParagraphs: c,
      articleMeta: ARTICLE_META,
      topics: topics(),
    });
  } catch (e) {
    if (e instanceof ScopeError) return fail(400, e.code, e.message, { scopeError: e.detail });
    throw e;
  }

  let provider;
  try { provider = loadProviderConfig(); } catch (e) {
    return fail(503, 'provider_not_configured', e.message);
  }

  /* P05.1: 请求校验(400)优先于服务状态(402/503) */
  const budget = await makeCnyBudget();
  if (!budget.configured) return fail(503, 'budget_not_configured', 'AI 问答未配置预算, 已阻断。阅读与笔记不受影响。');
  if (await budget.exhausted()) return fail(402, 'budget_exhausted', '本轮试用额度已用完，AI 问答暂时关闭。阅读与笔记不受影响。');
  /* 单次请求费用上限（含最多 3 次上游尝试），保守取 0.06 元 */
  const RESERVE_CNY = 0.06;
  if (!(await budget.reserve(RESERVE_CNY))) {
    return fail(402, 'budget_exhausted', '本轮试用额度不足以完成本次提问，已停止调用。阅读与笔记不受影响。');
  }


  const ip = getClientIp(req);
  const { sid } = sessionOf(req, res);
  const rl = await rateLimit(sid + '|' + ip, RL_MAX);
  if (rl.limited) {
    res.setHeader('Retry-After', String(Math.ceil(rl.resetInMs / 1000)));
    return fail(429, 'rate_limited', '提问过于频繁, 请稍后再试。');
  }

  const scopedCorpus = scopeParagraphs(scope, c);
  if (!scopedCorpus.length) {
    // 范围合法但没有可用段落 → 明确说明不足, 不扩大到全库
    return fail(400, 'scope_empty', '所选范围内没有可检索的原文段落。');
  }

  try {
    const out = await askPipeline(q, {
      provider, corpus: scopedCorpus,
      timeoutMs: provider.timeoutMs, maxRetries: 1,
      budget: null,     // CNY 预算已在入口预留/结算，管线内不再做次数预占
    }, e => console.log(JSON.stringify({ t: 'ask_' + e.t, requestId, ...e })));

    const calls = (out.attemptsLog ?? []).length || (out.attempts ?? 1);
    /* 50 元预算: 用真实 token 用量按官方高峰价结算, 并把预留额度调整为实际费用 */
    const usageCost = costOfUsage(out.usage || {});
    const settle = await budget.settle(RESERVE_CNY, usageCost.cny);
    const cost = usageCost.cny;
    const costKnown = true;

    logCall({ ts: Date.now(), requestId, sid, qLen: q.length, model: out.model,
      calls, status: out.status, attempts: out.attempts ?? 1, nCitations: out.citations.length,
      fabricatedIntercepted: (out.fabricatedIntercepted ?? []).length + (out.badQuotesIntercepted ?? []).length,
      scope: scope.mode + ':' + scope.articleIds.join('|'),
      promptVersion: PROMPT_VERSION, pipelineVersion: PIPELINE_VERSION, corpusVersion: CORPUS_VERSION });

    const ledger = await recordUsage({
      requestId, attemptId: 'final', model: out.model, status: out.status, calls, cost, costKnown,
      costCurrency: 'CNY', scope: scope.mode,
      tokens: usageCost.totalTokens, outTokens: usageCost.outTokens,
    });

    return res.status(200).json({
      schemaVersion: '0.4', ok: true, requestId,
      model: out.model,
      promptVersion: PROMPT_VERSION, pipelineVersion: PIPELINE_VERSION, corpusVersion: CORPUS_VERSION,
      status: out.status,
      answer: out.answer,
      citations: out.citations.map(c2 => ({
        id: c2.id, quote: c2.quote,
        articleId: c2.id.replace(/^p(v\d+n\d+)-.*$/, '$1'),
        articleTitle: ARTICLE_META?.[c2.id.replace(/^p(v\d+n\d+)-.*$/, '$1')]?.title ?? null,
      })),
      evidenceIds: out.evidenceIds, hitIds: out.hitIds ?? [], ms: out.ms,
      attempts: out.attempts ?? 1,
      scopeResolved: scope,                       // 前后端范围可逐字段核对
      usage: {
        calls, budgetUnit: 'CNY', budgetLeft: await budget.left(), budgetScope: budget.scope,
        budgetLimit: budget.limit, costCny: usageCost.cny, costBasis: usageCost.priceBasis,
        tokens: usageCost.totalTokens, outTokens: usageCost.outTokens,
        settle: settle.ok ? 'ok' : 'failed',
        cost: cost, costKnown,                    // 未知金额时 cost=null, 不是 0
        ledgerPersisted: !!ledger.persisted,
      },
      governance: {
        rateLimitScope: rl.scope,                 // global=跨实例; instance=仅本实例
        rateLimitRemaining: Math.max(0, RL_MAX - rl.count),
        kvConfigured: kvConfigured(),
        elapsedMs: Date.now() - startedAt,
      },
    });
  } catch (e) {
    /* 调用失败: 退回预留额度 (上游若已计费由供应商侧账单体现) */
    await budget.release(RESERVE_CNY).catch(() => {});
    const calls = (e.attemptsLog ?? []).length || 0;
    const costs = (e.attemptsLog ?? []).map(a => a.cost).filter(x => typeof x === 'number');
    await recordUsage({
      requestId, attemptId: 'final', model: provider.model, status: 'error', code: e.code ?? e.status ?? 'upstream_error',
      calls, cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
      costKnown: costs.length > 0 && costs.length === calls, scope: scope.mode,
    });
    if (e.code === 'BUDGET_EXHAUSTED') return fail(402, 'budget_exhausted', 'AI 问答预算已耗尽, 已阻断。');
    if (e.status === 402) { budget.markExhausted(); return fail(402, 'upstream_insufficient', '上游余额不足, 已熔断。'); }
    if (e.code === 'TIMEOUT' || e.status === 504) return fail(504, 'upstream_timeout', '模型调用超时, 本次提问未产生结果; 已发出的调用仍可能计费。');
    if (e.status === 429) { res.setHeader('Retry-After', '30'); return fail(429, 'upstream_rate_limited', '上游限流, 请稍后再试。'); }
    if (e.code === 'citation_invalid') return fail(502, 'citation_validation_failed', '模型输出未通过引用校验, 已拦截; 未返回任何未经核验的答案。');
    return fail(502, 'upstream_error', String(e.message ?? e).slice(0, 160));
  }
}
