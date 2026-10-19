// R01: /api/text — 受控同源正文服务
//
// 背景: 全文因著作权不入公开仓库，Vercel 只部署仓库文件 → /data/texts/*.txt 全部 404。
// 本接口从【已提交的加密内容包】(site/data/texts.pack.json) 解密后返回正文:
//   · 明文不进仓库，密钥只在部署环境变量 TEXT_PACK_KEY
//   · 旧地址 /data/texts/{id}.txt 由 vercel.json rewrite 到本接口，旧链接/旧缓存不失效
//   · 没有密钥或内容包缺失时返回 503 且说明原因，绝不返回空正文冒充成功
//   · 开发环境（本机没有 TEXT_PACK_KEY 但有明文 txt）直接回落到明文，便于本地调试
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ID_RE = /^v[1-5]n\d{2}$/;

const PACK_CANDIDATES = [
  path.join(__dirname, '..', 'data', 'texts.pack.json'),
  path.join(process.cwd(), 'data', 'texts.pack.json'),
  '/var/task/data/texts.pack.json',
  path.join(__dirname, '..', 'site', 'data', 'texts.pack.json'),
];
const KEY_CANDIDATES = [
  path.join(process.cwd(), 'data', '.textpack.key'),
  path.join(__dirname, '..', '..', 'data', '.textpack.key'),
];

let PACK = null;
let PACK_PATH = null;

function loadPack() {
  if (PACK) return PACK;
  for (const p of PACK_CANDIDATES) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (j && j.files && j.algo === 'aes-256-gcm+gzip') { PACK = j; PACK_PATH = p; return PACK; }
    } catch { /* try next */ }
  }
  return null;
}

function loadKey() {
  const env = process.env.TEXT_PACK_KEY;
  if (env && env.trim()) {
    const buf = Buffer.from(env.trim(), 'base64');
    if (buf.length === 32) return buf;
  }
  // 仅开发/本机使用；生产部署包不含该文件（已 gitignore）
  for (const p of KEY_CANDIDATES) {
    try {
      const buf = Buffer.from(fs.readFileSync(p, 'utf8').trim(), 'base64');
      if (buf.length === 32) return buf;
    } catch { /* try next */ }
  }
  return null;
}

const cache = new Map();          // id → { text, etag }
const CACHE_MAX = 24;

function decryptEntry(entry, key) {
  const blob = Buffer.from(entry.z, 'base64');
  if (blob.length < 28) throw new Error('pack entry too short');
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  const gz = Buffer.concat([d.update(ct), d.final()]);
  return zlib.gunzipSync(gz).toString('utf8');
}

function plaintextFallback(id) {
  const cands = [
    path.join(__dirname, '..', 'data', 'texts', id + '.txt'),
    path.join(process.cwd(), 'data', 'texts', id + '.txt'),
    path.join(process.cwd(), 'site', 'data', 'texts', id + '.txt'),
  ];
  for (const p of cands) {
    try { return { text: fs.readFileSync(p, 'utf8'), source: 'plaintext' }; } catch { /* next */ }
  }
  return null;
}

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}

