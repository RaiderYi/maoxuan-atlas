#!/usr/bin/env node
/* H2(R56): 语料明文暂存 —— 从受控正文服务批量取回 217 篇，供自然段产线使用
 * 口径:
 *   · 明文只落 data/corpus-source/（.gitignore 已排除），绝不入库
 *   · 25 篇/批 × 9 请求；已暂存且哈希一致的篇目跳过（可断点续传）
 *   · 每篇校验: 非空、≥200 字符、UTF-8；产出 manifest（id/字符数/sha256）
 * 用法: node pipeline/stage-corpus-217.mjs [--base https://aibigplayer.top] [--force]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BASE = (getArg('--base', process.env.STAGE_BASE || 'https://aibigplayer.top')).replace(/\/+$/, '');
const FORCE = args.includes('--force');

const OUT_DIR = path.join(ROOT, 'data', 'corpus-source');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');
fs.mkdirSync(OUT_DIR, { recursive: true });

// 217 个文章 id 来自 data.js（与 CI 同一解析规则）
const txt = fs.readFileSync(path.join(ROOT, 'site', 'data', 'data.js'), 'utf8');
const DATA = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1));
const ids = DATA.map(a => a.id);
if (ids.length !== 217) { console.error('期望 217 篇，实际 ' + ids.length); process.exit(2); }

const oldManifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { articles: {} };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
let fetched = 0, skipped = 0, failed = [];

const batches = [];
for (let i = 0; i < ids.length; i += 25) batches.push(ids.slice(i, i + 25));

const articles = {};
for (let b = 0; b < batches.length; b++) {
  const batch = batches[b];
  const need = batch.filter(id => {
    if (FORCE) return true;
    const prev = oldManifest.articles?.[id];
    const f = path.join(OUT_DIR, id + '.txt');
    if (!fs.existsSync(f) || !prev) return true;
    const cur = sha(fs.readFileSync(f, 'utf8'));
    if (cur !== prev.sha) return true;
    articles[id] = { chars: prev.chars, sha: prev.sha };
    skipped++;
    return false;
  });
  if (!need.length) { console.log(`批次 ${b + 1}/${batches.length}: 全部已暂存，跳过`); continue; }
  // 单篇也走批量路径（带尾逗号），保证返回 JSON 而非 text/plain
  const url = BASE + '/api/text?id=' + need.join(',') + ',';
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => null);
  if (!j || !j.ok) { console.error(`批次 ${b + 1} 失败: HTTP ${r.status}`); failed.push(...need); continue; }
  for (const id of need) {
    const text = j.texts?.[id];
    if (!text || text.trim().length < 150) { failed.push(id); continue; }   // v5n03 碑文 176 字属正常短篇（见 CONTENT_PACK）
    fs.writeFileSync(path.join(OUT_DIR, id + '.txt'), text, 'utf8');
    const h = sha(text);
    articles[id] = { chars: text.length, sha: h };
    fetched++;
  }
  console.log(`批次 ${b + 1}/${batches.length}: 取回 ${Object.keys(j.texts ?? {}).length} 篇（缺失 ${j.missing?.length ?? 0}）`);
}

const manifest = { builtAt: new Date().toISOString(), base: BASE, total: Object.keys(articles).length, articles };
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1), 'utf8');

const totalChars = Object.values(articles).reduce((n, x) => n + x.chars, 0);
console.log(`\n暂存完成: ${Object.keys(articles).length}/217 篇 · ${totalChars.toLocaleString()} 字 · 新取 ${fetched} · 复用 ${skipped} · 失败 ${failed.length}`);
if (failed.length) { console.error('失败篇目: ' + failed.join(',')); process.exit(1); }
