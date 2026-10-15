# -*- coding: utf-8 -*-
"""WP07: 分批跑 20 题 — 每题独立 node 进程 (规避长驻进程崩溃), 断点续跑"""
import subprocess, json, io, os, sys
os.chdir(r'D:/工作/maoxuan_viz/repo_stage')

RUNNER = r'''
import { loadProviderConfig } from '../api/_lib.js';
import { loadCorpus, askPipeline } from '../api/_ask.js';
import fs from 'node:fs';
const KEY = fs.readFileSync('D:/工作/maoxuan_viz/data/.key','utf8').trim();
process.env.PROVIDER_URL='https://open.bigmodel.cn/api/coding/paas/v4';
process.env.PROVIDER_KEY=KEY; process.env.MODEL_ID='glm-5.3';
process.env.PROVIDER_TIMEOUT_MS='90000';
const data = JSON.parse(fs.readFileSync('site/data/sample-topic.json','utf8'));
const corpus = loadCorpus(data);
const no = parseInt(process.argv[2]), q = process.argv[3], expect = process.argv[4]||'ANSWERABLE';
try {
  const r = await askPipeline(q, { provider: loadProviderConfig(), corpus, timeoutMs: 90000, maxRetries: 2 }, null);
  process.stdout.write(JSON.stringify({ no, question: q, expect, model: r.model, ms: r.ms,
    insufficient: !!r.insufficient, answer: r.answer, citations: r.citations,
    evidenceIds: r.evidenceIds, bestScore: r.bestScore, fabricatedIntercepted: r.fabricatedIntercepted ?? [] }));
} catch (e) {
  process.stdout.write(JSON.stringify({ no, question: q, expect, error: String(e.message??e), code: e.code??null, detail: JSON.parse(JSON.stringify(e.detail??{})) }));
}
'''
io.open('pipeline/_one_q.mjs','w',encoding='utf-8',newline='\n').write(RUNNER)

QUESTIONS = [
 ('中国的红色政权为什么能够存在？其发生和存在的原因是什么？',None),
 ('毛泽东认为一小块或若干小块红色区域能够存在的前提条件是什么？',None),
 ('井冈山根据地位于什么山脉的什么位置？',None),
 ('八月失败的原因和教训是什么？',None),
 ('湘赣边界的割据局面在湘鄂赣三省的地位如何？',None),
 ('边界党的组织存在什么问题？土籍客籍问题怎么造成的？',None),
 ('割据地区现势部分，边界各县城的情况如何？',None),
 ('军事问题上红军面临的困难有哪些？',None),
 ('土地问题上的分配标准是什么？',None),
 ('政权问题的核心矛盾是什么？如何解决？',None),
 ('革命性质问题的争论焦点是什么？',None),
 ('割据地区问题中，中段、北段、南段哪个最利于割据？为什么？',None),
 ('红色政权存在的五个条件分别是什么？（综合归纳）',None),
 ('边界割据一年多的经验教训，毛泽东是如何总结的？（综合）',None),
 ('文中提到的红军医院的条件如何？缺医少药到什么程度？',None),
 ('罗霄山脉中段作为根据地的地形优势有哪些具体描述？',None),
 ('井冈山时期红军使用的坦克型号是什么？','IRRELEVANT'),
 ('这篇文章的作者晚年在哪座城市逝世的？','IRRELEVANT'),
 ('薛定谔方程在井冈山斗争中的应用是什么？','IRRELEVANT'),
 ('1929年红军长征的路线是怎样的？','IRRELEVANT'),
]
OUT='pipeline/wp07-20q-records.json'
recs = {}
try:
    for r in json.load(io.open(OUT,encoding='utf-8')):
        if not r.get('error'): recs[r['no']]=r
except Exception: pass
print('resume:',len(recs),'done', flush=True)
for no,(q,tag) in enumerate(QUESTIONS,1):
    if no in recs and not recs[no].get('error'):
        continue
    print(f'[{no}/20] {q[:24]}', flush=True)
    try:
        r = subprocess.run(['node','pipeline/_one_q.mjs',str(no),q,tag or 'ANSWERABLE'],
                           capture_output=True, text=True, timeout=400)
        out = r.stdout.strip()
        try:
            rec = json.loads(out)
        except Exception:
            rec = {'no':no,'question':q,'expect':tag or 'ANSWERABLE','error':'bad output: '+out[:100]}
    except subprocess.TimeoutExpired:
        rec = {'no':no,'question':q,'expect':tag or 'ANSWERABLE','error':'timeout 400s'}
    if rec.get('insufficient'): print('   -> INSUFFICIENT', flush=True)
    elif rec.get('error'):      print('   -> ERROR', rec['error'][:60], flush=True)
    else:                       print('   -> answered', len(rec.get('citations',[])), 'cits', rec.get('ms'),'ms', flush=True)
    recs[no]=rec
    with io.open(OUT,'w',encoding='utf-8') as f:
        json.dump([recs[k] for k in sorted(recs)], f, ensure_ascii=False, indent=1)
print('ALL DONE ->', OUT, flush=True)
