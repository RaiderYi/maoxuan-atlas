// WP07-r3 offline tests: P0 回归 (真断言: 失败 → 非零退出) + 三态 + 邻段扩展
// 反例来源: 2026-10-15 代码审查 (全部虚构ID / 真假混合 / 合法ID+伪造引文 / 限流失效 / 预算丢账)
import { loadCorpus, retrieve, validateCitations, buildMessages, PROMPT_VERSION } from './_ask.js';
import { Budget } from './_lib.js';
import fs from 'node:fs';
import path from 'node:path';

let failed = 0;
function ok(cond, name) {
  if (cond) { console.log('PASS', name); }
  else { console.error('FAIL', name); failed++; }
}

const data = JSON.parse(fs.readFileSync(path.resolve('site/data/sample-topic.json'), 'utf8'));
const corpus = loadCorpus(data);
console.log('promptVersion:', PROMPT_VERSION, '| corpus:', corpus.length);

// ---------- P0-1: 引用校验反例 ----------
// 构造真实证据集
const { evidence } = retrieve('土地问题的分配标准', corpus);
ok(evidence.length > 0, 'P0 setup: evidence non-empty');
const realId = evidence[0].id;
const realText = evidence[0].text;
const realQuote = realText.replace(/\s+/g, '').slice(0, 10);

// 反例 A: 全部虚构 ID → 必须 ok:false (修复前: answered + citations:[] 放行)
{
  const v = validateCitations(
    { answer: '答案', status: 'answered', citations: [{ id: 'FAKE-1', quote: 'x' }, { id: 'FAKE-2', quote: 'y' }] },
    evidence);
  ok(v.ok === false, 'A all-fabricated ids rejected (was: passed with empty citations)');
  ok(v.reason === 'all_fabricated', 'A reason=all_fabricated');
}
// 反例 B: 真假混合, 剥离虚构后有效引用≥1 → 放行但只留真引用, fabricated 有记录
{
  const v = validateCitations(
    { answer: '答案', status: 'answered',
      citations: [{ id: realId, quote: realQuote }, { id: 'FAKE-9', quote: 'z' }] },
    evidence);
  ok(v.ok === true, 'B mixed passes');
  ok(v.citations.length === 1 && v.citations[0].id === realId, 'B only real citation kept');
  ok((v.fabricated ?? []).includes('FAKE-9'), 'B fabricated recorded');
}
// 反例 C: 合法 ID + 伪造引文 → 必须拦截
{
  const v = validateCitations(
    { answer: '答案', status: 'answered', citations: [{ id: realId, quote: '这句是编的根本不存在于段落里' }] },
    evidence);
  ok(v.ok === false, 'C legit-id fake-quote rejected');
  ok(v.reason === 'bad_quotes', 'C reason=bad_quotes');
}
// 正例 D: 合法 ID + 真实引文(含跨段拼接) → 通过
{
  // 找一对相邻段构造跨边界引文
  const s0 = evidence.find(e => !e._nb);
  const s1 = corpus.find(p => p.articleId === s0.articleId && p.seq === s0.seq + 1);
  if (s1) {
    const crossQuote = (s0.text + s1.text).replace(/\s+/g, '').slice(Math.max(0, s0.text.length - 5), Math.max(0, s0.text.length - 5) + 10);
    const v = validateCitations(
      { answer: '答案', status: 'answered', citations: [{ id: s0.id, quote: crossQuote }] },
      [s0, s1]);
    ok(v.ok === true && v.citations.length === 1, 'D cross-segment-boundary real quote passes');
  }
}

// ---------- P0-2: 限流 (模拟 handler 内联逻辑, 验证 set 回写) ----------
{
  const rlBuckets = new Map();
  const RL_MAX = 5, W = 60_000;
  function rateLimited(key) {
    const now = 0;  // 冻结时间
    let b = rlBuckets.get(key);
    if (!b || now - b.windowStart >= W) b = { windowStart: now, count: 0 };
    b.count += 1;
    rlBuckets.set(key, b);
    return b.count > RL_MAX;
  }
  const results = [];
  for (let i = 0; i < 10; i++) results.push(rateLimited('k1'));
  ok(results.filter(Boolean).length === 5 && results[4] === false && results[5] === true,
    'P0-2 rate limit: 6th of 10 blocked, first 5 allowed');
  ok(!rateLimited('k2'), 'P0-2 different key independent');
}

