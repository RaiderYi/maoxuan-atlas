// WP07: 20 题真实记录 — 本地运行, 真实 GLM 调用, 产出 20q 记录 JSON
// 运行: node pipeline/wp07_20q.js  (在 repo_stage 目录; key 从 D:/工作/maoxuan_viz/data/.key)
import { loadProviderConfig } from '../site/api/_lib.js';
import { loadCorpus, askPipeline } from '../site/api/_ask.js';
import fs from 'node:fs';
import path from 'node:path';

const KEY = fs.readFileSync('D:/工作/maoxuan_viz/data/.key', 'utf8').trim();
process.env.PROVIDER_URL = 'https://open.bigmodel.cn/api/coding/paas/v4';
process.env.PROVIDER_KEY = KEY;
process.env.MODEL_ID = 'glm-5.3';
process.env.PROVIDER_TIMEOUT_MS = '90000';
process.env.MAX_RETRIES = '1';

const data = JSON.parse(fs.readFileSync(
  path.resolve('site/data/sample-topic.json'), 'utf8'));
const corpus = loadCorpus(data);
const provider = loadProviderConfig();

// 20 题: 有据可答(12) / 需跨段综合(4) / 资料不足应拒答(4)
const QUESTIONS = [
  ['中国的红色政权为什么能够存在？其发生和存在的原因是什么？'],
  ['毛泽东认为一小块或若干小块红色区域能够存在的前提条件是什么？'],
  ['井冈山根据地位于什么山脉的什么位置？'],
  ['八月失败的原因和教训是什么？'],
  ['湘赣边界的割据局面在湘鄂赣三省的地位如何？'],
  ['边界党的组织存在什么问题？土籍客籍问题怎么造成的？'],
  ['割据地区现势部分，边界各县城的情况如何？'],
  ['军事问题上红军面临的困难有哪些？'],
  ['土地问题上的分配标准是什么？'],
  ['政权问题的核心矛盾是什么？如何解决？'],
  ['革命性质问题的争论焦点是什么？'],
  ['割据地区问题中，中段、北段、南段哪个最利于割据？为什么？'],
  ['红色政权存在的五个条件分别是什么？（综合归纳）'],
  ['边界割据一年多的经验教训，毛泽东是如何总结的？（综合）'],
  ['文中提到的红军医院的条件如何？缺医少药到什么程度？'],
  ['罗霄山脉中段作为根据地的地形优势有哪些具体描述？'],
  ['井冈山时期红军使用的坦克型号是什么？', 'IRRELEVANT'],       // 语料绝无 → 应拒答
  ['这篇文章的作者晚年在哪座城市逝世的？', 'IRRELEVANT'],        // 语料外知识 → 应拒答
  ['薛定谔方程在井冈山斗争中的应用是什么？', 'IRRELEVANT'],      // 完全无关 → 应拒答
  ['1929年红军长征的路线是怎样的？', 'IRRELEVANT'],              // 时间超出语料 → 应拒答
];

const out = [];
const OUT_F = 'pipeline/wp07-20q-records.json';
let i = 0;
for (const [q, tag] of QUESTIONS) {
  i++;
  process.stdout.write(`\n[${i}/20] ${q}\n`);
  try {
    const r = await askPipeline(q, { provider, corpus, timeoutMs: 90_000, maxRetries: 2 },
      e => process.stdout.write(`  retrieve: ${e.n} paras bestScore=${e.bestScore}\n`));
    const rec = {
      no: i, question: q, expect: tag ?? 'ANSWERABLE',
      model: r.model, ms: r.ms,
      insufficient: !!r.insufficient,
      answer: r.answer, citations: r.citations,
      evidenceIds: r.evidenceIds, bestScore: r.bestScore,
      fabricatedIntercepted: r.fabricatedIntercepted ?? [],
    };
    out = out.filter(x => x.no !== i); out.push(rec);
    console.log(`  -> ${rec.insufficient ? 'INSUFFICIENT' : 'answer ' + r.answer.length + ' chars, ' + r.citations.length + ' cits'} [${r.ms}ms]`);
  } catch (e) {
    out = out.filter(x => x.no !== i);
    out.push({ no: i, question: q, expect: tag ?? 'ANSWERABLE', error: String(e.message ?? e), code: e.code ?? null, detail: JSON.parse(JSON.stringify(e.detail ?? {})) });
    console.log(`  -> ERROR ${e.message} ${JSON.stringify(e.detail ?? {}).slice(0,120)}`);
  }
  out.sort((a,b)=>a.no-b.no);
  fs.writeFileSync(OUT_F, JSON.stringify(out, null, 1), 'utf8');
}

// 汇总统计
const ok = out.filter(r => !r.error);
const answered = ok.filter(r => !r.insufficient);
const refused = ok.filter(r => r.insufficient);
const citationValid = answered.every(r => r.citations.every(c => r.evidenceIds.includes(c.id)));
const fabricatedTotal = ok.reduce((s, r) => s + (r.fabricatedIntercepted?.length ?? 0), 0);
console.log('\n===== WP07 20-question summary =====');
console.log(`errors: ${out.length - ok.length}`);
console.log(`answered: ${answered.length}, refused(insufficient): ${refused.length}`);
console.log(`citation ids 100% in evidence: ${citationValid}`);
console.log(`fabricated ids intercepted (after retry): ${fabricatedTotal}`);
const irrel = ok.filter(r => r.expect === 'IRRELEVANT');
console.log(`irrelevant questions correctly refused: ${irrel.filter(r => r.insufficient).length}/${irrel.length}`);
console.log('written: pipeline/wp07-20q-records.json');
