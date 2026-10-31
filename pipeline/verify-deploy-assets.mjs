#!/usr/bin/env node
/* R02/R03: 发布资产清单与发布前门槛
 *
 * 复审发现的核心问题: CI 只检查 data.js 的 217 条元数据, 正文根本不在部署包里,
 * 于是"CI 全绿 + 线上 8 篇 404"同时成立。本脚本检查的是【真正会被部署的产物】:
 *   · 必需静态文件存在
 *   · data.js 声明的每篇正文都在内容包里 (缺一篇即失败)
 *   · 内容包每篇密文哈希与 content-manifest 一致 (不需要密钥)
 *   · 有密钥时逐篇解密并核对明文哈希 (本地/可持密钥的环境)
 *   · 人物肖像资源真实存在
 *   · vercel.json 有正文 rewrite 与 API 函数包含配置
 *   · api/ 目录只允许生产端点 (测试与诊断脚本不得成为生产函数)
 *
 * 用法: node pipeline/verify-deploy-assets.mjs [--strict-key] [--quiet]
 * 退出码: 0 通过 / 1 资产不达标 / 2 用法错误
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
const args = process.argv.slice(2);
const STRICT_KEY = args.includes('--strict-key');
const QUIET = args.includes('--quiet');

const errors = [];
const warns = [];
const ok = (m) => { if (!QUIET) console.log('  ✓ ' + m); };
const bad = (m) => { errors.push(m); console.log('  ✗ ' + m); };
const warn = (m) => { warns.push(m); console.log('  ! ' + m); };

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

/* ---------- 1. 必需文件 ---------- */
console.log('[1/7] 必需静态文件');
const REQUIRED = [
  'index.html', 'app.js', 'quiz.html', 'research.html', 'sw.js', 'vercel.json',
  'data/data.js', 'data/portraits.json', 'data/quiz.json', 'data/sample-topic.json',
  'data/topic-jgs.json', 'data/texts.pack.json', 'data/content-manifest.json',
  'data/anchor-map.json',
  'lib/mx-store.js', 'lib/mx-evidence.js',
  'icons/icon-32.png', 'icons/favicon-32.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/icon-192-maskable.png', 'icons/icon-512-maskable.png', 'icons/apple-touch-icon.png',
  'api/text.mjs', 'api/ask.mjs', 'api/version.mjs', 'api/status.mjs',
];
for (const rel of REQUIRED) {
  const p = path.join(SITE, rel);
  if (!fs.existsSync(p)) { bad('缺少部署必需文件: site/' + rel); continue; }
  if (fs.statSync(p).size === 0) { bad('文件为空: site/' + rel); continue; }
  ok('site/' + rel);
}

/* 1b. manifest / index.html 里声明的图标必须真的存在
   —— 2026-10-20 线上实测 7 个图标全是 404：仓库里根本没带 icons/，
      而此前的门禁只看正文与肖像，所以"装得上但装不上桌面"没人发现。 */
console.log('[1b/7] PWA 图标与 HTML 引用');
try {
  const mf = readJson(path.join(SITE, 'manifest.webmanifest'));
  for (const ic of (mf.icons || [])) {
    const rel = String(ic.src || '').replace(/^\.?\//, '');
    if (!rel) continue;
    const p = path.join(SITE, rel);
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) bad('manifest 声明的图标缺失: site/' + rel);
    else ok('manifest 图标 ' + rel);
  }
} catch (e) {
  bad('manifest.webmanifest 无法解析: ' + e.message);
}
try {
  const idx = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  const refs = [...idx.matchAll(/<link[^>]+href=["']([^"']+\.(?:png|ico|svg))["']/gi)].map(m => m[1]);
  for (const rel of new Set(refs)) {
    if (/^https?:/i.test(rel)) continue;
    const p = path.join(SITE, rel.replace(/^\.?\//, ''));
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) bad('index.html 引用的图标缺失: ' + rel);
    else ok('html 图标 ' + rel);
  }
} catch (e) {
  bad('index.html 无法读取: ' + e.message);
}

/* ---------- 2. 文章清单 ---------- */
console.log('[2/7] data.js 文章清单');
let articles = [];
try {
  const txt = fs.readFileSync(path.join(DATA, 'data.js'), 'utf8');
  articles = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1));
  if (articles.length !== 217) warn(`data.js 文章数 ${articles.length}（基线 217）`);
  const ids = new Set(articles.map(a => a.id));
  if (ids.size !== articles.length) bad('data.js 存在重复 id');
  else ok(`${articles.length} 篇, id 唯一`);
} catch (e) { bad('data.js 无法解析: ' + e.message); }

