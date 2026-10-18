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
  const raw = (body && body.scope !== undefined) ? body.scope : undefined;
  const corpus = ctx.corpusParagraphs || [];
  const byArticle = new Map();
  const knownParas = new Map();
  for (const p of corpus) {
    knownParas.set(p.id, p);
    if (!byArticle.has(p.articleId)) byArticle.set(p.articleId, []);
    byArticle.get(p.articleId).push(p.id);
  }
  const knownArticles = new Set(byArticle.keys());
  const topics = ctx.topics || {};

  // 1) 完全未提供 scope → 全语料（显式回显 mode=corpus，前端与日志都可见）
  if (raw === undefined || raw === null) {
    return { mode: 'corpus', articleIds: [...knownArticles].sort(), paragraphIds: [], topicId: null, note: null };
  }
  // 2) 提供了但结构非法 → 拒绝（绝不悄悄当成全库）
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ScopeError('scope_invalid', 'scope 必须是对象；查询全语料请省略 scope 或传 {"mode":"corpus"}');
  }
  const keys = Object.keys(raw);
  if (keys.length === 0) {
    throw new ScopeError('scope_invalid', 'scope 为空对象；查询全语料请省略 scope 或传 {"mode":"corpus"}');
  }

  const mode = String(raw.mode || '').toLowerCase();
  const articleIds = Array.isArray(raw.articleIds) ? [...new Set(raw.articleIds.map(String))] : [];
  const paragraphIds = Array.isArray(raw.paragraphIds) ? [...new Set(raw.paragraphIds.map(String))] : [];
  const topicId = raw.topicId ? String(raw.topicId) : null;
  const note = raw.note ? String(raw.note).slice(0, 120) : null;

  // 3) 显式全语料
  if (mode === 'corpus') {
    if (articleIds.length || paragraphIds.length || topicId) {
      throw new ScopeError('scope_invalid', 'mode=corpus 不能同时指定 articleIds/paragraphIds/topicId');
    }
    return { mode: 'corpus', articleIds: [...knownArticles].sort(), paragraphIds: [], topicId: null, note };
  }
  if (mode && !['articles', 'paragraphs'].includes(mode)) {
    throw new ScopeError('scope_invalid', '未知 scope.mode: ' + mode);
  }

  // 4) 先校验所有显式 ID（任何非法 ID 都拒绝，不返回半合法范围）
  const badArticles = articleIds.filter(a => !knownArticles.has(a));
  if (badArticles.length) throw new ScopeError('scope_invalid', '未知文章: ' + badArticles.join('、'), { badArticles });
  const badParas = paragraphIds.filter(id => !knownParas.has(id));
  if (badParas.length) {
    // 为什么可能是"存在但不能引用": 题注/尾注段落不作为文本证据，服务端语料里没有它们
    throw new ScopeError('scope_invalid',
      '段落不存在或不可作为引用范围: ' + badParas.slice(0, 5).join('、') +
      '（题注与注释类段落不作文本证据）', { badParagraphs: badParas });
  }

  // 5) 专题范围
  let topicArticles = null;
  if (topicId) {
    const t = topics[topicId];
    if (!t) throw new ScopeError('scope_invalid', '未知专题: ' + topicId, { topicId });
    topicArticles = new Set(t.articles || []);
    const extra = articleIds.filter(a => !topicArticles.has(a));
    if (extra.length) {
      throw new ScopeError('scope_invalid', '范围包含专题之外的文章: ' + extra.join('、'),
        { topicId, allowed: [...topicArticles], extra });
    }
  }

  // 6) 段落范围（可与专题/文章组合，但必须一致，不能被忽略）
  if (paragraphIds.length) {
    const derived = [...new Set(paragraphIds.map(id => knownParas.get(id).articleId))];
    if (topicArticles) {
      const outside = derived.filter(a => !topicArticles.has(a));
      if (outside.length) {
        throw new ScopeError('scope_invalid', '段落不属于该专题: ' + outside.join('、'), { topicId, outside });
      }
    }
    if (articleIds.length) {
      const mismatch = derived.filter(a => !articleIds.includes(a));
      if (mismatch.length) {
        throw new ScopeError('scope_invalid', '段落与文章范围不一致: ' + mismatch.join('、'), { mismatch });
      }
    }
    if (mode === 'articles') {
      throw new ScopeError('scope_invalid', 'mode=articles 不能同时指定 paragraphIds');
    }
    return {
      mode: 'paragraphs',
      articleIds: (articleIds.length ? articleIds : derived).sort(),
      paragraphIds,
      topicId,
      note,
    };
  }
  if (mode === 'paragraphs') {
    throw new ScopeError('scope_invalid', 'mode=paragraphs 需要提供 paragraphIds');
  }

  // 7) 文章范围（专题时取专题允许集合）
  if (articleIds.length) {
    return { mode: 'articles', articleIds: articleIds.sort(), paragraphIds: [], topicId, note };
  }
  if (topicArticles) {
    return { mode: 'articles', articleIds: [...topicArticles].sort(), paragraphIds: [], topicId, note };
  }

  // 8) 提供了 scope 但没有任何有效范围 → 拒绝
  throw new ScopeError('scope_invalid', 'scope 未包含任何有效范围；查询全语料请省略 scope 或传 {"mode":"corpus"}');
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
  if (!r.ok) throw new Error('kv http ' + r.status);
  const j = await r.json().catch(() => ({}));
  // Upstash/Vercel KV 在命令错误时仍返回 HTTP 200，body 里带 error 字段
  if (j && j.error) throw new Error('kv cmd error: ' + String(j.error));
  return j;
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
  // entry: { calls, costKnown, cost, requestId, attemptId, model, status, code }
  const day = dayKey || new Date().toISOString().slice(0, 10);
  const calls = Number(entry.calls ?? 0);
  const cost = entry.costKnown && typeof entry.cost === 'number' ? entry.cost : null;
  const line = {
    t: 'ai_ledger', ts: Date.now(), day,
    requestId: entry.requestId ?? null,
    attemptId: entry.attemptId ?? null,
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
      // 幂等: 同一 (requestId|attemptId) 只结算一次; 重试/重复回调不会重复计费
      const idemKey = `ledger:idem:${entry.requestId ?? 'noreq'}:${entry.attemptId ?? 'final'}`;
      const idem = await kvCmd(['SET', idemKey, '1', 'NX', 'EX', '86400']);
      if (idem && idem.result === null) {
        return { persisted: true, deduped: true, ...line };
      }
      const hk = `${LEDGER_KEY}:${day}`;
      await kvCmd(['HINCRBY', hk, 'calls', String(calls)]);
      if (cost === null) {
        await kvCmd(['HINCRBY', hk, 'unknownCostCalls', String(calls)]);
      } else {
        // 金额在 hash 字段上累加, 必须用 HINCRBYFLOAT (INCRBYFLOAT 是字符串键命令)
        await kvCmd(['HINCRBYFLOAT', hk, 'cost', String(cost)]);
      }
      await kvCmd(['EXPIRE', hk, String(60 * 60 * 24 * 90)]);
      return { persisted: true, ...line };
    } catch (e) {
      console.log(JSON.stringify({ t: 'kv_error', where: 'ledger', msg: String(e.message) }));
      // 落库失败不得伪装成功: persisted=false + 原因
      return { persisted: false, ...line, error: String(e.message) };
    }
  }
  return { persisted: false, ...line, reason: 'kv_not_configured' };
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

