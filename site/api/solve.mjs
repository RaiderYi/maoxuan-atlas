// R49: /api/solve — 「带着问题读经典」问题解决闭环
//   stage=decompose: 问题解构（理解 + 最多2个追问 + 高风险分流）——无语料引用
//   stage=solve:     问题解决卡（判断/拆解/行动/模拟示例/经典依据）——引用逐字校验，同 /api/ask 标准
// 治理与 /api/ask 同构: 范围语料同源 + 三级限流 + CNY 预算预留/结算 + 台账 + 请求号
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { jsonError, getClientIp, sessionOf, loadProviderConfig, logCall } from './_lib.mjs';
import { loadCorpus, PROMPT_VERSION } from './_ask.mjs';
import { SOLVE_PROMPT_VERSION, decomposePipeline, solvePipeline } from './_solve.mjs';
import { recordUsage, newRequestId, kvConfigured, makeCnyBudget, costOfUsage, estimateReserveCny, summarizeAttempts } from './_govern.mjs';

export const config = { runtime: 'nodejs' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
    const paras = [...(a.paragraphs ?? [])].sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0));
    for (const para of paras) {
      hash.update(String(para.id ?? '')).update('\u0000');
      hash.update(String(para.text ?? '')).update('\u0000');
    }
    hash.update('\u0001');
  }
  return 'corpus-' + hash.digest('hex').slice(0, 20) + ':articles=' + aids.length + ':paras=' + CORPUS.length;
}

// 与 /api/ask 共享同一组限流环境变量（一个用户的提问+解构共用全站保护）
const RL_MAX = parseInt(process.env.ASK_RL_MAX_PER_MIN ?? '5', 10);
const RL_IP_MAX = parseInt(process.env.ASK_RL_IP_PER_MIN ?? '12', 10);
const RL_GLOBAL_MAX = parseInt(process.env.ASK_RL_GLOBAL_PER_MIN ?? '60', 10);

const MAX_PROBLEM_LEN = 500;
const MAX_ANSWERS = 2;