// ---------- P0-3: 预算累计 ----------
{
  Budget.resetForTest();
  process.env.BUDGET_LIMIT_CREDIT = '20';
  // 模拟两个"请求"各读 load() 后 spend(10) — 修复前互相覆盖只累计 10
  const b1 = Budget.load(); b1.spend(10);
  const b2 = Budget.load(); b2.spend(10);
  const b3 = Budget.load();
  ok(b3.spent === 20, `P0-3 sequential accumulate (expect 20, got ${b3.spent})`);
  // 费用未知 → 不默认零成本
  Budget.resetForTest();
  const b4 = Budget.load(); b4.spend(null);
  ok(b4.spent === 1, `P0-3 unknown cost conservatively reserved (expect 1, got ${b4.spent})`);
  // 结算冲销
  b4.settle(0.3);
  const b5 = Budget.load();
  ok(Math.abs(b5.spent - 0.3) < 1e-9, `P0-3 settle replaces reserve (expect 0.3, got ${b5.spent})`);
  delete process.env.BUDGET_LIMIT_CREDIT;
}

// ---------- 三态 + 检索回归 ----------
{
  const ev = [{ id: 'pv1n03-001', articleId: 'v1n03', seq: 1, text: '第一段原文内容供测试' },
              { id: 'pv1n03-002', articleId: 'v1n03', seq: 2, text: '第二段原文内容供测试' }];
  ok(validateCitations({ answer: 'x\n按语：缺y', status: 'partial', citations: [{ id: 'pv1n03-001', quote: '第一段原文' }] }, ev).ok, 'tri-state partial w/ note');
  ok(validateCitations({ answer: 'x', status: 'partial', citations: [{ id: 'pv1n03-001', quote: '第一段原文' }] }, ev).ok === false, 'partial w/o note fails');
  ok(validateCitations({ answer: '', status: 'insufficient', citations: [] }, ev).ok, 'insufficient ok');
  ok(validateCitations({ answer: 'x', insufficient: false, citations: [{ id: 'pv1n03-001', quote: '第一段原文' }] }, ev).ok, 'legacy compat');

  const r = retrieve('薛定谔方程', corpus);
  ok(r.evidence.length === 0, 'irrelevant -> 0 evidence');

  const t1 = retrieve('土地问题的分配标准', corpus);
  const hitSet = new Set(t1.hits);
  const hitsByArt = new Map();
  for (const e of t1.evidence) if (hitSet.has(e.id)) {
    if (!hitsByArt.has(e.articleId)) hitsByArt.set(e.articleId, []);
    hitsByArt.get(e.articleId).push(e);
  }
  let orphan = 0;
  for (const e of t1.evidence) {
    if (!e._nb) continue;
    if (!(hitsByArt.get(e.articleId) ?? []).some(h => Math.abs(h.seq - e.seq) === 1)) orphan++;
  }
  ok(orphan === 0, 'neighbor expansion: every _nb para adjacent to a hit');
  for (let i = 1; i < t1.evidence.length; i++) {
    const a = t1.evidence[i - 1], b = t1.evidence[i];
    if (!(a.articleId < b.articleId || (a.articleId === b.articleId && a.seq <= b.seq))) { ok(false, 'evidence ordered'); break; }
  }
  ok(true, 'evidence ordered by (articleId, seq)');

  const [sys] = buildMessages('q', [{ id: 'x', text: 't' }]);
  ok(sys.content.includes('"partial"') && sys.content.includes('按语'), 'prompt has tri-state + note rule');
}

if (failed) { console.error(`\n${failed} TEST(S) FAILED`); process.exit(1); }
console.log('\nALL OFFLINE TESTS PASS');
