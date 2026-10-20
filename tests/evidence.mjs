#!/usr/bin/env node
/* R27 证据工作区回归：引文定位 / 相邻合并 / 上下文 / 失败说明
 * 纯逻辑，不需要网络与密钥：lib 通过 new Function 注入一个假 globalThis 加载。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'site/lib/mx-evidence.js'), 'utf8');
const box = {};
new Function('globalThis', src)(box);
const MX = box.MXEvidence;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + (e && e.message)); }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' 期望 ' + JSON.stringify(b) + ' 实际 ' + JSON.stringify(a));
}
function ok(v, msg) { if (!v) throw new Error(msg || '断言失败'); }

/* 用真实风格的中文硬折行正文做夹具（每行 = 一段） */
const TEXT = [
  '反对本本主义',
  '（一九三○年五月）',
  '毛泽东的这篇文章是为了反对当时红军中的教条主义思想而写',
  '的。那时没有用“教条主义”这个名称，而叫它做“本本主义”。',
  '一　没有调查，没有发言权',
  '你对于某个问题没有调查，就停止你对于某个问题的发言权。这',
  '不太野蛮了吗？一点也不野蛮。',
  '二　调查就是解决问题',
  '你对于那个问题不能解决么？那末，你就去调查那个问题的现状',
  '和它的历史吧！'
];
const LINES = MX.splitLines(TEXT.join('\r\n'));

console.log('R27 证据工作区');

t('splitLines 去 CRLF 与空行', () => {
  const l = MX.splitLines('a\r\n\r\nb\r\n');
  eq(l, ['a', 'b']);
});

t('跨行引文定位到正确的行区间（1-based）', () => {
  const r = MX.locateIn(LINES, '为了反对当时红军中的教条主义思想而写');
  ok(r, '应能定位');
  eq([r.lineFrom, r.lineTo], [3, 3]);
});

t('引文跨两行时返回 lineFrom≠lineTo', () => {
  const r = MX.locateIn(LINES, '思想而写的。那时没有用');
  ok(r, '应能定位');
  eq([r.lineFrom, r.lineTo], [3, 4]);
});

t('标点版本差异按容错定位（match=loose）', () => {
  const r = MX.locateIn(LINES, '那时没有用教条主义这个名称,而叫它做本本主义');
  ok(r, '容错应成功');
  eq(r.match, 'loose');
  eq([r.lineFrom, r.lineTo], [4, 4]);
});

t('完全相同则为 exact', () => {
  const r = MX.locateIn(LINES, '调查就是解决问题');
  eq(r.match, 'exact');
  eq(r.lineFrom, 8);
});

t('原文里没有的引文返回 null（不猜段落）', () => {
  eq(MX.locateIn(LINES, '这是一句原文里根本不存在的引文'), null);
});

t('空引文不定位', () => {
  eq(MX.locateIn(LINES, ''), null);
});

t('按文章分组：顺序稳定、按行号排序', () => {
  const cits = [
    { id: 'pv1n07-009', quote: '调查就是解决问题', articleId: 'v1n07', articleTitle: '反对本本主义' },
    { id: 'pv1n07-003', quote: '为了反对当时红军中的教条主义思想而写', articleId: 'v1n07', articleTitle: '反对本本主义' }
  ];
  const g = MX.groupCitations(cits, { v1n07: LINES });
  eq(g.length, 1);
  eq(g[0].blocks.length, 2, '相隔 5 行不得合并');
  eq(g[0].blocks[0].lineFrom <= g[0].blocks[1].lineFrom, true);
  eq(g[0].blocks[0].items[0].quote, '为了反对当时红军中的教条主义思想而写');
});

t('相邻/重叠引文合并为一个证据块', () => {
  const cits = [
    { id: 'a', quote: '思想而写的。那时没有用', articleId: 'v1n07' },
    { id: 'b', quote: '那时没有用“教条主义”这个名称', articleId: 'v1n07' }
  ];
  const g = MX.groupCitations(cits, { v1n07: LINES });
  eq(g[0].blocks.length, 1, '重叠应合并');
  eq(g[0].blocks[0].merged, true);
  eq([g[0].blocks[0].lineFrom, g[0].blocks[0].lineTo], [3, 4]);
});

t('相隔仅 1 行的引文合并（同一论证连续段）', () => {
  const cits = [
    { id: 'a', quote: '你对于某个问题没有调查，就停止你对于某个问题的发言权', articleId: 'v1n07' },
    { id: 'b', quote: '不太野蛮了吗？一点也不野蛮。', articleId: 'v1n07' }
  ];
  const g = MX.groupCitations(cits, { v1n07: LINES });
  eq(g[0].blocks.length, 1);
});

t('多篇文章分开成组，保持传入篇目顺序', () => {
  const cits = [
    { id: 'pv1n07-003', quote: '调查就是解决问题', articleId: 'v1n07' },
    { id: 'pv1n03-001', quote: '可以', articleId: 'v1n03' }
  ];
  const g = MX.groupCitations(cits, { v1n07: LINES, v1n03: ['可以燎原'] });
  eq(g.map(x => x.articleId), ['v1n07', 'v1n03']);
});

t('无正文时不丢引文：marked unlocated', () => {
  const g = MX.groupCitations([{ id: 'pv1n03-001', quote: '可以', articleId: 'v1n03' }], {});
  eq(g[0].located, false);
  eq(g[0].blocks[0].located, false);
  eq(g[0].blocks[0].items.length, 1);
  eq(MX.segLabel(g[0].blocks[0]), '未定位');
});

t('上下文含前后各一行并标记命中行', () => {
  const ctx = MX.context(LINES, 6, 6, 1);   /* zeroFrom=6 → 第 7 段 */
  eq(ctx.map(x => x.n), [6, 7, 8]);
  eq(ctx.map(x => x.hit), [false, true, false]);
});

t('上下文在首尾自动收窄，不越界', () => {
  eq(MX.context(LINES, 0, 0, 1).map(x => x.n), [1, 2]);
  eq(MX.context(LINES, 9, 9, 1).map(x => x.n), [9, 10]);
});

t('失败原因对用户可读', () => {
  ok(MX.describeFailure('key_missing').indexOf('密钥') >= 0);
  ok(MX.describeFailure('pack_missing').indexOf('内容包') >= 0);
  eq(MX.describeFailure('weird', '自定义说明'), '自定义说明');
});

/* 异步部分单独跑 */
async function asyncTests() {
  const mkFetch = (map) => (url) => {
    const id = /id=([^&]+)/.exec(url)[1];
    const spec = map[id];
    if (!spec) return Promise.resolve({ ok: false, status: 404, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ ok: false, error: { code: 'bad_request' } }) });
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'text/plain; charset=utf-8' }, text: () => Promise.resolve(spec) });
  };
  let calls = 0;
  const raw = mkFetch({ v1n07: TEXT.join('\n') });
  const load = MX.createTextLoader((u) => { calls++; return raw(u); });
  const a = await load('v1n07');
  ok(a.ok && a.lines.length === 10, '成功读取 10 行');
  const b = await load('v1n07');
  ok(b === a, '第二次命中缓存（同一 promise）');
  eq(calls, 1);
  const f = await load('v9n99');
  ok(!f.ok && f.code === 'bad_request', '失败带 code');
  console.log('  ✓ 异步：成功/缓存/失败 code (' + pass + '→' + (pass + 1) + ')');
  pass++;
}

await asyncTests();

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
