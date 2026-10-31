// R53: /api/visit — 匿名页面访问上报（非关键路径，fail-open，绝不影响浏览）
// 口径: PV=每次页面加载; UV=当日去重匿名会话(mx_sid); 只记页面名，不记任何内容
import { jsonError, sessionOf } from './_lib.mjs';
import { kvCmd, kvConfigured } from './_govern.mjs';
import { normalizePage, recordVisit } from './_visit.mjs';

export const config = { runtime: 'nodejs' };

const RL_MAX = parseInt(process.env.VISIT_RL_MAX_PER_MIN ?? '60', 10);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN ?? 'https://aibigplayer.top');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return jsonError(res, 405, 'method_not_allowed', 'Use POST');

  let body;
  try { body = req.body ?? JSON.parse(req); } catch { return jsonError(res, 400, 'bad_json', 'body must be JSON'); }
  const page = normalizePage(body?.page);

  const { sid } = sessionOf(req, res);

  // 轻限流防滥用（KV 故障时 rateLimit 自动退化单实例；本端点永远不 5xx 打扰用户）
  let limited = false;
  try {
    const { rateLimit } = await import('./_govern.mjs');
    const rl = await rateLimit('visit:' + sid, RL_MAX);
    limited = rl.limited;
  } catch { limited = false; }
  if (limited) return res.status(200).json({ ok: true, persisted: false, reason: 'rate_limited' });

  const r = await recordVisit({ sid, page, kvCmd, kvOk: kvConfigured() });
  return res.status(200).json({ ok: true, persisted: r.persisted, ...(r.reason ? { reason: r.reason } : {}) });
}
