// H2(R56): 217 篇全量语料装载器 —— 解密 corpus-full.pack.json → 检索语料
// 口径:
//   · 密钥: 环境变量 CORPUS_PACK_KEY（base64 32B）；本机开发回落 data/.corpuspack.key
//   · 密钥/包任一缺失 → 返回 null（handler 回退 sample-topic，诚实标注 corpusMode）
//   · 解密校验 sha256 不匹配 → 视为包损坏，同样回退并告警（绝不静默用错语料）
//   · 模块级缓存: 冷启动解密一次，后续请求零开销
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { bigrams } from './_ask.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK_CANDIDATES = [
  path.join(__dirname, '..', 'data', 'corpus-full.pack.json'),
  path.join(process.cwd(), 'data', 'corpus-full.pack.json'),
  '/var/task/data/corpus-full.pack.json',
  path.join(__dirname, '..', 'site', 'data', 'corpus-full.pack.json'),
];
const KEY_CANDIDATES = [
  path.join(process.cwd(), 'data', '.corpuspack.key'),
  path.join(__dirname, '..', '..', 'data', '.corpuspack.key'),
];

function loadKey(envKey) {
  const fromEnv = envKey ?? process.env.CORPUS_PACK_KEY;
  if (fromEnv && fromEnv.trim()) {
    const buf = Buffer.from(fromEnv.trim(), 'base64');
    if (buf.length === 32) return buf;
  }
  for (const p of KEY_CANDIDATES) {
    try {
      const buf = Buffer.from(fs.readFileSync(p, 'utf8').trim(), 'base64');
      if (buf.length === 32) return buf;
    } catch { /* next */ }
  }
  return null;
}

function loadPack(packPath) {
  for (const p of (packPath ? [packPath] : PACK_CANDIDATES)) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (j && j.algo === 'aes-256-gcm+gzip' && j.blob) return j;
    } catch { /* next */ }
  }
  return null;
}

function decrypt(pack, key) {
  const blob = Buffer.from(pack.blob.z, 'base64');
  const iv = Buffer.from(pack.blob.iv, 'base64');
  const tag = Buffer.from(pack.blob.tag, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  const gz = Buffer.concat([d.update(blob), d.final()]);
  return JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
}

/**
 * 装载全量语料。opts: {packPath, keyB64} 供测试注入。
 * @returns {null | {corpus, articleMeta, corpusVersion, avgParaChars, paragraphCount, articleCount}}
 */
let CACHE = null;
export function loadCorpusFull(opts = {}) {
  if (CACHE && !opts.packPath && !opts.keyB64) return CACHE;
  const pack = loadPack(opts.packPath);
  const key = loadKey(opts.keyB64);
  if (!pack || !key) return null;
  let json;
  try { json = decrypt(pack, key); } catch (e) {
    console.log(JSON.stringify({ t: 'corpus_full_decrypt_failed', msg: String(e.message) }));
    return null;
  }
  // 完整性: 明文哈希必须与包声明一致（不一致 = 包损坏/被替换，拒绝使用）
  const body = JSON.stringify({ articles: json.articles, paragraphs: json.paragraphs });
  const sha = crypto.createHash('sha256').update(body).digest('hex');
  if (pack.sha256 && sha !== pack.sha256) {
    console.log(JSON.stringify({ t: 'corpus_full_integrity_failed', expected: pack.sha256?.slice(0, 12), got: sha.slice(0, 12) }));
    return null;
  }
  const corpus = json.paragraphs.map(p => ({
    id: p.id, articleId: p.articleId, seq: p.seq, text: p.text,
    _g: bigrams(p.text), _sec: '',
  }));
  const articleMeta = {};
  for (const [id, a] of Object.entries(json.articles)) {
    articleMeta[id] = { title: a.title, date: a.date ?? '', vol: a.vol ?? null };
  }
  const totalChars = json.totalChars ?? corpus.reduce((n, p) => n + p.text.length, 0);
  const out = {
    corpus,
    articleMeta,
    corpusVersion: `corpus-full:${(pack.sha256 ?? sha).slice(0, 16)}:articles=${json.articleCount}:paras=${json.paragraphCount}`,
    avgParaChars: Math.max(1, Math.round(totalChars / corpus.length)),
    paragraphCount: corpus.length,
    articleCount: json.articleCount,
  };
  if (!opts.packPath && !opts.keyB64) CACHE = out;
  return out;
}
