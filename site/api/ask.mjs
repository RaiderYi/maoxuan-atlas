// P05: /api/ask — 带真实段落引用的 AI 问答 (范围契约 + 跨实例限流 + 台账 + 版本追踪)
// 管线: 范围契约校验 → 段落关键词检索 → 真实模型 → 结构化回答 → 引用ID/引文逐字校验
// 语料: data/sample-topic.json (v1n03+v1n04, 879 段)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { jsonError, getClientIp, sessionOf, loadProviderConfig, Budget, logCall } from './_lib.mjs';
import { loadCorpus, askPipeline, PROMPT_VERSION, PIPELINE_VERSION } from './_ask.mjs';
import { retrieveHybrid, RETRIEVAL_VERSION } from './_retrieval.mjs';
import { resolveScope, scopeParagraphs, ScopeError, rateLimit, recordUsage, newRequestId, kvConfigured, makeCnyBudget, costOfUsage, estimateReserveCny, summarizeAttempts } from './_govern.mjs';

export const config = { runtime: 'nodejs' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  path.join(__dirname, '..', 'site', 'data', 'sample-topic.json'),
  path.join(__dirname, '..', 'data', 'sample-topic.json'),
  '/var/task/data/sample-topic.json',
];
const CONCEPT_CANDIDATES = [
  path.join(__dirname, '..', 'site', 'data', 'concept-map.json'),
  path.join(__dirname, '..', 'data', 'concept-map.json'),
  '/var/task/data/concept-map.json',
];

// R55: 检索模式开关 —— hybrid(默认) = IDF加权+概念扩展；legacy = 原 bigram 计数（回滚用）
const RETRIEVAL_MODE = (process.env.RETRIEVAL_MODE ?? 'hybrid').toLowerCase() === 'legacy' ? 'legacy' : 'hybrid';
let CONCEPT_MAP = null;
function conceptMap() {
  if (CONCEPT_MAP) return CONCEPT_MAP;
  for (const p of CONCEPT_CANDIDATES) {
    try { CONCEPT_MAP = JSON.parse(fs.readFileSync(p, 'utf8')).groups ?? []; return CONCEPT_MAP; } catch { /* next */ }
  }
  CONCEPT_MAP = [];   // 映射缺失时安全退化为纯 IDF 加权检索
  return CONCEPT_MAP;
}
function pickRetrieveFn() {
  if (RETRIEVAL_MODE === 'legacy') return null;
  return (q, corpus, opts) => retrieveHybrid(q, corpus, { ...opts, conceptMap: conceptMap() });
}
function retrievalInfo() {
  return { mode: RETRIEVAL_MODE, version: RETRIEVAL_MODE === 'legacy' ? 'wp07-bigram' : RETRIEVAL_VERSION };
}
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

