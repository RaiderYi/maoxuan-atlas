// WP07-r3 offline tests: P0-r3 回归 (真断言: 失败 → 非零退出)
// 反例来源: 2026-10-15 第二轮代码审查 (并发预算/未知费用/失败记账/真假混合整份重试/逆序拼接拒绝)
import { loadCorpus, retrieve, validateCitations, buildMessages, PROMPT_VERSION, PIPELINE_VERSION } from './_ask.js';
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
console.log('promptVersion:', PROMPT_VERSION, '| pipelineVersion:', PIPELINE_VERSION, '| corpus:', corpus.length);

// ---------- 引用校验反例 ----------
{
  // 构造两段正序连续证据, 模拟"甲乙丙" + "丁戊己"
  const A = { id: 'pX-001', articleId: 'X', seq: 1, text: '甲乙丙' };
  const B = { id: 'pX-002', articleId: 'X', seq: 2, text: '丁戊己' };
  const ev = [A, B];
  // 逆序拼接 "己甲" (乙段尾+甲段头) 必须被拒绝
  const vRev = validateCitations({ answer: 'x', status: 'answered', citations: [{ id: 'pX-001', quote: '己甲' }] }, ev);
  ok(vRev.ok === false && vRev.reason === 'bad_quotes', 'reverse-order cross-segment quote rejected (己甲)');
  // 正序跨段 "丙丁" (甲段尾+乙段头) 必须通过
  const vFwd = validateCitations({ answer: 'x', status: 'answered', citations: [{ id: 'pX-001', quote: '丙丁' }] }, ev);
  ok(vFwd.ok === true, 'forward-order cross-segment quote accepted (丙丁)');
  // 真假混合 → 整份失败 (不静默剔除保留答案)
  const vMix = validateCitations({ answer: 'x', status: 'answered',
    citations: [{ id: 'pX-001', quote: '甲乙' }, { id: 'FAKE-9', quote: 'z' }] }, ev);
  ok(vMix.ok === false && vMix.reason === 'fabricated', 'mixed real+fabricated rejected as whole (not silently stripped)');
  // 合法ID+伪造引文 → 整份失败
  const vFake = validateCitations({ answer: 'x', status: 'answered', citations: [{ id: 'pX-001', quote: '不存在的字句' }] }, ev);
  ok(vFake.ok === false && vFake.reason === 'bad_quotes', 'legit-id + fake-quote rejected as whole');
  // 全合法 → 通过
  const vOk = validateCitations({ answer: 'x', status: 'answered', citations: [{ id: 'pX-001', quote: '甲乙丙' }] }, ev);
  ok(vOk.ok === true && vOk.citations.length === 1, 'all-valid passes');
}

// ---------- 预算反例 ----------
{
  Budget.resetForTest();
  process.env.BUDGET_LIMIT_CREDIT = '20';
  // 并发缺陷: 两个请求先后 load() 读同一初始余额, 各 spend 10 → 必须累计 20 (共享原子累加)
  const b1 = Budget.load(); b1.spend(10);
  const b2 = Budget.load(); b2.spend(10);
  ok(Budget.load().spent === 20, `concurrent accumulate 10+10 = 20 (got ${Budget.load().spent})`);
  // 未知费用: spend(null/undefined) 缺省按 1 次调用计, 不当作零
  Budget.resetForTest();
  const b3 = Budget.load();
  b3.spend(null);
  ok(Budget.load().spent === 1, `unknown-cost spends 1 call (not 0), got ${Budget.load().spent}`);
  // 失败调用也记账: 模拟 error.attemptsLog 有 2 条 → spend(2)
  Budget.resetForTest();
  const b4 = Budget.load();
  b4.spend(2);
  ok(Budget.load().spent === 2, 'failed-call count billed via attemptsLog length');
  // 耗尽熔断
  Budget.resetForTest();
  process.env.BUDGET_LIMIT_CREDIT = '3';
  const b5 = Budget.load();
  b5.spend(3);
  ok(b5.exhausted() === true, 'exhausted after limit');
  delete process.env.BUDGET_LIMIT_CREDIT;
  Budget.resetForTest();
}

// ---------- 三态 + 检索回归 ----------
{
  const ev = [{ id: 'pv1n03-001', articleId: 'v1n03', seq: 1, text: '第一段原文内容供测试' },
              { id: 'pv1n03-002', articleId: 'v1n03', seq: 2, text: '第二段原文内容供测试' }];
  ok(validateCitations({ answer: 'x\n按语：缺y', status: 'partial', citations: [{ id: 'pv1n03-001', quote: '第一段原文' }] }, ev).ok, 'tri-state partial w/ note');
  ok(validateCitations({ answer: 'x', status: 'partial', citations: [{ id: 'pv1n03-001', quote: '第一段原文' }] }, ev).ok === false, 'partial w/o note fails');
  ok(validateCitations({ answer: '', status: 'insufficient', citations: [] }, ev).ok, 'insufficient ok');

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
  ok(orphan === 0, 'neighbor expansion: every _nb adjacent to a hit');
  for (let i = 1; i < t1.evidence.length; i++) {
    const a = t1.evidence[i - 1], b = t1.evidence[i];
    if (!(a.articleId < b.articleId || (a.articleId === b.articleId && a.seq <= b.seq))) { ok(false, 'evidence ordered'); break; }
  }
  ok(true, 'evidence ordered by (articleId, seq)');
}

if (failed) { console.error(`\n${failed} TEST(S) FAILED`); process.exit(1); }
console.log('\nALL OFFLINE TESTS PASS');
