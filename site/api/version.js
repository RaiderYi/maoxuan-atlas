// A11: /api/version — 线上版本标识（对应 commit，可被页面与排查引用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const config = { runtime: 'nodejs' };
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  path.join(__dirname, '..', 'site', 'data', 'version.json'),
  path.join(__dirname, '..', 'data', 'version.json'),
  '/var/task/data/version.json',
];

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN ?? 'https://aibigplayer.top');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: { code: 'method_not_allowed', message: 'Use GET' } });
    return;
  }
  let file = null;
  for (const p of CANDIDATES) {
    try { file = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch { /* next */ }
  }
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || (file && file.sourceCommit) || null;
  res.status(200).json({
    ok: true,
    schemaVersion: '0.1',
    product: (file && file.product) || 'AIBIGPLAYER V2',
    releaseTag: (file && file.releaseTag) || null,
    builtAt: (file && file.builtAt) || null,
    sourceCommit: commit,
    sourceCommitShort: commit ? String(commit).slice(0, 7) : null,
    environment: process.env.VERCEL_ENV || 'local',
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
    checkedAt: new Date().toISOString(),
  });
}
