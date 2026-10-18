// P05.1 / P05.4 / P05.5: 范围契约 · 限流 · 台账 · 反馈记录
// 设计原则:
//  - 范围非法 → 显式拒绝 (400 scope_invalid)，绝不静默扩大到全部语料
//  - 未指定范围 → 使用全语料，但在响应里回显 scopeResolved.mode='corpus'，可被前端与日志核对
//  - 限流: 配置 KV (Upstash/Vercel KV REST) 时跨实例生效; 未配置时仅单实例，响应显式标注 scope='instance'
//  - 台账: 调用次数与金额分开记账; 上游未返回金额时 cost=null，并在 summary 里报 unknownCostCalls，绝不记为 0
import crypto from 'node:crypto';

// ---------- P05.1 范围契约 ----------
export class ScopeError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail ?? null;
  }
}

/**
 * @param {object} body 请求体
 * @param {object} ctx  { corpusParagraphs: [{id, articleId}], articleMeta: {id:{title}}, topics: {topicId:{articles:[]}} }
 * @returns {{mode:'corpus'|'articles'|'paragraphs', articleIds:string[], paragraphIds:string[], topicId:string|null, note:string|null}}
 */
export function resolveScope(body, ctx) {
  const raw = (body && body.scope) || null;
  const corpus = ctx.corpusParagraphs || [];
  const knownArticles = new Set(corpus.map(p => p.articleId));
  const knownParas = new Set(corpus.map(p => p.id));
  const topics = ctx.topics || {};

  // 1) 完全未指定范围 → 全语料 (显式回显, 不隐藏)
  if (!raw || (typeof raw === 'object' && Object.keys(raw).length === 0)) {
    return { mode: 'corpus', articleIds: [...knownArticles].sort(), paragraphIds: [], topicId: null, note: null };
  }
  if (typeof raw !== 'object') throw new ScopeError('scope_invalid', 'scope 必须是对象');

  const mode = String(raw.mode || '').toLowerCase();
  const articleIds = Array.isArray(raw.articleIds) ? [...new Set(raw.articleIds.map(String))] : [];
  const paragraphIds = Array.isArray(raw.paragraphIds) ? [...new Set(raw.paragraphIds.map(String))] : [];
  const topicId = raw.topicId ? String(raw.topicId) : null;
  const note = raw.note ? String(raw.note).slice(0, 120) : null;

  // 2) 主题范围: 必须存在, 且不得夹带该主题以外的文章
  if (topicId) {
    const t = topics[topicId];
    if (!t) throw new ScopeError('scope_invalid', '未知专题: ' + topicId, { topicId });
    const allowed = new Set(t.articles || []);
    const extra = articleIds.filter(a => !allowed.has(a));
    if (extra.length) {
      throw new ScopeError('scope_invalid', '范围包含专题之外的文章: ' + extra.join('、'),
        { topicId, allowed: [...allowed], extra });
    }
    const arts = articleIds.length ? articleIds : [...allowed];
    return { mode: 'articles', articleIds: arts.sort(), paragraphIds: [], topicId, note };
  }

  // 3) 段落范围: 全部必须存在; 未给 articleIds 时由段落推导
  if (paragraphIds.length) {
    const bad = paragraphIds.filter(id => !knownParas.has(id));
    if (bad.length) throw new ScopeError('scope_invalid', '未知段落: ' + bad.slice(0, 5).join('、'), { badParagraphs: bad });
    const derived = [...new Set(paragraphIds.map(id => (corpus.find(p => p.id === id) || {}).articleId).filter(Boolean))];
    if (articleIds.length) {
      const mismatch = derived.filter(a => !articleIds.includes(a));
      if (mismatch.length) throw new ScopeError('scope_invalid', '段落与文章范围不一致: ' + mismatch.join('、'), { mismatch });
    }
    return { mode: 'paragraphs', articleIds: (articleIds.length ? articleIds : derived).sort(), paragraphIds, topicId: null, note };
  }

  // 4) 文章范围: 全部必须存在
  if (articleIds.length) {
    const bad = articleIds.filter(a => !knownArticles.has(a));
    if (bad.length) throw new ScopeError('scope_invalid', '未知文章: ' + bad.join('、'), { badArticles: bad });
    return { mode: 'articles', articleIds: articleIds.sort(), paragraphIds: [], topicId: null, note };
  }

  // 5) 给了 scope 但等于空集 → 拒绝 (绝不悄悄返回全库)
  throw new ScopeError('scope_invalid', 'scope 未包含任何有效范围; 若要查询全语料请显式省略 scope 或传 mode:"corpus"');
}

export function scopeParagraphs(scope, corpusParagraphs) {
  if (scope.mode === 'corpus') return corpusParagraphs;
  if (scope.paragraphIds.length) {
    const set = new Set(scope.paragraphIds);
    return corpusParagraphs.filter(p => set.has(p.id));
  }
  const arts = new Set(scope.articleIds);
  return corpusParagraphs.filter(p => arts.has(p.articleId));
}

// ---------- P05.4 限流 (KV 优先, 退化到单实例并显式标注) ----------
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

