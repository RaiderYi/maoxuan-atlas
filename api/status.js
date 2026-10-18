// A07: /api/status — 读者可见的服务状态（不含任何配置细节/密钥）
// 前端在提问前读取本接口：ai.enabled=false 时禁用提问并说明原因与替代路径。
import { Budget, loadProviderConfig } from './_lib.js';
import { kvConfigured, makeCnyBudget } from './_govern.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN ?? 'https://aibigplayer.top');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: { code: 'method_not_allowed', message: 'Use GET' } });
    return;
  }
  const budget = await makeCnyBudget();
  let providerOk = true;
  try { loadProviderConfig(); } catch { providerOk = false; }
  const budgetOk = budget.configured && !(await budget.exhausted());
  const enabled = providerOk && budgetOk;

  // 读者可见原因（不含变量名、上游地址、余额等运维细节）
  const spent = budget.configured ? await budget.exhausted() : false;
  let reason = null, reasonCode = null;
  if (!budget.configured) { reasonCode = 'ai_not_configured'; reason = 'AI 问答还没有开放。阅读、摘录、专题与书房不受影响。'; }
  else if (spent) { reasonCode = 'ai_quota_reached'; reason = '本次试用额度已用完，AI 问答暂时关闭。阅读与笔记不受影响。'; }
  else if (!providerOk) { reasonCode = 'ai_unavailable'; reason = 'AI 服务当前不可用。阅读与笔记不受影响。'; }

  res.status(200).json({
    schemaVersion: '0.1',
    ok: true,
    checkedAt: new Date().toISOString(),
    ai: {
      enabled,
      reasonCode,
      reason,
      quota: budget.configured ? {
        currency: 'CNY',
        limit: budget.limit,
        used: await budget.used(),
        left: await budget.left(),
        period: budget.period,
        scope: budget.scope,     // global=跨实例共享; instance=仅本实例（KV 未配置时的诚实标注）
        note: '按 DeepSeek 官方高峰价保守计费，实际以供应商账单为准',
      } : null,
      scopeNote: 'AI 只就两篇样本原文作答，答案必须引用原文段落。',
      readWithoutAi: ['经典研读', '专题四步', '摘录与笔记', '我的书房', '备份与导出'],
    },
    // 以下仅用于管理员诊断（不含任何秘密值），读者界面不展示
    diagnostics: {
      providerConfigured: providerOk,
      budgetConfigured: budget.configured,
      budgetExhausted: budget.configured ? await budget.exhausted() : null,
      budgetScope: budget.scope,
      kvConfigured: kvConfigured(),
      rateLimitScope: kvConfigured() ? 'global' : 'instance',
    },
  });
}
