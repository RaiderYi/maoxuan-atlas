#!/usr/bin/env node
/* R27 线上端到端验证：真实提问 → 真实引用 → 用真实正文回查定位
 *
 * 这不是 mock：会真的调用线上 /api/ask（产生一次模型费用，约 0.003 元），
 * 再逐篇拉 /api/text 的正文，把引用按 mx-evidence.js 的同一套逻辑定位，
 * 并打印命中行的真实原文，用来证明"第 N 段"确实指向那句话。
 *
 * 用法: node tools/verify-r27-live.mjs [base] [question]
 * 退出码: 0 = 全部引用都定位到；1 = 有引用未能定位或有请求失败
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = process.argv[2] || 'https://aibigplayer.top';
const QUESTION = process.argv[3] || '\u7ea2\u8272\u653f\u6743\u4e3a\u4ec0\u4e48\u80fd\u591f\u5b58\u5728\uff1f';

/* 用与浏览器完全相同的库（纯逻辑，无 DOM 依赖） */
const src = fs.readFileSync(path.join(ROOT, 'site/lib/mx-evidence.js'), 'utf8');
const box = {};
new Function('globalThis', src)(box);
const MX = box.MXEvidence;

function jpost(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, json: await r.json() }));
}
function jget(url) {
  return fetch(url).then(async r => ({ status: r.status, ct: r.headers.get('content-type') || '', text: await r.text() }));
}

const t0 = Date.now();
console.log('===== R27 线上端到端 =====  ' + BASE);
console.log('问题: ' + QUESTION);

const ans = await jpost(BASE + '/api/ask', { question: QUESTION, scope: { mode: 'corpus' } });
if (!ans.json || !ans.json.ok) {
  console.log('✗ /api/ask 失败: HTTP ' + ans.status + ' ' + JSON.stringify(ans.json && ans.json.error));
  process.exit(1);
}
const j = ans.json;
console.log(`✓ 回答: status=${j.status} · 引用 ${j.citations.length} 条 · ${((j.ms || 0) / 1000).toFixed(1)}s · ${j.model}`);
console.log('  答案开头: ' + String(j.answer || '').replace(/\n/g, ' ').slice(0, 70) + '…');

const aids = [...new Set(j.citations.map(c => MX.articleIdOf(c)).filter(Boolean))];
const linesBy = {};
for (const a of aids) {
  const r = await jget(BASE + '/api/text?id=' + encodeURIComponent(a));
  if (r.status !== 200) { console.log(`✗ 正文 ${a} 取文失败 HTTP ${r.status}`); process.exit(1); }
  linesBy[a] = MX.splitLines(r.text);
  console.log(`✓ 正文 ${a}: ${linesBy[a].length} 行`);
}

const groups = MX.groupCitations(j.citations, linesBy);
let unlocated = 0, loose = 0;
for (const g of groups) {
  console.log(`\n《${g.title || g.articleId}》  ${g.items.length} 条引用 · ${g.blocks.length} 个证据块`);
  for (const b of g.blocks) {
    if (!b.located) { unlocated += b.items.length; console.log('  ✗ 未定位: ' + b.items.map(i => i.quote).join(' / ')); continue; }
    if (b.match === 'loose') loose++;
    console.log(`  ${MX.segLabel(b)}${b.merged ? '（合并 ' + b.items.length + ' 条）' : ''}${b.match === 'loose' ? ' · 标点容错' : ''}`);
    const ctx = MX.context(linesBy[g.articleId], b.zeroFrom, b.zeroTo, 0);
    ctx.forEach(l => console.log(`    [${l.n}] ${l.text}`));
    b.items.forEach(it => console.log('    引文: “' + it.quote + '”'));
  }
}

console.log('\n===== 结论 =====');
console.log(`引用总数 ${j.citations.length} · 证据块 ${groups.reduce((n, g) => n + g.blocks.length, 0)} · 未定位 ${unlocated} · 标点容错块 ${loose}`);
console.log(unlocated ? '✗ 存在未定位引用' : '✓ 全部引用都在原文中找到，且按真实顺序成块');
console.log('耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's · 模型费用见 /api/status');
process.exit(unlocated ? 1 : 0);
