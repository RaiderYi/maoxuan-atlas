# -*- coding: utf-8 -*-
"""WP07-r3 冻结版本全量评测 — 独立结果文件/历史文件, 从空结果跑满 20 题。
冻结项: 模型=glm-5.3 / 检索 top=8,minScore=2 / 校验 PIPELINE_VERSION / 语料 hash (启动时打印)。
运行: python pipeline/wp07_r3_eval.py   (在 repo_stage; key 从 D:/工作/maoxuan_viz/data/.key)
"""
import subprocess, json, io, os, time, hashlib
os.chdir(r'D:/工作/maoxuan_viz/repo_stage')

RUN = 'r3'
OUT = f'pipeline/wp07-20q-records-{RUN}.json'
HIST = f'pipeline/wp07-20q-history-{RUN}.jsonl'
MANIFEST = f'pipeline/wp07-{RUN}-manifest.json'

RUNNER = r'''
import { loadProviderConfig } from '../site/api/_lib.js';
import { loadCorpus, askPipeline, PROMPT_VERSION, PIPELINE_VERSION } from '../site/api/_ask.js';
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
  process.stdout.write(JSON.stringify({ no, question: q, expect,
    promptVersion: PROMPT_VERSION, pipelineVersion: PIPELINE_VERSION,
    model: r.model, ms: r.ms, attempts: r.attempts ?? 1, attemptsLog: r.attemptsLog ?? [],
    status: r.status, answer: r.answer, citations: r.citations,
    evidenceIds: r.evidenceIds, hitIds: r.hitIds ?? [], bestScore: r.bestScore,
    fabricatedIntercepted: r.fabricatedIntercepted ?? [], badQuotesIntercepted: r.badQuotesIntercepted ?? [] }));
} catch (e) {
  process.stdout.write(JSON.stringify({ no, question: q, expect,
    promptVersion: PROMPT_VERSION, pipelineVersion: PIPELINE_VERSION,
    error: String(e.message??e), code: e.code??null,
    attemptsLog: e.attemptsLog ?? [], detail: JSON.parse(JSON.stringify(e.detail??{})) }));
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

# 冻结清单: 语料 hash + 检索参数 + 版本 + 提交
def corpus_sha():
    raw = io.open('site/data/sample-topic.json',encoding='utf-8').read()
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]
manifest = {
    'run': RUN,
    'promptVersion': 'wp07-r2',
    'pipelineVersion': 'wp07-r3',
    'model': 'glm-5.3',
    'retrieve': {'top': 8, 'minScore': 2, 'expandNeighbors': True},
    'maxRetries': 2,
    'corpusSha256_16': corpus_sha(),
    'startedAt': time.strftime('%Y-%m-%dT%H:%M:%S'),
}
io.open(MANIFEST,'w',encoding='utf-8').write(json.dumps(manifest, ensure_ascii=False, indent=1))
print('manifest:', json.dumps(manifest, ensure_ascii=False), flush=True)

# 从空结果开始 (r3 独立文件; 若已存在旧 r3 结果则拒绝混跑)
if os.path.exists(OUT):
    raise SystemExit(f'{OUT} 已存在 — 本轮为冻结全量重跑, 请先删除旧 r3 结果再运行 (不沿用任何旧结果)。')

recs = {}
def append_hist(no, q, expect, rec):
    with io.open(HIST,'a',encoding='utf-8') as f:
        f.write(json.dumps({'ts': time.strftime('%Y-%m-%dT%H:%M:%S'), 'no': no, 'question': q,
            'expect': expect, **rec}, ensure_ascii=False)+'\n')

for no,(q,tag) in enumerate(QUESTIONS,1):
    print(f'[{no}/20] {q[:24]}', flush=True)
    try:
        r = subprocess.run(['node','pipeline/_one_q.mjs',str(no),q,tag or 'ANSWERABLE'],
                           capture_output=True, text=True, timeout=400)
        out = r.stdout.strip()
        try:
            rec = json.loads(out)
        except Exception:
            rec = {'no':no,'question':q,'expect':tag or 'ANSWERABLE','error':'bad output: '+out[:200]}
    except subprocess.TimeoutExpired:
        rec = {'no':no,'question':q,'expect':tag or 'ANSWERABLE','error':'timeout 400s'}
    append_hist(no, q, tag or 'ANSWERABLE', rec)   # 每次尝试都留痕 (含失败)
    s = rec.get('status')
    if rec.get('error'):    print('   -> ERROR', rec['error'][:80], flush=True)
    elif s=='insufficient': print('   -> INSUFFICIENT', flush=True)
    else:                   print(f'   -> {s}', len(rec.get('citations',[])), 'cits', rec.get('attempts'),'att', rec.get('ms'),'ms', flush=True)
    recs[no]=rec
    with io.open(OUT,'w',encoding='utf-8') as f:
        json.dump([recs[k] for k in sorted(recs)], f, ensure_ascii=False, indent=1)
    # 请求间隔: 降低高频触发上游连接层限流的概率 (GLM 对密集连续请求会连接重置)
    if no < len(QUESTIONS):
        time.sleep(8)
print('ALL DONE ->', OUT, '| history ->', HIST, flush=True)
