// R01 · 正文服务回归 — 直接调用 site/api/text.mjs 的 handler（不起服务器）
// 覆盖: 全量 217 篇可解密可读 / 校验和一致 / ETag 304 / 非法 id / 缺篇与缺密钥的如实失败
// 运行: node site/api/test-text.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', '..', 'site', 'data');
const ROOT = path.join(__dirname, '..', '..');

const results = [];
async function T(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name + ' — ' + e.message]); }
}

function mockRes() {
  return {
    headers: {}, statusCode: 200, body: null, ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b ?? ''; this.ended = true; },
  };
}
async function call(query, headers = {}, method = 'GET') {
  const { default: handler } = await import(`../../site/api/text.mjs?t=${crypto.randomUUID()}`);
  const res = mockRes();
  await handler({ method, url: '/api/text' + query, headers }, res);
  return res;
}

const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'content-manifest.json'), 'utf8'));
const dataJs = fs.readFileSync(path.join(DATA, 'data.js'), 'utf8');
const articles = JSON.parse(dataJs.slice(dataJs.indexOf('['), dataJs.lastIndexOf(']') + 1));

/* 密钥只存在于部署环境（Vercel 环境变量）与开发者本机 data/.textpack.key。
   CI 里没有密钥是正常的：解密类用例 SKIP 并明确打印，但【内容包覆盖与完整性】必须始终校验，
   否则又会回到"CI 全绿而线上没有正文"的老问题。 */
const checkRes = await call('?check=1');
const checkInfo = JSON.parse(checkRes.body);
const hasKey = checkInfo.keyConfigured === true;

await T('自检: 内容包存在 (/api/text?check=1)', async () => {
  const r = await call('?check=1');
  const j = JSON.parse(r.body);
  assert.strictEqual(j.packFound, true, 'packFound=' + j.packFound);
  assert.ok(j.articleCount >= 200, 'articleCount=' + j.articleCount);
  if (!j.keyConfigured) console.log('  ⚠ 无 TEXT_PACK_KEY / data/.textpack.key：解密类用例将 SKIP（生产密钥由 probe-production 校验）');
});

await T('完整性: 内容包覆盖 data.js 每一篇且密文哈希与清单一致', async () => {
  const body = fs.readFileSync(path.join(ROOT, 'site/data/texts.pack.json'), 'utf8');
  assert.ok(body.length > 100000, '内容包过小');
  const pack = JSON.parse(body);
  let bad = [];
  for (const a of articles) {
    const e = pack.files[a.id];
    if (!e) { bad.push(a.id + ':missing'); continue; }
    const blob = Buffer.from(e.z, 'base64');
    const h = crypto.createHash('sha256').update(blob).digest('hex');
    if (manifest.files[a.id] && manifest.files[a.id].cipherSha256 !== h) bad.push(a.id + ':cipher-hash');
    if (blob.length < 200) bad.push(a.id + ':too-small');
  }
  assert.deepStrictEqual(bad, [], '异常篇目: ' + bad.slice(0, 8).join(', '));
});

if (hasKey) {
await T('全量解密: data.js 声明的每篇都能取到非空正文, 且与 manifest 明文哈希一致', async () => {
  let bad = [];
  for (const a of articles) {
    const r = await call('?id=' + a.id);
    if (r.statusCode !== 200) { bad.push(a.id + ':' + r.statusCode); continue; }
    const text = String(r.body);
    if (text.trim().length < 60) { bad.push(a.id + ':empty'); continue; }
    const h = crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
    if (manifest.files[a.id] && h !== manifest.files[a.id].plainSha256) bad.push(a.id + ':hash');
  }
  assert.deepStrictEqual(bad, [], '异常篇目: ' + bad.slice(0, 8).join(', '));
});
} else {
  console.log('  ⚠ SKIP 全量解密用例（无密钥）');
}

await T('单篇: 返回 text/plain 且内容包含篇名', async () => {
  if (!hasKey) { console.log('  ⚠ SKIP 单篇读取（无密钥）'); return; }
  const r = await call('?id=v1n07');
  assert.strictEqual(r.statusCode, 200);
  assert.match(r.headers['content-type'], /text\/plain/);
  assert.ok(String(r.body).includes('本本主义'), '正文应包含篇名关键词');
  assert.ok(r.headers.etag, '缺少 ETag');
});

await T('缓存: 携带 If-None-Match 时返回 304 且不带正文', async () => {
  if (!hasKey) { console.log('  ⚠ SKIP 缓存用例（无密钥）'); return; }
  const first = await call('?id=v1n03');
  const etag = first.headers.etag;
  const second = await call('?id=v1n03', { 'if-none-match': etag });
  assert.strictEqual(second.statusCode, 304);
  assert.strictEqual(second.body, '');
});

await T('旧地址兼容: file=v1n07.txt 同样可取（vercel rewrite 的参数名）', async () => {
  if (!hasKey) { console.log('  ⚠ SKIP 旧地址兼容（无密钥）'); return; }
  const r = await call('?file=v1n07.txt');
  assert.strictEqual(r.statusCode, 200);
  assert.ok(String(r.body).length > 100);
});

await T('非法 id: 400 且说明格式', async () => {
  const r = await call('?id=../etc/passwd');
  assert.strictEqual(r.statusCode, 400);
  assert.strictEqual(JSON.parse(r.body).error.code, 'bad_id');
});

await T('不存在的合法 id: 503 text_unavailable（不返回占位正文冒充 200）', async () => {
  const r = await call('?id=v5n99');
  assert.strictEqual(r.statusCode, 503);
  assert.strictEqual(JSON.parse(r.body).error.code, 'text_unavailable');
});

await T('方法限制: POST 405', async () => {
  const r = await call('?id=v1n03', {}, 'POST');
  assert.strictEqual(r.statusCode, 405);
});

console.log('');
for (const [s, n] of results) console.log(`${s === 'PASS' ? '✓' : '✗'} ${n}`);
const fail = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n结果: ${results.length - fail} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
