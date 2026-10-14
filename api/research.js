// WP05: 研究请求接口 /api/research — 模型适配 + 预算 + 限流 + 超时 + 匿名会话
// 依赖: 仅 Node 18+ 内置 fetch, 无第三方依赖
import crypto from 'node:crypto';
import {
  jsonError, getClientIp, sessionOf, loadProviderConfig, callModel, Budget, logCall,
} from './_lib.js';

export const config = { runtime: 'nodejs' };

// —— 匿名会话限流 (内存桶, 区域级; 生产可换 Vercel KV) ——
const RL_WINDOW_MS = 60_000;
const RL_MAX = parseInt(process.env.RL_MAX_PER_MIN ?? '5', 10);
const rlBuckets = new Map(); // key -> {windowStart, count}

function rateLimited(key) {
  const now = Date.now();
  let b = rlBuckets.get(key);
  if (!b || now - b.windowStart >= RL_WINDOW_MS) {
    b = { windowStart: now, count: 0 };
    rlBuckets.set(key, b);
  }
  b.count += 1;
  if (rlBuckets.size > 10_000) { // 防内存膨胀: 过期桶清扫
    for (const [k, v] of rlBuckets) {
      if (now - v.windowStart >= RL_WINDOW_MS) rlBuckets.delete(k);
    }
  }
  return b.count > RL_MAX;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return jsonError(res, 405, 'method_not_allowed', 'Use POST');
  // CORS: 只允许本站
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN ?? 'https://aibigplayer.top');
  res.setHeader('Vary', 'Origin');

  // 0) 预算熔断: 未配置或耗尽 → 402 阻断生成 (阅读不受影响, 本接口只管生成)
  const budget = Budget.load();
  if (!budget.configured) {
    return jsonError(res, 503, 'budget_not_configured',
      'AI 研究功能未配置预算, 已阻断生成。阅读/剧场/地图不受影响。');
  }
  if (budget.exhausted()) {
    return jsonError(res, 402, 'budget_exhausted',
      `AI 研究预算已耗尽 (上限 ${budget.limit} credit)。已阻断生成, 阅读不受影响。`);
  }

  // 1) 输入校验
  let body;
  try { body = req.body ?? JSON.parse(req); } catch { return jsonError(res, 400, 'bad_json', 'body must be JSON'); }
  const q = (body?.question ?? '').toString().trim();
  const scope = Array.isArray(body?.scope) ? body.scope.filter(x => typeof x === 'string' && x.length < 64).slice(0, 8) : [];
  if (!q) return jsonError(res, 400, 'empty_question', 'question is required');
  if (q.length > 500) return jsonError(res, 400, 'question_too_long', 'question max 500 chars');

  // 2) 匿名会话: cookie 未带则发新 sid; 不信任客户端自报 userId
  const ip = getClientIp(req);
  const { sid, setCookie } = sessionOf(req, res);
  const rlKey = sid + '|' + ip;

  // 3) 限流 (429)
  if (rateLimited(rlKey)) {
    res.setHeader('Retry-After', '60');
    return jsonError(res, 429, 'rate_limited', `每分钟最多 ${RL_MAX} 次研究请求, 请稍后再试。阅读不受影响。`);
  }

  // 4) 模型适配层 → 真实调用
  let provider;
  try { provider = loadProviderConfig(); } catch (e) {
    return jsonError(res, 503, 'provider_not_configured', e.message);
  }
  let result;
  try {
    result = await callModel(provider, { question: q, scope }, {
      timeoutMs: provider.timeoutMs,
      maxRetries: provider.maxRetries, // 有界重试 (invalid_token 类瞬时错误, ≤2)
    });
  } catch (e) {
    // 超时/上游失败 → 阻断生成, 不影响阅读
    if (e.code === 'ETIMEDOUT' || e.name === 'AbortError' || e.code === 'TIMEOUT') {
      return jsonError(res, 504, 'upstream_timeout', '模型调用超时, 已阻断本次生成。阅读不受影响。');
    }
    if (e.status === 429) {
      res.setHeader('Retry-After', e.retryAfter ?? '30');
      return jsonError(res, 429, 'upstream_rate_limited', '上游限流, 请稍后再试。');
    }
    if (e.status === 402 || e.code === 'insufficient_quota') {
      budget.markExhausted(); // 余额异常 → 熔断标记, 后续请求直接 402
      return jsonError(res, 402, 'budget_exhausted', '上游余额不足, 已熔断 AI 生成。阅读不受影响。');
    }
    return jsonError(res, 502, 'upstream_error', `模型调用失败: ${String(e.message ?? e).slice(0, 200)}`);
  }

  // 5) 记账 (脱敏费用日志)
  const cost = result?.usage?.cost?.amount ?? null;
  const spent = budget.spend(cost);
  logCall({ ts: Date.now(), sid, ipHash: hashIp(ip), model: result.model,
    qLen: q.length, qHead: q.slice(0, 24), cost, budgetLeft: budget.left() });

  // 6) 返回 (不含密钥/上游原始响应)
  return res.status(200).json({
    schemaVersion: '0.1',
    ok: true,
    model: result.model,
    answer: result.content,
    usage: { cost, budgetLeft: budget.left(), budgetLimit: budget.limit },
    sid,
  });
}

function hashIp(ip) {
  // 脱敏: SHA-256(ip + 盐) 截断, 日志不可反查明文 IP
  const salt = process.env.IP_HASH_SALT ?? 'mx-wp05';
  return crypto.createHash('sha256').update(ip + salt).digest('hex').slice(0, 12);
}
