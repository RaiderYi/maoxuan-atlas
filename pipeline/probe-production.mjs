#!/usr/bin/env node
/* R04: 上线后关键路径探测 — 不要等用户报告才发现正文 404
 *
 * 检查的是【用户真正会走的路径】, 不是构建日志:
 *   1. 版本接口                        /api/version
 *   2. 服务与 AI 状态                  /api/status
 *   3. 正文服务自检（内容包 + 密钥）     /api/text?check=1
 *   4. 本次复审抽样的 8 篇 + 现有专题两篇 /api/text?id=…
 *   5. 旧地址兼容                      /data/texts/{id}.txt （vercel rewrite）
 *   6. 首页与人物画廊 HTML 可打开
 *
 * 用法:
 *   node pipeline/probe-production.mjs                       # 默认 https://aibigplayer.top
 *   node pipeline/probe-production.mjs --base https://xxx    # 预览部署
 *   node pipeline/probe-production.mjs --wait 120            # 部署后最多等 120 秒版本更新
 * 退出码: 0 全通过 / 1 有关键路径失败 (可直接用于 CI/部署后钩子)
 */
const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BASE = (getArg('--base', process.env.PROBE_BASE || 'https://aibigplayer.top')).replace(/\/+$/, '');
const WAIT_S = Number(getArg('--wait', '0')) || 0;
const EXPECT_COMMIT = getArg('--expect-commit', process.env.PROBE_EXPECT_COMMIT || '');

// 复审报告 §2.2 抽样篇目 + 现有专题两篇
const SAMPLE_IDS = ['v1n03', 'v1n04', 'v1n07', 'v4n59', 'v1n11', 'v3n02', 'v1n17', 'v5n01'];

const rows = [];
function record(name, ok, detail) {
  rows.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function getJson(path, timeout = 20000) {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(timeout), headers: { 'cache-control': 'no-cache' } });
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, headers: r.headers, text, body };
}
async function getText(path, timeout = 20000) {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(timeout), headers: { 'cache-control': 'no-cache' } });
  const text = await r.text();
  return { status: r.status, headers: r.headers, text };
}

async function probeVersion() {
  try {
    const v = await getJson('/api/version');
    const ok = v.status === 200 && v.body?.ok === true;
    record('版本接口 /api/version', ok, ok ? `${v.body.releaseTag} · ${v.body.sourceCommitShort ?? v.body.sourceCommit}` : 'HTTP ' + v.status);
    if (ok && EXPECT_COMMIT) {
      const hit = String(v.body.sourceCommitFull ?? v.body.sourceCommit ?? '').startsWith(EXPECT_COMMIT);
      record('部署提交与预期一致', hit, hit ? EXPECT_COMMIT.slice(0, 7) : `线上 ${String(v.body.sourceCommit).slice(0, 7)} ≠ 预期 ${EXPECT_COMMIT.slice(0, 7)}`);
    }
    return v.body;
  } catch (e) { record('版本接口 /api/version', false, String(e.message)); return null; }
}

async function probeStatus() {
  try {
    const s = await getJson('/api/status');
    const ok = s.status === 200 && s.body?.ok === true;
    record('服务状态 /api/status', ok,
      ok ? `AI ${s.body.ai?.enabled ? 'enabled' : 'disabled'} · 预算 ${s.body.ai?.quota?.used ?? '?'}/${s.body.ai?.quota?.limit ?? '?'} CNY` : 'HTTP ' + s.status);
    return s.body;
  } catch (e) { record('服务状态 /api/status', false, String(e.message)); return null; }
}

async function probeTextService() {
  try {
    const c = await getJson('/api/text?check=1');
    const b = c.body || {};
    const ok = c.status === 200 && b.packFound === true && b.keyConfigured === true;
    record('正文服务自检 /api/text?check=1', ok,
      ok ? `${b.articleCount} 篇 · 构建于 ${b.builtAt}` : `packFound=${b.packFound} keyConfigured=${b.keyConfigured}`);
  } catch (e) { record('正文服务自检 /api/text?check=1', false, String(e.message)); }
}

async function probeTexts() {
  for (const id of SAMPLE_IDS) {
    try {
      const r = await getText(`/api/text?id=${id}`);
      const ct = String(r.headers.get('content-type') || '');
      const ok = r.status === 200 && /text\/plain/.test(ct) && r.text.trim().length >= 60;
      record(`正文 /api/text?id=${id}`, ok, ok ? `${r.text.length} 字符` : `HTTP ${r.status} ${String(r.text).slice(0, 80).replace(/\s+/g, ' ')}`);
    } catch (e) { record(`正文 /api/text?id=${id}`, false, String(e.message)); }
  }
}

async function probeLegacyPath() {
  try {
    const r = await getText('/data/texts/v1n07.txt');
    const ok = r.status === 200 && r.text.trim().length >= 60 && !/^\s*\{/.test(r.text);
    record('旧地址兼容 /data/texts/v1n07.txt', ok, ok ? `${r.text.length} 字符` : 'HTTP ' + r.status);
  } catch (e) { record('旧地址兼容 /data/texts/v1n07.txt', false, String(e.message)); }
}

async function probePages() {
  for (const p of ['/', '/quiz.html']) {
    try {
      const r = await getText(p);
      const ok = r.status === 200 && /<html/i.test(r.text);
      record(`页面 ${p}`, ok, ok ? 'HTML 200' : 'HTTP ' + r.status);
    } catch (e) { record(`页面 ${p}`, false, String(e.message)); }
  }
}

if (WAIT_S > 0) {
  const target = EXPECT_COMMIT ? EXPECT_COMMIT.slice(0, 7) : null;
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < WAIT_S * 1000) {
    try {
      const v = await getJson('/api/version');
      last = String(v.body?.sourceCommit ?? '');
      if (!target || last.startsWith(target)) break;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 5000));
  }
  console.log(`(等待部署生效 ${Math.round((Date.now() - t0) / 1000)}s，当前提交 ${String(last).slice(0, 7)})`);
}

await probeVersion();
await probeStatus();
await probeTextService();
await probeTexts();
await probeLegacyPath();
await probePages();

const failed = rows.filter(r => !r.ok);
console.log(`\n===== 线上探测 =====  ${BASE}`);
console.log(`${rows.length - failed.length}/${rows.length} 通过`);
if (failed.length) {
  console.log('\n关键路径失败:');
  for (const f of failed) console.log('  ✗ ' + f.name + ' — ' + f.detail);
  console.log('\n处置: 正文接口不可用时先看 /api/text?check=1 —— keyConfigured=false 说明 Vercel 没配 TEXT_PACK_KEY；');
  console.log('      packFound=false 说明内容包没进部署（检查 site/data/texts.pack.json 是否已提交/被 .gitignore 排除）。');
  process.exit(1);
}
console.log('✓ 关键路径全部通过');
