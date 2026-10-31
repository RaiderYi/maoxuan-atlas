#!/usr/bin/env node
/* H2(R56): 自然段语料产线 —— data/corpus-source/*.txt → site/data/corpus-full.pack.json（加密入仓）
 * 模型: 一行 = 一个自然段（与 /api/text 及前端渲染口径一致）；题注/日期行保留（利于篇级检索）
 * ID:   pv{n卷}{n篇}-{序号3位}（兼容既有引用正则 /^p(v\d+n\d+)-.*$/）
 * 加密: aes-256-gcm + gzip（与 texts.pack 同方案）；密钥 data/.corpuspack.key（不存在则生成）
 * 明文: 只存在于本机 data/corpus-source/（gitignore），密文包入仓
 * 用法: node pipeline/build-corpus-217.mjs [--force]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'corpus-source');
const OUT = path.join(ROOT, 'site', 'data', 'corpus-full.pack.json');
const KEY_FILE = path.join(ROOT, 'data', '.corpuspack.key');
const FORCE = process.argv.includes('--force');

// ---------- 可测试的纯函数 ----------
const SECTION_RE = /^[一二三四五六七八九十]{1,3}[　\s]/;   // 节标题（如"一　国内的政治状况"）

/** 行 → 语义块：标题/日期/节标题独立；正文按"≥120字且句末标点"合并（上限400字强制切）
 *  说明: PDF 折行丢失了自然段边界，此启发式只为检索语义聚拢；
 *        引用校验与原文定位都按文本回查，与切块方式自洽（见 docs/RETRIEVAL_EVAL）。 */
export function mergeParagraphs(lines) {
  const nonEmpty = String(lines ?? '').replace(/\r\n?/g, '\n').split('\n')
    .map(s => s.trim()).filter(s => s.length > 0);
  if (!nonEmpty.length) return [];
  const chunks = [];
  // 头部: 标题 + 日期行独立成块（利于篇级检索）
  let i = 0;
  while (i < Math.min(nonEmpty.length, 3) && (chunks.length === 0 || nonEmpty[i].startsWith('（') && chunks.length === 1)) {
    chunks.push({ kind: 'head', text: nonEmpty[i] }); i++;
  }
  let buf = [], bufLen = 0;
  const flush = () => { if (buf.length) { chunks.push({ kind: 'body', text: buf.join('') }); buf = []; bufLen = 0; } };
  for (; i < nonEmpty.length; i++) {
    const line = nonEmpty[i];
    if (SECTION_RE.test(line)) { flush(); chunks.push({ kind: 'section', text: line }); continue; }
    buf.push(line); bufLen += line.length;
    const endsSentence = /[。！？；："”』」]$/.test(line);
    if ((bufLen >= 120 && endsSentence) || bufLen >= 400) flush();
  }
  flush();
  return chunks.map(c => c.text);
}

export function buildCorpusJson(staged, metaList, { builtAt } = {}) {
  const metaById = new Map(metaList.map(m => [m.id, m]));
  const articles = {}, paragraphs = [];
  for (const m of metaList) {
    const text = staged[m.id];
    if (!text) continue;
    const paras = mergeParagraphs(text);
    articles[m.id] = { title: m.title, vol: m.vol, date: m.date ?? null, paragraphCount: paras.length };
    paras.forEach((p, i) => {
      paragraphs.push({ id: `p${m.id}-${String(i + 1).padStart(3, '0')}`, articleId: m.id, seq: i + 1, text: p });
    });
  }
  const totalChars = paragraphs.reduce((n, p) => n + p.text.length, 0);
  const body = JSON.stringify({ articles, paragraphs });
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  return {
    version: 'corpus-full-r1',
    builtAt: builtAt ?? new Date().toISOString(),
    articleCount: Object.keys(articles).length,
    paragraphCount: paragraphs.length,
    totalChars,
    sha256,
    articles,
    paragraphs,
    _integrity: sha256.slice(0, 20),
  };
}

export function encryptPack(json, keyB64) {
  const key = Buffer.from(String(keyB64).trim(), 'base64');
  if (key.length !== 32) throw new Error('corpus key must be 32 bytes base64');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(json), 'utf8'));
  const ct = Buffer.concat([cipher.update(gz), cipher.final()]);
  return {
    algo: 'aes-256-gcm+gzip',
    keyId: 'corpus-v1',
    builtAt: json.builtAt,
    articleCount: json.articleCount,
    paragraphCount: json.paragraphCount,
    totalChars: json.totalChars,
    sha256: json.sha256,
    blob: { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), z: ct.toString('base64') },
  };
}

export function decryptPack(pack, keyB64) {
  const key = Buffer.from(String(keyB64).trim(), 'base64');
  if (key.length !== 32) throw new Error('corpus key must be 32 bytes base64');
  const blob = Buffer.from(pack.blob.z, 'base64');
  const iv = Buffer.from(pack.blob.iv, 'base64');
  const tag = Buffer.from(pack.blob.tag, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  const gz = Buffer.concat([d.update(blob), d.final()]);
  return JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
}

// ---------- 产线执行（仅直接运行时；被 import 只提供纯函数，零副作用） ----------
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(process.argv[1]).href === __filename) {
runMain();
}
function runMain() {
const rawTxt = fs.readFileSync(path.join(ROOT, 'site', 'data', 'data.js'), 'utf8');
const raw = JSON.parse(rawTxt.slice(rawTxt.indexOf('['), rawTxt.lastIndexOf(']') + 1));   // 与 CI 同一解析规则
const metaList = raw.map(a => ({ id: a.id, title: a.title, vol: a.vol, date: a.dateRaw ?? (a.date?.raw ?? null) }));

const staged = {};
for (const m of metaList) {
  const f = path.join(SRC, m.id + '.txt');
  if (!fs.existsSync(f)) { console.error('缺少暂存文件: ' + m.id); process.exit(2); }
  staged[m.id] = fs.readFileSync(f, 'utf8');
}

if (!fs.existsSync(KEY_FILE)) {
  const k = crypto.randomBytes(32).toString('base64');
  fs.writeFileSync(KEY_FILE, k, 'utf8');
  console.log('已生成新密钥 data/.corpuspack.key（请将其配置为 Vercel 环境变量 CORPUS_PACK_KEY，值不回显）');
}
const keyB64 = fs.readFileSync(KEY_FILE, 'utf8');

const json = buildCorpusJson(staged, metaList);
const pack = encryptPack(json, keyB64);
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
if (!FORCE && prev && prev.sha256 === pack.sha256) {
  console.log('语料内容无变化，跳过写包（--force 强制重写）');
} else {
  fs.writeFileSync(OUT, JSON.stringify(pack), 'utf8');
}

console.log(`语料包: ${pack.articleCount} 篇 · ${pack.paragraphCount} 个自然段 · ${pack.totalChars.toLocaleString()} 字`);
console.log(`密文包: site/data/corpus-full.pack.json (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB) · sha256 ${pack.sha256.slice(0, 16)}…`);
const lens = json.paragraphs.map(p => p.text.length);
const avg = Math.round(lens.reduce((a, b) => a + b, 0) / lens.length);
console.log(`自然段长度: 均值 ${avg} 字 · 最短 ${Math.min(...lens)} · 最长 ${Math.max(...lens)}`);
}