export default async function handler(req, res) {
  const requestId = newRequestId();
  const startedAt = Date.now();
  const fail = (status, code, message, extra) => {
    res.setHeader('X-Request-Id', requestId);
    recordUsage({ requestId, attemptId: 'final', status: 'error', code, calls: 0, costKnown: false, scope: 'solve' });
    return jsonError(res, status, code, message, extra);
  };

  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST');
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN ?? 'https://aibigplayer.top');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Request-Id', requestId);

  let body;
  try { body = req.body ?? JSON.parse(req); } catch { return fail(400, 'bad_json', 'body must be JSON'); }
  const stage = String(body?.stage ?? '').trim();
  if (!['decompose', 'solve'].includes(stage)) {
    return fail(400, 'bad_stage', 'stage must be "decompose" or "solve"');
  }
  const problem = (body?.problem ?? '').toString().trim();
  if (!problem) return fail(400, 'empty_problem', 'problem is required');
  if (problem.length > MAX_PROBLEM_LEN) return fail(400, 'problem_too_long', `problem max ${MAX_PROBLEM_LEN} chars`);

  // solve 阶段必须带回 decompose 的理解结构；追问回答最多 2 条、每条 ≤300 字
  let brief = null;
  if (stage === 'solve') {
    const u = body?.understanding;
    if (!u || typeof u !== 'object' || !String(u.goal ?? '').trim()) {
      return fail(400, 'missing_understanding', 'solve 阶段必须携带 decompose 返回的 understanding（至少含 goal）');
    }
    const rawAnswers = Array.isArray(body?.answers) ? body.answers.slice(0, MAX_ANSWERS) : [];
    brief = {
      problem,
      understanding: {
        goal: String(u.goal ?? '').slice(0, 200),
        known: (Array.isArray(u.known) ? u.known : []).slice(0, 6).map(x => String(x).slice(0, 120)),
        unknown: (Array.isArray(u.unknown) ? u.unknown : []).slice(0, 4).map(x => String(x).slice(0, 120)),
        focus: String(u.focus ?? '').slice(0, 200),
      },
      answers: rawAnswers.map(a => ({
        question: String(a?.question ?? '').slice(0, 120),
        answer: String(a?.answer ?? '').slice(0, 300),
      })).filter(a => a.answer),
    };
  }

  let provider;
  try { provider = loadProviderConfig(); } catch (e) {
    return fail(503, 'provider_not_configured', e.message);
  }

  const c = stage === 'solve' ? corpus() : null;
  if (stage === 'solve' && !c) return fail(500, 'corpus_missing', '语料数据包未部署');

  const budget = await makeCnyBudget();
  if (!budget.configured) return fail(503, 'budget_not_configured', 'AI 问答未配置预算, 已阻断。阅读与笔记不受影响。');
  if (await budget.exhausted()) return fail(402, 'budget_exhausted', '本轮试用额度已用完，AI 功能暂时关闭。阅读与笔记不受影响。');

  const ip = getClientIp(req);
  const { sid } = sessionOf(req, res);
  const rl = await rateLimitSafe('sid:' + sid + '|' + ip, RL_MAX);
  const rlIp = await rateLimitSafe('ip:' + ip, RL_IP_MAX);
  const rlAll = await rateLimitSafe('global', RL_GLOBAL_MAX);
  const hitLimit = rl.limited ? 'session' : rlIp.limited ? 'ip' : rlAll.limited ? 'global' : null;
  if (hitLimit) {
    const r = hitLimit === 'session' ? rl : hitLimit === 'ip' ? rlIp : rlAll;
    res.setHeader('Retry-After', String(Math.ceil(r.resetInMs / 1000)));
    return fail(429, 'rate_limited', '操作过于频繁, 请稍后再试。', { limitScope: hitLimit });
  }

  const MAX_OUTPUT_TOKENS = parseInt(process.env.ASK_MAX_OUTPUT_TOKENS ?? '4096', 10);
  const MAX_RETRIES = Math.max(0, parseInt(process.env.ASK_MAX_RETRIES ?? '1', 10));
  const MAX_ATTEMPTS = 1 + MAX_RETRIES;
  const CHAR_TO_TOKEN = Math.max(1, Number(process.env.ASK_TOKEN_CHAR_FACTOR ?? 1.2) || 1.2);
  // decompose 无语料输入；solve 的证据是检索后的少量段落（按 top 段估），不是全语料
  const inputChars = stage === 'solve'
    ? Math.min(c.length, 24) * 200 + problem.length + 1500
    : problem.length + 900;
  const RESERVE_CNY = estimateReserveCny({
    inputChars, maxOutputTokens: MAX_OUTPUT_TOKENS, attempts: MAX_ATTEMPTS, charToTokenFactor: CHAR_TO_TOKEN,
  });
  if (!(await budget.reserve(RESERVE_CNY))) {
    return fail(402, 'budget_exhausted', '本轮试用额度不足以完成本次操作，已停止调用。阅读与笔记不受影响。',
      { reserveCny: RESERVE_CNY });
  }

  try {
    const out = stage === 'solve'
      ? await solvePipeline(brief, { provider, corpus: c, timeoutMs: provider.timeoutMs,
          maxRetries: MAX_RETRIES, maxTokens: MAX_OUTPUT_TOKENS, budget: null },
          e => console.log(JSON.stringify({ t: 'solve_' + e.t, requestId, ...e })))
      : await decomposePipeline(problem, { provider, timeoutMs: provider.timeoutMs,
          maxRetries: MAX_RETRIES, maxTokens: 1500, budget: null },
          e => console.log(JSON.stringify({ t: 'solve_' + e.t, requestId, ...e })));

    const sum = summarizeAttempts(out.attemptsLog ?? [], { reserveCny: RESERVE_CNY, maxAttempts: MAX_ATTEMPTS });
    const calls = sum.calls;
    const usageCost = costOfUsage(out.usage || {});
    const idemKey = `${requestId}:final`;
    let settle; let cost; let costKnown; let settlementKind;
    if (sum.settlement === 'settled_actual') {
      settle = await budget.settle(RESERVE_CNY, sum.knownCost, { idemKey, mode: 'settle' });
      cost = sum.knownCost; costKnown = true; settlementKind = 'settled_actual';
    } else if (sum.settlement === 'partial_known_hold') {
      settle = await budget.settle(RESERVE_CNY, sum.targetCny, { idemKey, mode: 'settle_partial' });
      cost = sum.knownCost; costKnown = false; settlementKind = 'partial_known_hold';
    } else if (sum.settlement === 'released') {
      settle = await budget.release(RESERVE_CNY, { idemKey });
      cost = 0; costKnown = true; settlementKind = 'released';
    } else {
      settle = await budget.hold('usage_missing');
      cost = null; costKnown = false; settlementKind = 'held';
    }

    logCall({ ts: Date.now(), requestId, sid, qLen: problem.length, model: out.model,
      calls, stage, status: 'ok', attempts: out.attempts ?? 1,
      nCitations: (out.classics ?? []).length,
      promptVersion: SOLVE_PROMPT_VERSION, pipelineVersion: PROMPT_VERSION, corpusVersion: CORPUS_VERSION });

    const ledger = await recordUsage({
      requestId, attemptId: 'final', model: out.model, status: 'ok', calls, cost, costKnown,
      costCurrency: 'CNY', scope: 'solve',
      tokens: usageCost.totalTokens, outTokens: usageCost.outTokens,
      unknownCalls: sum.unknownCalls,
    });

    const usageBlock = {
      calls, budgetUnit: 'CNY', budgetLeft: await budget.left(), budgetScope: budget.scope,
      budgetLimit: budget.limit, costCny: usageCost.cny, costBasis: usageCost.priceBasis,
      tokens: usageCost.totalTokens, outTokens: usageCost.outTokens,
      settle: settle.ok ? 'ok' : 'failed', settlement: settlementKind,
      reserveCny: RESERVE_CNY, cost, costKnown, unknownCalls: sum.unknownCalls,
      attemptsDetail: sum.attempts, ledgerPersisted: !!ledger.persisted,
    };

    if (stage === 'decompose') {
      return res.status(200).json({
        schemaVersion: '0.4', ok: true, requestId, stage,
        model: out.model, promptVersion: SOLVE_PROMPT_VERSION, pipelineVersion: PROMPT_VERSION,
        understanding: out.understanding, followUps: out.followUps, referral: out.referral,
        ms: out.ms, attempts: out.attempts ?? 1, usage: usageBlock,
        governance: { kvConfigured: kvConfigured(), elapsedMs: Date.now() - startedAt },
      });
    }
    return res.status(200).json({
      schemaVersion: '0.4', ok: true, requestId, stage,
      model: out.model, promptVersion: SOLVE_PROMPT_VERSION, pipelineVersion: PROMPT_VERSION,
      corpusVersion: CORPUS_VERSION,
      basis: out.basis, judgment: out.judgment,
      breakdown: out.breakdown, actions: out.actions, example: out.example,
      classics: (out.classics ?? []).map(x => ({
        ...x, articleId: x.id.replace(/^p(v\d+n\d+)-.*$/, '$1'),
        articleTitle: ARTICLE_META?.[x.id.replace(/^p(v\d+n\d+)-.*$/, '$1')]?.title ?? null,
      })),
      evidenceIds: out.evidenceIds, hitIds: out.hitIds ?? [], ms: out.ms,
      attempts: out.attempts ?? 1, usage: usageBlock,
      governance: { kvConfigured: kvConfigured(), elapsedMs: Date.now() - startedAt },
    });
  } catch (e) {
    const attemptsLog = e.attemptsLog ?? [];
    const sum = summarizeAttempts(attemptsLog, { reserveCny: RESERVE_CNY, maxAttempts: MAX_ATTEMPTS });
    const calls = sum.calls;
    const idemKey = `${requestId}:final`;
    let settlement; let ledgerCost = null; let ledgerCostKnown = false; let settlementKind;
    if (sum.settlement === 'settled_actual' && calls > 0) {
      ledgerCost = sum.knownCost; ledgerCostKnown = true;
      settlement = await budget.settle(RESERVE_CNY, ledgerCost, { idemKey, mode: 'settle' });
      settlementKind = 'settled_actual';
    } else if (sum.settlement === 'partial_known_hold') {
      ledgerCost = sum.knownCost; ledgerCostKnown = false;
      settlement = await budget.settle(RESERVE_CNY, sum.targetCny, { idemKey, mode: 'settle_partial' });
      settlementKind = 'partial_known_hold';
    } else if (sum.settlement === 'released' || (calls > 0 && sum.knownCalls === 0 && sum.unknownCalls === 0)) {
      settlement = await budget.release(RESERVE_CNY, { idemKey });
      settlementKind = 'released'; ledgerCost = 0; ledgerCostKnown = true;
    } else {
      settlement = await budget.hold('usage_missing');
      settlementKind = 'held';
    }
    await recordUsage({
      requestId, attemptId: 'final', model: provider.model, status: 'error', code: e.code ?? e.status ?? 'upstream_error',
      calls, cost: ledgerCost, costKnown: ledgerCostKnown, scope: 'solve',
      settlement: settlementKind, settlementOk: !!settlement.ok,
      unknownCalls: sum.unknownCalls,
    });
    const settleInfo = { settlement: settlementKind, reserveCny: RESERVE_CNY,
      cost: ledgerCost, costKnown: ledgerCostKnown, unknownCalls: sum.unknownCalls };
    if (e.code === 'BUDGET_EXHAUSTED') return fail(402, 'budget_exhausted', 'AI 预算已耗尽, 已阻断。', settleInfo);
    if (e.status === 402) {
      await budget.markExhausted();
      return fail(402, 'upstream_insufficient', '上游余额不足, 已熔断。', settleInfo);
    }
    if (e.code === 'TIMEOUT' || e.status === 504) return fail(504, 'upstream_timeout', '模型调用超时, 本次操作未产生结果; 已发出的调用仍可能计费。', settleInfo);
    if (e.status === 429) { res.setHeader('Retry-After', '30'); return fail(429, 'upstream_rate_limited', '上游限流, 请稍后再试。', settleInfo); }
    if (e.code === 'decompose_invalid' || e.code === 'solution_invalid') return fail(502, 'solve_validation_failed', '模型输出未通过校验, 已拦截; 未返回任何未经核验的结果。', settleInfo);
    return fail(502, 'upstream_error', String(e.message ?? e).slice(0, 160), settleInfo);
  }
}

// KV 异常时 rateLimit 可能抛错 —— 与预算 fail-closed 口径一致：服务异常即阻断，不放开限流
async function rateLimitSafe(key, max) {
  try {
    const { rateLimit } = await import('./_govern.mjs');
    return await rateLimit(key, max);
  } catch (e) {
    return { limited: true, count: max + 1, scope: 'error', resetInMs: 30000, error: String(e.message ?? e) };
  }
}
