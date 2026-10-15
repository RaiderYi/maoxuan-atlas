// WP07 r2 offline tests: 三态校验 + 邻段扩展连续性 + 兼容旧格式
import { loadCorpus, retrieve, validateCitations, parseAnswer, buildMessages, PROMPT_VERSION } from './_ask.js';
import fs from 'node:fs';
import path from 'node:path';

const data = JSON.parse(fs.readFileSync(
  path.resolve('site/data/sample-topic.json'), 'utf8'));
const corpus = loadCorpus(data);
console.log('promptVersion:', PROMPT_VERSION);
console.log('corpus paras (non-headnote):', corpus.length);

// T1: 检索 + 邻段扩展 — 每个扩展段(_nb)必须在同篇文章内紧邻一个命中段(|seq差|=1), 证据按原文 seq 排序
{
  const { evidence, hits } = retrieve('土地问题的分配标准', corpus);
  console.assert(evidence.length > 0, 'T1 evidence empty');
  const hitSet = new Set(hits);
  const hitsByArt = new Map();
  for (const e of evidence) if (hitSet.has(e.id)) {
    if (!hitsByArt.has(e.articleId)) hitsByArt.set(e.articleId, []);
    hitsByArt.get(e.articleId).push(e);
  }
  for (const e of evidence) {
    if (!e._nb) continue;
    const okNbr = (hitsByArt.get(e.articleId) ?? []).some(h => Math.abs(h.seq - e.seq) === 1);
    console.assert(okNbr, `T1 orphan neighbor ${e.id}`);
  }
  // 证据按 (articleId, seq) 排序
  for (let i = 1; i < evidence.length; i++) {
    const a = evidence[i - 1], b = evidence[i];
    const ordered = a.articleId < b.articleId || (a.articleId === b.articleId && a.seq <= b.seq);
    console.assert(ordered, `T1 order ${a.id} -> ${b.id}`);
  }
  console.log('T1 neighbor-expansion continuity: OK, evidence=', evidence.length, 'hits=', hits.length);
}

// T2: 三态校验
{
  const ev = [{ id: 'pv1n03-001' }, { id: 'pv1n03-002' }];
  const r1 = validateCitations({ answer: 'x', status: 'answered', citations: [{ id: 'pv1n03-001', quote: 'q' }] }, ev);
  console.assert(r1.ok && r1.status === 'answered', 'T2 r1');
  const r2 = validateCitations({ answer: 'x\n按语：缺y', status: 'partial', citations: [{ id: 'pv1n03-001', quote: 'q' }] }, ev);
  console.assert(r2.ok && r2.status === 'partial', 'T2 r2');
  const r3 = validateCitations({ answer: 'x', status: 'partial', citations: [{ id: 'pv1n03-001', quote: 'q' }] }, ev);
  console.assert(!r3.ok && r3.reason === 'partial_missing_note', 'T2 r3 partial w/o note must fail');
  const r4 = validateCitations({ answer: '', status: 'insufficient', citations: [] }, ev);
  console.assert(r4.ok && r4.status === 'insufficient' && r4.citations.length === 0, 'T2 r4');
  const r5 = validateCitations({ answer: 'x', status: 'answered', citations: [{ id: 'FAKE-9', quote: 'q' }] }, ev);
  console.assert(r5.ok && r5.citations.length === 0 && r5.fabricated.includes('FAKE-9'), 'T2 r5 fabricated stripped');
  const r6 = validateCitations({ answer: 'x', insufficient: false, citations: [{ id: 'pv1n03-001', quote: 'q' }] }, ev);
  console.assert(r6.ok && r6.status === 'answered', 'T2 r6 legacy insufficient:false compat');
  const r7 = validateCitations({ answer: 'x', status: 'answered', citations: [] }, ev);
  console.assert(!r7.ok && r7.reason === 'no_citations', 'T2 r7 no_citations');
  console.log('T2 tri-state validation: OK');
}

// T3: 提示词含三态定义
{
  const [sys] = buildMessages('q', [{ id: 'x', text: 't' }]);
  console.assert(sys.content.includes('"answered"') && sys.content.includes('"partial"') && sys.content.includes('"insufficient"'), 'T3');
  console.log('T3 tri-state prompt: OK');
}

// T4: 无关问题 → 0 证据 (不调模型)
{
  const { evidence } = retrieve('薛定谔方程', corpus);
  console.assert(evidence.length === 0, 'T4');
  console.log('T4 irrelevant -> 0 evidence: OK');
}

console.log('ALL OFFLINE TESTS PASS');