export default async function handler(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return send(res, 405, JSON.stringify({ ok: false, error: { code: 'method_not_allowed' } }),
      { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET, HEAD' });
  }

  const url = new URL(req.url || '/', 'http://localhost');
  const raw = String(url.searchParams.get('id') ?? url.searchParams.get('file') ?? '').trim();
  const idParam = raw.replace(/\.txt$/i, '').replace(/^\/+/, '');
  const id = idParam;
  const check = url.searchParams.get('check');

  /* 运维自检: /api/text?check=1 只报告能力, 不返回正文 */
  if (check) {
    const pack = loadPack();
    const key = loadKey();
    return send(res, 200, JSON.stringify({
      ok: !!(pack && key),
      packFound: !!pack, packPath: PACK_PATH ? path.basename(PACK_PATH) : null,
      keyConfigured: !!key,
      keySource: process.env.TEXT_PACK_KEY ? 'env' : (key ? 'local-file(dev)' : 'none'),
      articleCount: pack?.articleCount ?? 0, builtAt: pack?.builtAt ?? null, algo: pack?.algo ?? null,
      plaintextFallback: !!plaintextFallback('v1n03'),
    }), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  }

  const noStore = { 'Cache-Control': 'no-store' };

  /* 批量读取（检索预载用）：id=v1n03,v1n04,… 最多 25 篇，返回 JSON。
     217 篇逐个请求会打爆函数调用量与延迟，批量接口把 217 次降到 9 次。 */
  if (idParam.includes(',')) {
    const ids = idParam.split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length || ids.length > 25) {
      return send(res, 400, JSON.stringify({ ok: false, error: { code: 'bad_batch', message: '批量 id 数量必须在 1—25 之间' } }),
        { 'Content-Type': 'application/json; charset=utf-8', ...noStore });
    }
    const bpack = loadPack();
    const bkey = loadKey();
    const texts = {}; const missing = [];
    for (const one of ids) {
      if (!ID_RE.test(one)) { missing.push(one); continue; }
      const c = cache.get(one);
      if (c) { texts[one] = c.text; continue; }
      if (bpack && bkey && bpack.files[one]) {
        try {
          const text = decryptEntry(bpack.files[one], bkey);
          const etag = '"' + crypto.createHash('sha256').update(text).digest('hex').slice(0, 24) + '"';
          if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
          cache.set(one, { text, etag });
          texts[one] = text;
          continue;
        } catch { missing.push(one); continue; }
      }
      const p = plaintextFallback(one);
      if (p) { texts[one] = p.text; continue; }
      missing.push(one);
    }
    return send(res, 200, JSON.stringify({ ok: true, count: Object.keys(texts).length, texts, missing }),
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300, must-revalidate' });
  }

  if (!ID_RE.test(id)) {
    return send(res, 400, JSON.stringify({ ok: false, error: { code: 'bad_id', message: '文章 id 形如 v1n03' } }),
      { 'Content-Type': 'application/json; charset=utf-8', ...noStore });
  }

  /* 1) 内存缓存 */
  const hit = cache.get(id);
  if (hit) return respond(req, res, id, hit.text, hit.etag, method);

  /* 2) 加密内容包（生产路径） */
  const pack = loadPack();
  const key = loadKey();
  if (pack && key && pack.files[id]) {
    try {
      const text = decryptEntry(pack.files[id], key);
      const etag = '"' + crypto.createHash('sha256').update(text).digest('hex').slice(0, 24) + '"';
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(id, { text, etag });
      return respond(req, res, id, text, etag, method);
    } catch (e) {
      // 解密失败必须显式失败（可能是密钥不对/内容包损坏），不得回落到明文冒充正常
      return send(res, 503, JSON.stringify({
        ok: false, error: { code: 'text_decrypt_failed', message: '正文内容包无法解密，请检查 TEXT_PACK_KEY 是否与构建时一致。' },
      }), { 'Content-Type': 'application/json; charset=utf-8', ...noStore });
    }
  }

  /* 3) 开发环境明文回落 */
  const plain = plaintextFallback(id);
  if (plain) {
    const etag = '"' + crypto.createHash('sha256').update(plain.text).digest('hex').slice(0, 24) + '"';
    return respond(req, res, id, plain.text, etag, method);
  }

  /* 4) 如实告知不可用（绝不用占位正文冒充 200） */
  const reason = !pack ? 'pack_missing' : (!key ? 'key_missing' : 'article_not_in_pack');
  return send(res, 503, JSON.stringify({
    ok: false,
    error: {
      code: 'text_unavailable',
      message: !key
        ? '正文服务尚未配置密钥（TEXT_PACK_KEY），当前无法提供原文。阅读进度与笔记不受影响。'
        : '该篇正文不在当前发布的内容包内。',
      reason,
    },
  }), { 'Content-Type': 'application/json; charset=utf-8', ...noStore });
}

function respond(req, res, id, text, etag, method) {
  const inm = req.headers?.['if-none-match'];
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'public, max-age=86400, must-revalidate',
    ETag: etag,
    'X-Text-Id': id,
    'X-Content-Type-Options': 'nosniff',
  };
  if (inm && inm.split(',').map(s => s.trim()).includes(etag)) {
    res.statusCode = 304;
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    return res.end();
  }
  if (method === 'HEAD') {
    res.statusCode = 200;
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.setHeader('Content-Length', String(Buffer.byteLength(text)));
    return res.end();
  }
  return send(res, 200, text, headers);
}

export const config = { runtime: 'nodejs' };