/* ---------- 3. 内容包覆盖 ---------- */
console.log('[3/7] 内容包覆盖与结构');
let pack = null, manifest = null;
try { pack = readJson(path.join(DATA, 'texts.pack.json')); } catch (e) { bad('内容包无法读取: ' + e.message); }
try { manifest = readJson(path.join(DATA, 'content-manifest.json')); } catch (e) { bad('内容清单无法读取: ' + e.message); }

if (pack && manifest) {
  if (pack.algo !== 'aes-256-gcm+gzip') bad('内容包算法不是 aes-256-gcm+gzip: ' + pack.algo);
  else ok('内容包算法 ' + pack.algo);
  if (manifest.missingArticles && manifest.missingArticles.length) bad(`${manifest.missingArticles.length} 篇声明文章缺正文: ${manifest.missingArticles.slice(0, 8).join('、')}`);
  else ok('内容清单未记录缺失文章');
  const missing = articles.map(a => a.id).filter(id => !pack.files[id]);
  if (missing.length) bad(`${missing.length}/${articles.length} 篇正文不在内容包内: ${missing.slice(0, 8).join('、')}`);
  else ok(`内容包覆盖全部 ${articles.length} 篇`);
  if (pack.articleCount !== Object.keys(pack.files).length) bad('articleCount 与实际条目数不一致');
  if (pack.articleCount !== articles.length) warn(`内容包条目 ${pack.articleCount} ≠ data.js ${articles.length}`);
  if (manifest.packedArticles !== Object.keys(pack.files).length) bad('manifest.packedArticles 与实际条目数不一致');
}

/* ---------- 4. 密文哈希 (不需要密钥) ---------- */
console.log('[4/7] 内容包密文哈希');
if (pack && manifest) {
  let mism = 0, tiny = 0;
  for (const [id, entry] of Object.entries(pack.files)) {
    const blob = Buffer.from(entry.z, 'base64');
    const h = crypto.createHash('sha256').update(blob).digest('hex');
    if (manifest.files[id] && manifest.files[id].cipherSha256 !== h) mism++;
    if (blob.length < 200) tiny++;
  }
  if (mism) bad(`${mism} 篇密文哈希与 content-manifest 不一致（内容包被改动但清单没重建）`);
  else ok('全部密文哈希与清单一致');
  if (tiny) warn(`${tiny} 篇内容包条目小于 200 字节，请确认是真实短篇`);
}

/* ---------- 5. 解密与明文哈希 (有密钥时) ---------- */
console.log('[5/7] 解密校验');
let key = null;
if (process.env.TEXT_PACK_KEY) {
  const b = Buffer.from(process.env.TEXT_PACK_KEY.trim(), 'base64');
  if (b.length === 32) key = b; else bad('TEXT_PACK_KEY 不是 32 字节 base64');
} else {
  const kf = path.join(ROOT, 'data', '.textpack.key');
  if (fs.existsSync(kf)) {
    const b = Buffer.from(fs.readFileSync(kf, 'utf8').trim(), 'base64');
    if (b.length === 32) key = b;
  }
}
if (!key) {
  const m = '没有可用密钥（TEXT_PACK_KEY / data/.textpack.key），跳过解密校验（生产环境必须在 Vercel 配置 TEXT_PACK_KEY）';
  STRICT_KEY ? bad(m) : warn(m);
} else if (pack && manifest) {
  let fail = 0, sample = null;
  for (const [id, entry] of Object.entries(pack.files)) {
    try {
      const blob = Buffer.from(entry.z, 'base64');
      const d = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
      d.setAuthTag(blob.subarray(12, 28));
      const plain = zlib.gunzipSync(Buffer.concat([d.update(blob.subarray(28)), d.final()]));
      const h = crypto.createHash('sha256').update(plain).digest('hex');
      if (manifest.files[id] && manifest.files[id].plainSha256 !== h) { fail++; sample = sample || id; }
      if (plain.length < 60) { fail++; sample = sample || id; }
    } catch (e) { fail++; sample = sample || (id + ':' + e.message); }
  }
  if (fail) bad(`${fail} 篇解密失败或明文哈希不符（示例 ${sample}）—— 密钥与内容包不匹配`);
  else ok(`${Object.keys(pack.files).length} 篇全部解密成功且明文哈希一致`);
}

