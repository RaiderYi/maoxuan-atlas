// 探针：验证 Vercel 是否支持 .mjs 函数（ESM 语义无歧义）
export const config = { runtime: 'nodejs' };
export default function handler(req, res) {
  res.status(200).json({ ok: true, ext: '.mjs', node: process.version });
}
