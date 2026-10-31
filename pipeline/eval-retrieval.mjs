#!/usr/bin/env node
/* R55: 检索离线评测 —— legacy(wp07-bigram) vs hybrid(r2-hybrid) 同题对比
 * 指标: hit@8（top8 命中任一期望文章）/ term 命中（证据文本含期望词）/ MRR（首个期望文章排名倒数）
 * 守卫: hybrid 的 hit@8 不得低于 legacy —— 否则退出码 1（不许带病上线）
 * 用法: node pipeline/eval-retrieval.mjs [--qset pipeline/eval-retrieval-qset.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus, retrieve } from '../site/api/_ask.mjs';
import { retrieveHybrid, RETRIEVAL_VERSION } from '../site/api/_retrieval.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const qsetPath = (() => {
  const i = process.argv.indexOf('--qset');
  return i >= 0 ? path.resolve(process.argv[i + 1]) : path.join(__dirname, 'eval-retrieval-qset.json');
})();

const CORPUS_CANDIDATES = [
  path.join(ROOT, 'site', 'data', 'sample-topic.json'),
  path.join(ROOT, 'data', 'sample-topic.json'),
];
const CONCEPT_CANDIDATES = [
  path.join(ROOT, 'site', 'data', 'concept-map.json'),
  path.join(ROOT, 'data', 'concept-map.json'),
];
function firstExisting(list) {
  for (const p of list) if (fs.existsSync(p)) return p;
  throw new Error('required data file not found: ' + list[0]);
}
function firstExistingQuiet(list) {
  for (const p of list) if (fs.existsSync(p)) return p;
  return null;
}
// R56: 优先全量语料（本机有 corpuspack 密钥时解密使用），否则回落 2 篇样本
let corpus = null, corpusLabel = '';
const fullPackPath = firstExistingQuiet([path.join(ROOT, 'site', 'data', 'corpus-full.pack.json')]);
const fullKeyPath = path.join(ROOT, 'data', '.corpuspack.key');
if (fullPackPath && fs.existsSync(fullKeyPath)) {
  try {
    const { loadCorpusFull } = await import('../site/api/_corpus.mjs');
    const full = loadCorpusFull({ packPath: fullPackPath, keyB64: fs.readFileSync(fullKeyPath, 'utf8') });
    if (full) { corpus = full.corpus; corpusLabel = `full(${full.articleCount}篇/${full.paragraphCount}段)`; }
  } catch { /* fall through */ }
}
if (!corpus) {
  const raw = JSON.parse(fs.readFileSync(firstExisting(CORPUS_CANDIDATES), 'utf8'));
  corpus = loadCorpus(raw);
  corpusLabel = `sample(${corpus.length}段)`;
}
const conceptMap = JSON.parse(fs.readFileSync(firstExisting(CONCEPT_CANDIDATES), 'utf8')).groups ?? [];
const qset = JSON.parse(fs.readFileSync(qsetPath, 'utf8')).questions ?? [];
if (!qset.length) { console.error('qset is empty'); process.exit(2); }

function run(fn, q) {
  const r = fn(q, corpus, { top: 8 });
  const ids = r.hits ?? [];
  const evText = (r.evidence ?? []).map(e => e.text).join('\n');
  return { ids, evText, best: r.bestScore };
}
function evalOne(fn, item) {
  const { ids, evText } = run(fn, item.q);
  const expect = item.expectArticles ?? [];
  let rr = null;
  const firstIdx = ids.findIndex(id => expect.includes(id.replace(/^p(v\d+n\d+)-.*$/, '$1')));
  if (firstIdx >= 0) rr = 1 / (firstIdx + 1);
  const hit = firstIdx >= 0;
  const terms = item.expectTerms ?? [];
  const termHit = terms.length ? terms.filter(t => evText.includes(t)).length : null;
  return { id: item.id, hit, rr, termHit, termTotal: terms.length, n: ids.length };
}

const legacy = qset.map(q => evalOne(retrieve, q));
const hybrid = qset.map(q => evalOne((qq, c, o) => retrieveHybrid(qq, c, { ...o, conceptMap }), q));
const sum = (arr, f) => arr.reduce((n, x) => n + (f(x) || 0), 0);
const rate = (arr, f) => (arr.filter(f).length / arr.length * 100).toFixed(1) + '%';

const legacyHit = legacy.filter(x => x.hit).length;
const hybridHit = hybrid.filter(x => x.hit).length;
const legacyMRR = (sum(legacy, x => x.rr) / legacy.length);
const hybridMRR = (sum(hybrid, x => x.rr) / hybrid.length);
const legacyTerm = sum(legacy, x => x.termHit) / sum(legacy, x => x.termTotal) * 100;
const hybridTerm = sum(hybrid, x => x.termHit) / sum(hybrid, x => x.termTotal) * 100;

console.log(`语料: ${corpus.length} 单元 · 概念组: ${conceptMap.length} · 题数: ${qset.length}`);
console.log(`检索版本: legacy=wp07-bigram · hybrid=${RETRIEVAL_VERSION}`);
console.log('');
console.log('指标              legacy      hybrid      Δ');
console.log(`hit@8           ${rate(legacy, x => x.hit).padStart(8)}   ${rate(hybrid, x => x.hit).padStart(8)}   ${(hybridHit - legacyHit >= 0 ? '+' : '')}${hybridHit - legacyHit} 题`);
console.log(`MRR             ${legacyMRR.toFixed(3).padStart(8)}   ${hybridMRR.toFixed(3).padStart(8)}   ${hybridMRR - legacyMRR >= 0 ? '+' : ''}${(hybridMRR - legacyMRR).toFixed(3)}`);
console.log(`期望词覆盖      ${(legacyTerm.toFixed(1) + '%').padStart(8)}   ${(hybridTerm.toFixed(1) + '%').padStart(8)}   ${(hybridTerm - legacyTerm).toFixed(1)}pp`);
console.log('');
console.log('逐题（hit = top8 命中期望文章；term = 期望词在证据文本中出现数/应出现数）:');
for (let i = 0; i < qset.length; i++) {
  const a = legacy[i], b = hybrid[i];
  const mark = !b.hit && a.hit ? ' ← 退化' : (b.hit && !a.hit ? ' ← 改善' : '');
  console.log(`  ${b.id}  legacy ${a.hit ? 'H' : '-'}${a.termHit != null ? `/t${a.termHit}/${a.termTotal}` : ''}   hybrid ${b.hit ? 'H' : '-'}${b.termHit != null ? `/t${b.termHit}/${b.termTotal}` : ''}${mark}`);
}

if (hybridHit < legacyHit) {
  console.error('\n✗ 守卫触发: hybrid hit@8 低于 legacy —— 不得上线');
  process.exit(1);
}
console.log('\n✓ 守卫通过: hybrid 不劣于 legacy');
