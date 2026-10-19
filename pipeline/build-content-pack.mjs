#!/usr/bin/env node
/* R01/R43: 受控正文内容包产线 — 把本地全文编译成【可提交、不含明文】的内容包
 *
 * 为什么需要它:
 *   site/data/texts/ 因著作权不入公开仓库（.gitignore），但 Vercel 的 Git 自动部署
 *   只部署仓库里的文件 → 切换自动部署后线上正文 404（复审报告 F01）。
 *
 * 方案（复审允许的"私有内容包在构建时注入 / 受控同源内容服务"）:
 *   1. 本地全文 → gzip → AES-256-GCM 加密 → site/data/texts.pack.json（可提交，无明文）
 *   2. 密钥只存在于部署环境变量 TEXT_PACK_KEY（以及本机 data/.textpack.key，已 gitignore）
 *   3. 线上由 /api/text 解密后同源返回，旧地址 /data/texts/{id}.txt 由 vercel.json 重写过去
 *   4. 同时产出 site/data/content-manifest.json（只有哈希与统计，可公开，供发布门槛校验）
 *
 * 用法:
 *   node pipeline/build-content-pack.mjs                  # 用 TEXT_PACK_KEY 或 data/.textpack.key
 *   node pipeline/build-content-pack.mjs --gen-key        # 首次生成密钥（写入 data/.textpack.key）
 *   node pipeline/build-content-pack.mjs --strict         # 任何一篇缺失正文即失败（默认）
 *   node pipeline/build-content-pack.mjs --allow-missing  # 记录缺失但不失败（仅在明确降级时用）
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const DATA = path.join(SITE, 'data');
const TEXTS = path.join(DATA, 'texts');
const PACK_OUT = path.join(DATA, 'texts.pack.json');
const MANIFEST_OUT = path.join(DATA, 'content-manifest.json');
const LOCAL_KEY_FILE = path.join(ROOT, 'data', '.textpack.key');

const args = process.argv.slice(2);
const ALLOW_MISSING = args.includes('--allow-missing');
const GEN_KEY = args.includes('--gen-key');

function readKey() {
  const env = process.env.TEXT_PACK_KEY;
  if (env && env.trim()) {
    const buf = Buffer.from(env.trim(), 'base64');
    if (buf.length !== 32) throw new Error('TEXT_PACK_KEY 必须是 32 字节的 base64（可用 --gen-key 生成）');
    return { key: buf, source: 'env:TEXT_PACK_KEY' };
  }
  if (fs.existsSync(LOCAL_KEY_FILE)) {
    const buf = Buffer.from(fs.readFileSync(LOCAL_KEY_FILE, 'utf8').trim(), 'base64');
    if (buf.length !== 32) throw new Error(LOCAL_KEY_FILE + ' 不是 32 字节的 base64');
    return { key: buf, source: 'file:data/.textpack.key' };
  }
  return null;
}

if (GEN_KEY) {
  if (fs.existsSync(LOCAL_KEY_FILE) && !args.includes('--force')) {
    console.log('已存在 data/.textpack.key，未覆盖（需要重新生成请加 --force）');
    console.log('现有值: ' + fs.readFileSync(LOCAL_KEY_FILE, 'utf8').trim());
    process.exit(0);
  }
  const k = crypto.randomBytes(32).toString('base64');
  fs.mkdirSync(path.dirname(LOCAL_KEY_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_KEY_FILE, k + '\n', 'utf8');
  console.log('已生成密钥 → ' + LOCAL_KEY_FILE);
  console.log('TEXT_PACK_KEY=' + k);
  console.log('把这一行加进 Vercel 项目环境变量（Production/Preview 都要），否则线上无法解密正文。');
  process.exit(0);
}

/* ---------- 1. 读取文章清单（唯一 id 来源：data.js） ---------- */
function readArticles() {
  const p = path.join(DATA, 'data.js');
  const txt = fs.readFileSync(p, 'utf8');
  const start = txt.indexOf('['), end = txt.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('data.js 结构无法解析');
  const arr = JSON.parse(txt.slice(start, end + 1));
  return arr;
}

const articles = readArticles();
if (articles.length !== 217) console.warn(`⚠ data.js 文章数 ${articles.length}（历史基线为 217），请确认这是预期的语料范围`);

const textFiles = fs.existsSync(TEXTS) ? fs.readdirSync(TEXTS).filter(f => f.endsWith('.txt')) : [];
const have = new Set(textFiles.map(f => f.replace(/\.txt$/, '')));

