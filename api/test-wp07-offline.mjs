
import { bigrams, loadCorpus, retrieve, buildMessages, parseAnswer, validateCitations } from './_ask.js';
import fs from 'node:fs';
import assert from 'node:assert';

const data = JSON.parse(fs.readFileSync('site/data/sample-topic.json','utf8'));
const corpus = loadCorpus(data);
console.log('corpus paras (non-headnote):', corpus.length);

// 1) 检索: 已知问题应命中正确段落
let r = retrieve('红色政权为什么能够存在', corpus, {top:5});
console.log('top ids:', r.evidence.map(e=>e.id+':'+e.score).join(' '));
assert(r.evidence.length > 0);
assert(r.evidence.some(e => e.articleId === 'v1n03' && /^pv1n03-0\d\d/.test(e.id) && e.score >= 3), 'v1n03 body para expected in top5');

// 2) 检索: 无关问题 → 空/低分
r = retrieve('量子力学的薛定谔方程', corpus, {top:5});
console.log('irrelevant bestScore:', r.bestScore, 'n:', r.evidence.length);

// 3) 校验: 全部引用合法
const ev = [{id:'pv1n03-005',text:'x'},{id:'pv1n04-010',text:'y'}];
let v = validateCitations({answer:'ok',insufficient:false,citations:[{id:'pv1n03-005',quote:'a'},{id:'pv1n04-010',quote:'b'}]}, ev);
assert(v.ok && v.citations.length===2);

// 4) 校验: 虚构 id 被拦截 (剔除)
v = validateCitations({answer:'ok',insufficient:false,citations:[{id:'pv1n03-005',quote:'a'},{id:'pv9n99-001',quote:'fake'}]}, ev);
assert(v.ok, 'parsable answers with some valid cits should pass with fabricated stripped');
assert(v.citations.length===1);
assert.deepEqual(v.fabricated, ['pv9n99-001']);

// 5) 校验: 不可解析
v = validateCitations(null, ev);
assert(!v.ok);

// 6) insufficient: 不带引用
v = validateCitations({answer:'',insufficient:true,citations:[{id:'pv1n03-005',quote:'x'}]}, ev);
assert(v.ok && v.insufficient && v.citations.length===0);

// 7) parseAnswer: 剥离代码围栏
const p = parseAnswer('```json\n{"answer":"hi","citations":[]}\n```');
assert(p && p.answer==='hi');

console.log('ALL OFFLINE TESTS PASS');
