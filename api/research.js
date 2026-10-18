// B01: 旧生成入口 /api/research 已收口（不再提供第二条未治理的生成通道）
// 原因：该接口只把问题与范围名称交给模型，没有原文检索、引用校验、调用前预占与台账；
//       若与 /api/ask 共用供应商环境变量，会成为绕过治理的旁路。
// 处置：返回 410 Gone + 迁移说明；保留文件以让旧调用方得到明确结果，而不是 404 猜测。
export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN ?? 'https://aibigplayer.top');
  res.setHeader('Cache-Control', 'no-store');
  res.status(410).json({
    schemaVersion: '0.1',
    ok: false,
    error: {
      code: 'endpoint_retired',
      message: '此接口已停止服务。请改用 /api/ask（带原文检索与引用校验），旧调用不会执行模型生成。',
      replacedBy: '/api/ask',
      since: '2026-10-18',
    },
  });
}