/* ---------- B02/B03: 跨实例原子预算 ----------
   - 有 KV: INCRBY 原子预占, 超限立刻 DECRBY 回滚; 冷启动/多实例共享同一计数
   - KV 故障: 一律拒绝新增调用 (不因治理服务故障而放开成本控制)
   - 无 KV: 进程内计数, 明确标注 scope='instance' (不当成全局额度) */
export async function makeBudget() {
  const rawLimit = process.env.BUDGET_LIMIT_CREDIT;
  const limit = (rawLimit && /^\d+(\.\d+)?$/.test(String(rawLimit))) ? parseFloat(rawLimit) : null;
  const period = process.env.BUDGET_PERIOD || new Date().toISOString().slice(0, 10);
  const key = `budget:used:${period}`;
  const kv = kvConfigured();
  let instanceUsed = 0;
  const api = {
    configured: limit !== null,
    limit,
    period,
    scope: kv ? 'global' : 'instance',
    async reserve(n = 1) {
      if (limit === null) return false;
      if (kv) {
        try {
          const r = await kvCmd(['INCRBY', key, String(n)]);
          const used = Number(r.result);
          if (!Number.isFinite(used)) throw new Error('kv bad reply');
          if (used > limit) { await kvCmd(['DECRBY', key, String(n)]); return false; }
          return true;
        } catch (e) {
          console.log(JSON.stringify({ t: 'kv_error', where: 'budget', msg: String(e && e.message) }));
          return false;                       // 治理服务故障 → 停止新增调用
        }
      }
      if (instanceUsed + n > limit) return false;
      instanceUsed += n;
      return true;
    },
    async release(n = 1) {
      if (kv) { try { await kvCmd(['DECRBY', key, String(n)]); } catch { /* 释放失败不掩盖 */ } }
      else instanceUsed = Math.max(0, instanceUsed - n);
    },
    async used() {
      if (kv) {
        try { const r = await kvCmd(['GET', key]); return Number(r.result || 0) || 0; }
        catch { return null; }
      }
      return instanceUsed;
    },
    async left() {
      if (limit === null) return null;
      const u = await api.used();
      return u === null ? null : Math.max(0, limit - u);
    },
    async exhausted() {
      if (limit === null) return false;
      const u = await api.used();
      if (u === null) return true;            // 读不到状态 → 视为不可用, 阻断
      return u >= limit;
    },
    markExhausted() { if (!kv && limit !== null) instanceUsed = limit; },
    /* 兼容同步调用点 (测试/旧代码): 无 KV 时的快速判断 */
    _instanceUsed: () => instanceUsed,
  };
  return api;
}