const RL_MAX = parseInt(process.env.ASK_RL_MAX_PER_MIN ?? '5', 10);        // 会话+IP
const RL_IP_MAX = parseInt(process.env.ASK_RL_IP_PER_MIN ?? '12', 10);     // 仅 IP: 丢 Cookie 也不重置
const RL_GLOBAL_MAX = parseInt(process.env.ASK_RL_GLOBAL_PER_MIN ?? '60', 10); // 全站保护

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
  const scopedCorpus = scopeParagraphs(scope, c);
  if (!scopedCorpus.length) {
    // 范围合法但没有可用段落 → 明确说明不足, 不扩大到全库
    return fail(400, 'scope_empty', '所选范围内没有可检索的原文段落。');
  }

  const budget = await makeCnyBudget();
  if (!budget.configured) return fail(503, 'budget_not_configured', 'AI 问答未配置预算, 已阻断。阅读与笔记不受影响。');
  if (await budget.exhausted()) return fail(402, 'budget_exhausted', '本轮试用额度已用完，AI 问答暂时关闭。阅读与笔记不受影响。');

  /* B03: 三级限流 (会话+IP / 纯IP / 全站) 一律放在预留预算之前 —
     被限流的请求不得消耗额度 (旧顺序先 reserve 后 429, 每次被限流都漏 0.06 元) */
  const ip = getClientIp(req);
  const { sid } = sessionOf(req, res);
  const rl = await rateLimit('sid:' + sid + '|' + ip, RL_MAX);
  const rlIp = await rateLimit('ip:' + ip, RL_IP_MAX);
  const rlAll = await rateLimit('global', RL_GLOBAL_MAX);
  const hitLimit = rl.limited ? 'session' : rlIp.limited ? 'ip' : rlAll.limited ? 'global' : null;
  if (hitLimit) {
    const r = hitLimit === 'session' ? rl : hitLimit === 'ip' ? rlIp : rlAll;
    res.setHeader('Retry-After', String(Math.ceil(r.resetInMs / 1000)));
    return fail(429, 'rate_limited', '提问过于频繁, 请稍后再试。', { limitScope: hitLimit });
  }

  /* FIX03 / R26: 预留上界与【实际调用配置】必须同源 —— 旧实现读 ASK_MAX_RETRIES 计算预留,
     真正调用时却写死 maxRetries:1 与 callChat 默认 maxTokens 4096, 两边可以脱钩。 */
  const MAX_OUTPUT_TOKENS = parseInt(process.env.ASK_MAX_OUTPUT_TOKENS ?? '4096', 10);
  const MAX_RETRIES = Math.max(0, parseInt(process.env.ASK_MAX_RETRIES ?? '1', 10));
  const MAX_ATTEMPTS = 1 + MAX_RETRIES;
  const CHAR_TO_TOKEN = Math.max(1, Number(process.env.ASK_TOKEN_CHAR_FACTOR ?? 1.2) || 1.2);
  const inputChars = scopedCorpus.reduce((n, p) => n + String(p.text ?? '').length, 0) + q.length + 1200;
  const RESERVE_CNY = estimateReserveCny({
    inputChars, maxOutputTokens: MAX_OUTPUT_TOKENS, attempts: MAX_ATTEMPTS, charToTokenFactor: CHAR_TO_TOKEN,
  });
  if (!(await budget.reserve(RESERVE_CNY))) {
    return fail(402, 'budget_exhausted', '本轮试用额度不足以完成本次提问，已停止调用。阅读与笔记不受影响。',
      { reserveCny: RESERVE_CNY });
  }

  try {
    const out = await askPipeline(q, {
      provider, corpus: scopedCorpus,
      retrieveFn: pickRetrieveFn(),
      timeoutMs: provider.timeoutMs, maxRetries: MAX_RETRIES, maxTokens: MAX_OUTPUT_TOKENS,
      budget: null,     // CNY 预算已在入口预留/结算，管线内不再做次数预占
    }, e => console.log(JSON.stringify({ t: 'ask_' + e.t, requestId, ...e })));

    /* R25: 逐次汇总, 不再用"累计 token>0"代表整个请求 */
    const sum = summarizeAttempts(out.attemptsLog ?? [], { reserveCny: RESERVE_CNY, maxAttempts: MAX_ATTEMPTS });
    const calls = sum.calls;
    const usageCost = costOfUsage(out.usage || {});
    const usageKnown = sum.fullyKnown;                 // 所有尝试都有可核算用量才算"已知"
    const idemKey = `${requestId}:final`;
    let settle;
    let cost;
    let costKnown;
    let settlementKind;
    if (sum.settlement === 'settled_actual') {
      settle = await budget.settle(RESERVE_CNY, sum.knownCost, { idemKey, mode: 'settle' });
      cost = sum.knownCost;
      costKnown = true;
      settlementKind = 'settled_actual';
    } else if (sum.settlement === 'partial_known_hold') {
      /* 已知部分照实扣, 未知尝试的份额继续占用预留 —— 不宣称整请求费用已知 */
      settle = await budget.settle(RESERVE_CNY, sum.targetCny, { idemKey, mode: 'settle_partial' });
      cost = sum.knownCost;
      costKnown = false;
      settlementKind = 'partial_known_hold';
    } else if (sum.settlement === 'released') {
      settle = await budget.release(RESERVE_CNY, { idemKey });
      cost = 0; costKnown = true; settlementKind = 'released';
    } else {
      settle = await budget.hold('usage_missing');
      cost = null;
      costKnown = false;
      settlementKind = 'held';
    }

    logCall({ ts: Date.now(), requestId, sid, qLen: q.length, model: out.model,
      calls, status: out.status, attempts: out.attempts ?? 1, nCitations: out.citations.length,
      fabricatedIntercepted: (out.fabricatedIntercepted ?? []).length + (out.badQuotesIntercepted ?? []).length,
      scope: scope.mode + ':' + scope.articleIds.join('|'),
      promptVersion: PROMPT_VERSION, pipelineVersion: PIPELINE_VERSION, corpusVersion: CORPUS_VERSION });

    const ledger = await recordUsage({
      requestId, attemptId: 'final', model: out.model, status: out.status, calls, cost, costKnown,
      costCurrency: 'CNY', scope: scope.mode,
      tokens: usageCost.totalTokens, outTokens: usageCost.outTokens,
      unknownCalls: sum.unknownCalls,
    });

    return res.status(200).json({
      schemaVersion: '0.4', ok: true, requestId,
      model: out.model,
      promptVersion: PROMPT_VERSION, pipelineVersion: PIPELINE_VERSION, corpusVersion: CORPUS_VERSION,
      retrieval: retrievalInfo(),
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
        settlement: settlementKind,               // settled_actual | partial_known_hold | held | released
        reserveCny: RESERVE_CNY,
        cost: cost, costKnown,                    // 未知金额时 cost=null, 不是 0
        unknownCalls: sum.unknownCalls,           // 未回 usage 的调用次数 (费用仍可能已发生)
        attemptsDetail: sum.attempts,             // 逐次判定结果, 可被外部复核
        ledgerPersisted: !!ledger.persisted,
      },
      governance: {
        rateLimitScope: rl.scope,                 // global=跨实例; instance=仅本实例
        rateLimitRemaining: Math.max(0, RL_MAX - rl.count),
        rateLimits: {                             // B03: 三级限流可逐项核对
          session: { used: rl.count, max: RL_MAX, remaining: Math.max(0, RL_MAX - rl.count), scope: rl.scope },
          ip: { used: rlIp.count, max: RL_IP_MAX, remaining: Math.max(0, RL_IP_MAX - rlIp.count), scope: rlIp.scope },
          global: { used: rlAll.count, max: RL_GLOBAL_MAX, remaining: Math.max(0, RL_GLOBAL_MAX - rlAll.count), scope: rlAll.scope },
        },
        kvConfigured: kvConfigured(),
        elapsedMs: Date.now() - startedAt,
      },
    });
  } catch (e) {
    /* FIX02 / R25: 失败不等于上游未计费, 且"最终一次被拒绝"不代表前面几次没花钱。
       逐次判定 (known / unknown / refused) 后汇总:
       - 全部 known        → 按真实费用结算
       - 部分 known + 部分未知 → 已知照扣, 未知份额继续预留 (partial_known_hold)
       - 只有未知          → 保留预留不结算
       - 全部被拒绝 / 无调用 → 释放预留 */
    const attemptsLog = e.attemptsLog ?? [];
    const sum = summarizeAttempts(attemptsLog, { reserveCny: RESERVE_CNY, maxAttempts: MAX_ATTEMPTS });
    const calls = sum.calls;
    const usageKnown = sum.fullyKnown;
    const idemKey = `${requestId}:final`;

    let settlement;
    let ledgerCost = null;
    let ledgerCostKnown = false;
    let settlementKind;
    if (sum.settlement === 'settled_actual' && calls > 0) {
      ledgerCost = sum.knownCost;
      ledgerCostKnown = true;
      settlement = await budget.settle(RESERVE_CNY, ledgerCost, { idemKey, mode: 'settle' });
      settlementKind = 'settled_actual';
    } else if (sum.settlement === 'partial_known_hold') {
      /* 已发生的部分必须记账并扣款; 未知部分保留预留, 不因后续 429 而整笔退款 */
      ledgerCost = sum.knownCost;
      ledgerCostKnown = false;
      settlement = await budget.settle(RESERVE_CNY, sum.targetCny, { idemKey, mode: 'settle_partial' });
      settlementKind = 'partial_known_hold';
    } else if (sum.settlement === 'released' || (calls > 0 && sum.knownCalls === 0 && sum.unknownCalls === 0)) {
      settlement = await budget.release(RESERVE_CNY, { idemKey });
      settlementKind = 'released';
      ledgerCost = 0; ledgerCostKnown = true;
    } else {
      settlement = await budget.hold(usageKnown ? 'cost_unknown_but_charged' : 'usage_missing');
      settlementKind = 'held';
    }

    await recordUsage({
      requestId, attemptId: 'final', model: provider.model, status: 'error', code: e.code ?? e.status ?? 'upstream_error',
      calls, cost: ledgerCost, costKnown: ledgerCostKnown, scope: scope.mode,
      settlement: settlementKind, settlementOk: !!settlement.ok,
      unknownCalls: sum.unknownCalls,
    });
    const settleInfo = { settlement: settlementKind, reserveCny: RESERVE_CNY,
      cost: ledgerCost, costKnown: ledgerCostKnown,
      unknownCalls: sum.unknownCalls, attemptsDetail: sum.attempts };
    if (e.code === 'BUDGET_EXHAUSTED') return fail(402, 'budget_exhausted', 'AI 问答预算已耗尽, 已阻断。', settleInfo);
    if (e.status === 402) {
      await budget.markExhausted();
      return fail(402, 'upstream_insufficient', '上游余额不足, 已熔断。', settleInfo);
    }
    if (e.code === 'TIMEOUT' || e.status === 504) return fail(504, 'upstream_timeout', '模型调用超时, 本次提问未产生结果; 已发出的调用仍可能计费。', settleInfo);
    if (e.status === 429) { res.setHeader('Retry-After', '30'); return fail(429, 'upstream_rate_limited', '上游限流, 请稍后再试。', settleInfo); }
    if (e.code === 'citation_invalid') return fail(502, 'citation_validation_failed', '模型输出未通过引用校验, 已拦截; 未返回任何未经核验的答案。', settleInfo);
    return fail(502, 'upstream_error', String(e.message ?? e).slice(0, 160), settleInfo);
  }
}