/* ---------- 2. 逐篇加密 ---------- */
const keyInfo = readKey();
if (!keyInfo) {
  console.error('✗ 缺少密钥。先运行: node pipeline/build-content-pack.mjs --gen-key');
  console.error('  然后把 TEXT_PACK_KEY 加进 Vercel 环境变量，再运行本脚本生成内容包。');
  process.exit(2);
}

const missing = [];
const shortArticles = [];
const packEntries = {};
const manifestEntries = {};
let plainBytes = 0, packBytes = 0, plainChars = 0;
const seen = new Set();

for (const a of articles) {
  const id = String(a.id || '');
  if (!/^v[1-5]n\d{2}$/.test(id)) throw new Error('非法文章 id: ' + id);
  if (seen.has(id)) throw new Error('重复文章 id: ' + id);
  seen.add(id);
  const file = path.join(TEXTS, id + '.txt');
  if (!fs.existsSync(file)) { missing.push(id); continue; }
  const raw = fs.readFileSync(file);
  const text = raw.toString('utf8');
  if (!text.trim()) throw new Error(id + '.txt 为空文件');
  /* 短篇是真实存在的（如 v5n03《人民英雄们永垂不朽》碑文仅 176 字），
     所以只拦"明显是占位/截断"的极端情况，短篇另计入 manifest 的 shortArticles 供编辑复核。 */
  if (text.trim().length < 60) throw new Error(`${id}.txt 只有 ${text.trim().length} 字，疑似占位或截断`);
  if (text.trim().length < 300) shortArticles.push({ id, chars: text.trim().length, title: a.title || null });
  // 首行是标题行，正文必须真的包含标题（防止串档）
  const firstLine = text.split(/\r?\n/, 1)[0].trim();
  if (a.title && firstLine && !firstLine.includes(String(a.title).slice(0, 6)) && !text.includes(String(a.title).slice(0, 6))) {
    console.warn(`⚠ ${id}.txt 首行与 data.js 标题不一致: "${firstLine.slice(0, 24)}" vs "${String(a.title).slice(0, 24)}"`);
  }
  const gz = zlib.gzipSync(raw, { level: 9 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyInfo.key, iv);
  const ct = Buffer.concat([cipher.update(gz), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([iv, tag, ct]).toString('base64');
  const h = crypto.createHash('sha256').update(raw).digest('hex');
  const hz = crypto.createHash('sha256').update(Buffer.from(blob, 'base64')).digest('hex');
  packEntries[id] = { h: h.slice(0, 32), z: blob };
  manifestEntries[id] = {
    plainSha256: h, cipherSha256: hz,
    plainBytes: raw.length, plainChars: text.length, packBytes: blob.length,
    title: a.title || null, vol: a.vol ?? null,
  };
  plainBytes += raw.length; packBytes += blob.length; plainChars += text.length;
}

if (missing.length) {
  const msg = `✗ ${missing.length} 篇文章缺少正文文件: ${missing.slice(0, 12).join('、')}${missing.length > 12 ? ' …' : ''}`;
  if (!ALLOW_MISSING) { console.error(msg); console.error('  未加 --allow-missing 时构建失败（R02 发布门槛要求：缺任一必需资源即失败）'); process.exit(1); }
  console.warn(msg + '（已按 --allow-missing 继续，manifest 会记录缺失 id）');
}

const builtAt = new Date().toISOString();
const pack = {
  v: 1, algo: 'aes-256-gcm+gzip', keyId: 'textpack-1', builtAt,
  articleCount: Object.keys(packEntries).length, files: packEntries,
};
const manifest = {
  schema: 'content-manifest@1', builtAt, keyId: pack.keyId, algo: pack.algo,
  keySource: keyInfo.source.replace(/^file:.*/, 'file:data/.textpack.key'),
  declaredArticles: articles.length,
  packedArticles: Object.keys(packEntries).length,
  missingArticles: missing,
  shortArticles,
  plainBytes, packBytes, plainChars,
  packFile: 'site/data/texts.pack.json',
  files: manifestEntries,
};

fs.writeFileSync(PACK_OUT, JSON.stringify(pack));
fs.writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 1) + '\n');

console.log('✓ 内容包已生成');
console.log('  文章: ' + manifest.packedArticles + '/' + manifest.declaredArticles + (missing.length ? `（缺 ${missing.length}）` : ''));
console.log('  明文字数: ' + plainChars.toLocaleString() + ' · 明文 ' + (plainBytes / 1048576).toFixed(2) + ' MB');
console.log('  内容包: ' + (packBytes / 1048576).toFixed(2) + ' MB → ' + path.relative(ROOT, PACK_OUT));
console.log('  清单:   ' + path.relative(ROOT, MANIFEST_OUT));
console.log('  密钥来源: ' + keyInfo.source);
if (missing.length && !ALLOW_MISSING) process.exit(1);