/* ---------- 50 元真实计费预算 (CNY) ----------
   价格口径: DeepSeek deepseek-flash 官方价, 取【高峰价】做保守估算
     输入 缓存命中 0.04 元/百万 · 缓存未命中 2.00 元/百万 · 输出 8.00 元/百万
   结算: 先按单次上限预留, 拿到 usage 后按实际 token 结算并退回差额 */
export const PRICE_CNY_PER_M = { in_hit: 0.04, in_miss: 2.0, out: 8.0 };

export function costOfUsage(usage) {
  const u = usage || {};
  const hit = Number(u.prompt_cache_hit_tokens || 0);
  const miss = Number(u.prompt_cache_miss_tokens != null
    ? u.prompt_cache_miss_tokens
    : Math.max(0, Number(u.prompt_tokens || 0) - hit));
  const out = Number(u.completion_tokens || 0);
  const cny = (hit * PRICE_CNY_PER_M.in_hit + miss * PRICE_CNY_PER_M.in_miss + out * PRICE_CNY_PER_M.out) / 1e6;
  return {
    cny: Math.round(cny * 1e6) / 1e6,
    hitTokens: hit, missTokens: miss, outTokens: out,
    totalTokens: hit + miss + out,
    priceBasis: 'deepseek-flash peak (in_miss 2.0 / out 8.0 / in_hit 0.04 CNY per 1M)',
  };
}

export async function makeCnyBudget() {
  const raw = process.env.BUDGET_LIMIT_CNY;
  const limit = (raw && /^\d+(\.\d+)?$/.test(String(raw))) ? parseFloat(raw) : null;
  const period = process.env.BUDGET_PERIOD || new Date().toISOString().slice(0, 7);
  const key = `budget:cny:${period}`;
  const kv = kvConfigured();
  let instanceSpent = 0;
  const api = {
    currency: 'CNY',
    configured: limit !== null,
    limit,
    period,
    scope: kv ? 'global' : 'instance',
    async used() {
      if (kv) {
        try { const r = await kvCmd(['GET', key]); return Number(r.result || 0) || 0; }
        catch { return null; }
      }
      return instanceSpent;
    },
    async left() {
      if (limit === null) return null;
      const u = await api.used();
      return u === null ? null : Math.max(0, limit - u);
    },
    async exhausted() {
      if (limit === null) return false;
      const u = await api.used();
      if (u === null) return true;      // 读不到状态 → 视为不可用, 阻断
      return u >= limit;
    },
    /** 预留一次请求的上限费用; 超限返回 false 并回滚 */
    async reserve(amount) {
      if (limit === null) return false;
      const amt = Math.max(0, Number(amount) || 0);
      if (kv) {
        try {
          const r = await kvCmd(['INCRBYFLOAT', key, String(amt)]);
          const v = Number(r.result);
          if (!Number.isFinite(v)) throw new Error('kv bad reply');
          if (v > limit) { await kvCmd(['INCRBYFLOAT', key, String(-amt)]); return false; }
          return true;
        } catch (e) {
          console.log(JSON.stringify({ t: 'kv_error', where: 'budget_cny', msg: String(e && e.message) }));
          return false;
        }
      }
      if (instanceSpent + amt > limit) return false;
      instanceSpent += amt;
      return true;
    },
    /** 用实际费用替换预留 (差额可为负) */
    async settle(reserved, actual) {
      const delta = (Number(actual) || 0) - (Number(reserved) || 0);
      const d = Math.round(delta * 1e6) / 1e6;
      if (kv) {
        try { await kvCmd(['INCRBYFLOAT', key, String(d)]); return { ok: true, delta: d }; }
        catch (e) { return { ok: false, delta: d, error: String(e && e.message) }; }
      }
      instanceSpent = Math.max(0, instanceSpent + d);
      return { ok: true, delta: d };
    },
    async release(reserved) { return api.settle(reserved, 0); },
  };
  return api;
}
