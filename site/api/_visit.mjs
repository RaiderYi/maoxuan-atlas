// R53: 访问统计共享模块 —— 匿名 PV/UV（mx_sid Cookie），只记页面路径，不记任何内容数据
// 设计口径:
//   · PV = 每次页面加载 +1（不去重，诚实口径）；UV = 当日去重匿名会话（SADD sid）
//   · day = UTC 日（与 ai ledger 同口径）；键 90 天过期，总计键不过期
//   · KV 故障 → persisted:false，绝不影响浏览（统计是非关键路径，fail-open）
//   · 全部键带 mx: 前缀命名空间
export const VISIT_PAGES = ['index', 'research', 'solve', 'quiz'];
const NS = 'mx:';

export function normalizePage(x) {
  const p = String(x ?? '').trim().toLowerCase();
  return VISIT_PAGES.includes(p) ? p : 'other';
}

export function dayKeyOf(date) {
  const d = date ?? new Date();
  return d.toISOString().slice(0, 10);
}

export function keysFor(day) {
  return { pv: `${NS}visit:pv:${day}`, uv: `${NS}visit:uv:${day}` };
}
export const TOTAL_KEYS = { pv: `${NS}visit:pv:total`, uv: `${NS}visit:uv:total` };
const TTL = String(60 * 60 * 24 * 90);

/**
 * 记一次访问。kvCmd/kvOk 由调用方注入（便于离线测试）。
 * @returns {Promise<{persisted:boolean, reason?:string}>}
 */
export async function recordVisit({ sid, page, kvCmd, kvOk }) {
  const p = normalizePage(page);
  const day = dayKeyOf();
  if (!kvOk || !kvCmd) return { persisted: false, reason: 'kv_not_configured' };
  const k = keysFor(day);
  try {
    await kvCmd(['HINCRBY', k.pv, p, '1']);
    await kvCmd(['EXPIRE', k.pv, TTL]);
    await kvCmd(['SADD', k.uv, String(sid ?? 'anon')]);
    await kvCmd(['EXPIRE', k.uv, TTL]);
    await kvCmd(['HINCRBY', TOTAL_KEYS.pv, p, '1']);
    await kvCmd(['SADD', TOTAL_KEYS.uv, String(sid ?? 'anon')]);
    return { persisted: true };
  } catch (e) {
    return { persisted: false, reason: String(e.message ?? e) };
  }
}

/** HGETALL 数组 → {page:count} */
export function hashToObj(arr) {
  const out = {};
  const a = Array.isArray(arr) ? arr : [];
  for (let i = 0; i < a.length; i += 2) out[a[i]] = Number(a[i + 1]) || 0;
  return out;
}

/**
 * 读某日统计 + 累计。读失败返回 persisted:false（调用方如实展示）。
 */
export async function readVisitStats({ day, kvCmd, kvOk }) {
  const d = day ?? dayKeyOf();
  if (!kvOk || !kvCmd) return { persisted: false, day: d };
  try {
    const k = keysFor(d);
    const [pvDay, uvDay, pvTotal, uvTotal] = await Promise.all([
      kvCmd(['HGETALL', k.pv]), kvCmd(['SCARD', k.uv]),
      kvCmd(['HGETALL', TOTAL_KEYS.pv]), kvCmd(['SCARD', TOTAL_KEYS.uv]),
    ]);
    const sum = (o) => Object.values(o).reduce((n, x) => n + x, 0);
    const byPage = hashToObj(pvDay.result);
    const byPageTotal = hashToObj(pvTotal.result);
    return {
      persisted: true, day: d,
      today: { pv: sum(byPage), pvByPage: byPage, uv: Number(uvDay.result ?? 0) },
      total: { pv: sum(byPageTotal), pvByPage: byPageTotal, uv: Number(uvTotal.result ?? 0) },
    };
  } catch (e) {
    return { persisted: false, day: d, error: String(e.message ?? e) };
  }
}
