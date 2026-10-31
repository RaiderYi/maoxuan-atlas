// R53: /api/stats — 聚合统计（只含匿名计数，不含任何用户内容）
//   visit: 今日/累计 PV·UV 及按页分布;  ai: 今日调用次数/费用/未知费用调用数（复用 ai ledger）+ 预算余量
import { jsonError } from './_lib.mjs';
import { kvCmd, kvConfigured, readUsage, makeCnyBudget } from './_govern.mjs';
import { readVisitStats, dayKeyOf } from './_visit.mjs';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN ?? 'https://aibigplayer.top');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return jsonError(res, 405, 'method_not_allowed', 'Use GET');

  const day = dayKeyOf();
  const kvOk = kvConfigured();
  const [visit, ai, budget] = await Promise.all([
    readVisitStats({ day, kvCmd, kvOk }),
    readUsage(day),
    makeCnyBudget(),
  ]);
  const used = budget.configured ? await budget.used() : null;
  const left = budget.configured ? await budget.left() : null;

  return res.status(200).json({
    schemaVersion: '0.1', ok: true, checkedAt: new Date().toISOString(), day,
    kvConfigured: kvOk,
    visit,
    ai: {
      persisted: !!ai.persisted,
      day: ai.day ?? day,
      calls: Number(ai.calls ?? 0) || 0,
      costCny: ai.cost != null ? Number(ai.cost) : null,          // null = 含未知费用调用, 不是 0
      unknownCostCalls: Number(ai.unknownCostCalls ?? 0) || 0,
      budget: budget.configured
        ? { currency: 'CNY', limit: budget.limit, used, left, period: budget.period, scope: budget.scope }
        : null,
    },
    note: 'PV=页面加载次数（不去重）；UV=当日去重匿名会话；只统计页面路径，不记录任何用户内容',
  });
}