/* ---------- 6. 肖像与 2D 资源 ---------- */
console.log('[5b/7] 锚点映射');
try {
  const am = readJson(path.join(DATA, 'anchor-map.json'));
  if (am.mismatches && am.mismatches.length) {
    bad(`锚点映射有 ${am.mismatches.length} 处失配（人物卡可能跳到错误段落）: ` +
      am.mismatches.slice(0, 3).map(m => m.articleId + ' ' + m.anchor).join('、'));
  } else ok('锚点映射无失配（' + (am.entries || []).length + ' 条卡片锚点）');
  const unverified = (am.entries || []).filter(e => e.status === 'quote-not-in-text').length;
  if (unverified) warn(`${unverified} 条卡片引文在当前正文中找不到（已取消锚点，需编辑核对）`);
} catch (e) { warn('anchor-map.json 无法读取: ' + e.message); }

/* ---------- 6. 肖像与 2D 资源 ---------- */
console.log('[6/7] 人物肖像资源');
try {
  const pr = readJson(path.join(DATA, 'portraits.json'));
  const list = Array.isArray(pr) ? pr : (pr.portraits || Object.values(pr));
  const files = [];
  const walk = (v, key) => {
    if (!v) return;
    if (typeof v === 'string') {
      // 只看真正的本地资源路径；portraits.json 里的 source/credit 字段带 Commons 文件名与 URL
      if (/^(\.?\/)?(assets|data|icons|lib)\//i.test(v) && /\.(png|jpe?g|webp|svg)$/i.test(v)) files.push(v);
      return;
    }
    if (Array.isArray(v)) { v.forEach(x => walk(x, key)); return; }
    if (typeof v === 'object') for (const [k, vv] of Object.entries(v)) walk(vv, k);
  };
  walk(pr, null);
  const uniq = [...new Set(files)];
  let miss = 0;
  for (const f of uniq) {
    const rel = f.replace(/^\.?\//, '');
    const p = path.join(SITE, rel);
    if (!fs.existsSync(p)) { miss++; if (miss <= 5) bad('肖像文件缺失: site/' + rel); }
  }
  if (!uniq.length) warn('portraits.json 中没有找到图片路径');
  else if (!miss) ok(`${uniq.length} 个肖像资源存在`);
} catch (e) { warn('portraits.json 无法解析: ' + e.message); }

/* ---------- 7. 部署配置与 API 入口 ---------- */
console.log('[7/7] 部署配置与 API 入口');
try {
  const vc = readJson(path.join(SITE, 'vercel.json'));
  const rewrites = vc.rewrites || [];
  const hasTextRewrite = rewrites.some(r => /data\/texts/.test(r.source || '') && /api\/text/.test(r.destination || ''));
  hasTextRewrite ? ok('vercel.json 含 /data/texts/* → /api/text 重写（旧地址兼容）') : bad('vercel.json 缺少 /data/texts/* → /api/text 重写');
  const includes = JSON.stringify(vc.functions || {});
  if (/includeFiles/.test(includes)) ok('vercel.json 为正文接口声明了 includeFiles'); else warn('vercel.json 未声明 includeFiles，函数可能拿不到内容包（依赖 nft 静态追踪）');
} catch (e) { bad('vercel.json 无法解析: ' + e.message); }

const apiDir = path.join(SITE, 'api');
const prodEndpoints = new Set(['_ask.mjs', '_govern.mjs', '_lib.mjs', '_retrieval.mjs', '_solve.mjs', '_visit.mjs', 'ask.mjs', 'feedback.mjs', 'ping.mjs', 'research.mjs', 'solve.mjs', 'stats.mjs', 'status.mjs', 'text.mjs', 'version.mjs', 'visit.mjs']);
const strays = fs.readdirSync(apiDir).filter(f => !prodEndpoints.has(f));
if (strays.length) bad('api/ 存在非生产入口（测试/诊断会变成公开函数）: ' + strays.join('、'));
else ok('api/ 只有 ' + prodEndpoints.size + ' 个受控入口');

/* ---------- 汇总 ---------- */
console.log('\n===== 发布资产门槛 =====');
console.log(`检查项: ${errors.length} 错误 / ${warns.length} 警告`);
if (warns.length) for (const w of warns) console.log('  ! ' + w);
if (errors.length) {
  for (const e of errors) console.log('  ✗ ' + e);
  console.log('\n✗ 发布资产不达标 —— 该构建不得接管生产（R03）');
  process.exit(1);
}
console.log('✓ 发布资产达标');
process.exit(0);
