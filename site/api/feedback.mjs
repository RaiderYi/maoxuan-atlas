// P05.5: /api/feedback — 回答纠错 (引用不相关 / 结论无依据 / 其他)
// 只记录指向具体回答的元数据与用户填写的理由, 不保存完整问题与笔记正文 (P07.3)
import { jsonError, getClientIp, sessionOf } from './_lib.mjs';
import { recordFeedback, kvConfigured } from './_govern.mjs';

export const config = { runtime: 'nodejs' };

const KINDS = new Set(['citation_irrelevant', 'answer_unsupported', 'other']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return jsonError(res, 405, 'method_not_allowed', 'Use POST');
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN ?? 'https://aibigplayer.top');
  res.setHeader('Vary', 'Origin');

  let body;
  try { body = req.body ?? JSON.parse(req); } catch { return jsonError(res, 400, 'bad_json', 'body must be JSON'); }

  const kind = String(body?.kind ?? '');
  if (!KINDS.has(kind)) return jsonError(res, 400, 'bad_kind', 'kind must be citation_irrelevant | answer_unsupported | other');
  const requestId = String(body?.requestId ?? '').trim();
  if (!/^req_[a-f0-9]{16}$/.test(requestId)) return jsonError(res, 400, 'bad_request_id', 'requestId is required');

  const { sid } = sessionOf(req, res);
  const ip = getClientIp(req);
  const out = await recordFeedback({
    requestId,
    kind,
    citationId: body?.citationId ? String(body.citationId).slice(0, 40) : null,
    reason: body?.reason,
    model: body?.model,
    corpusVersion: body?.corpusVersion,
    pipelineVersion: body?.pipelineVersion,
    promptVersion: body?.promptVersion,
    scope: body?.scope,
    sid, ip,   // 仅落日志, 不回传
  });

  return res.status(200).json({ schemaVersion: '0.4', ok: true, persisted: !!out.persisted, kvConfigured: kvConfigured() });
}