export function kvConfigured() { return !!(KV_URL && KV_TOKEN); }

async function kvCmd(args) {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error('kv ' + r.status);
  return r.json();
}

const memBuckets = new Map();
/**
 * 固定窗口限流。返回 {limited, count, scope:'global'|'instance', resetInMs}
 */
export async function rateLimit(key, maxPerWindow, windowMs = 60_000) {
  const bucket = Math.floor(Date.now() / windowMs);
  const k = `rl:${key}:${bucket}`;
  if (kvConfigured()) {
    try {
      const out = await kvCmd(['INCR', k]);
      const count = Number(out.result ?? 0);
      if (count === 1) await kvCmd(['PEXPIRE', k, String(windowMs)]);
      return { limited: count > maxPerWindow, count, scope: 'global', resetInMs: windowMs };
    } catch (e) {
      // KV 故障 → 不阻断服务, 但明确标注降级到单实例
      console.log(JSON.stringify({ t: 'kv_error', where: 'rate_limit', msg: String(e.message) }));
    }
  }
  const now = Date.now();
  let b = memBuckets.get(key);
  if (!b || now - b.start >= windowMs) b = { start: now, count: 0 };
  b.count += 1;
  memBuckets.set(key, b);
  if (memBuckets.size > 10_000) for (const [kk, vv] of memBuckets) if (now - vv.start >= windowMs) memBuckets.delete(kk);
  return { limited: b.count > maxPerWindow, count: b.count, scope: 'instance', resetInMs: Math.max(0, windowMs - (now - b.start)) };
}

// ---------- P05.4 台账: 次数与金额分开, 未知金额不伪装为零 ----------
const LEDGER_KEY = 'ledger:ai';

export async function recordUsage(entry, { dayKey } = {}) {
  // entry: { calls, costKnown, cost, requestId, model, status, code }
  const day = dayKey || new Date().toISOString().slice(0, 10);
  const calls = Number(entry.calls ?? 0);
  const cost = entry.costKnown && typeof entry.cost === 'number' ? entry.cost : null;
  const line = {
    t: 'ai_ledger', ts: Date.now(), day,
    requestId: entry.requestId ?? null,
    model: entry.model ?? null,
    status: entry.status ?? null,
    code: entry.code ?? null,
    calls,
    cost,                       // null = 上游未回金额 (未知), 不是 0
    costCurrency: cost === null ? null : (entry.costCurrency || 'unknown'),
    scope: entry.scope ?? null,
  };
  console.log(JSON.stringify(line));   // 始终落 stdout (Vercel 日志)
  if (kvConfigured()) {
    try {
      await kvCmd(['HINCRBY', `${LEDGER_KEY}:${day}`, 'calls', String(calls)]);
      if (cost === null) await kvCmd(['HINCRBY', `${LEDGER_KEY}:${day}`, 'unknownCostCalls', String(calls)]);
      else await kvCmd(['INCRBYFLOAT', `${LEDGER_KEY}:${day}`, 'cost', String(cost)]);
      await kvCmd(['EXPIRE', `${LEDGER_KEY}:${day}`, String(60 * 60 * 24 * 90)]);
      return { persisted: true, ...line };
    } catch (e) {
      console.log(JSON.stringify({ t: 'kv_error', where: 'ledger', msg: String(e.message) }));
    }
  }
  return { persisted: false, ...line };
}

export async function readUsage(dayKey) {
  const day = dayKey || new Date().toISOString().slice(0, 10);
  if (!kvConfigured()) return { persisted: false, day };
  try {
    const out = await kvCmd(['HGETALL', `${LEDGER_KEY}:${day}`]);
    const arr = out.result ?? [];
    const obj = {};
    for (let i = 0; i < arr.length; i += 2) obj[arr[i]] = arr[i + 1];
    return { persisted: true, day, ...obj };
  } catch (e) {
    return { persisted: false, day, error: String(e.message) };
  }
}

// ---------- P05.5 纠错记录 ----------
export function newRequestId() {
  return 'req_' + crypto.randomBytes(8).toString('hex');
}

export async function recordFeedback(entry) {
  const line = {
    t: 'ai_feedback', ts: Date.now(),
    requestId: entry.requestId ?? null,
    kind: entry.kind ?? null,           // citation_irrelevant | answer_unsupported | other
    citationId: entry.citationId ?? null,
    reason: (entry.reason ?? '').slice(0, 200) || null,
    model: entry.model ?? null,
    corpusVersion: entry.corpusVersion ?? null,
    pipelineVersion: entry.pipelineVersion ?? null,
    promptVersion: entry.promptVersion ?? null,
    scope: entry.scope ?? null,
  };
  console.log(JSON.stringify(line));
  if (kvConfigured()) {
    try {
      await kvCmd(['LPUSH', 'feedback:ai', JSON.stringify(line)]);
      await kvCmd(['LTRIM', 'feedback:ai', '0', '4999']);
      return { persisted: true };
    } catch (e) {
      console.log(JSON.stringify({ t: 'kv_error', where: 'feedback', msg: String(e.message) }));
    }
  }
  return { persisted: false };
}
