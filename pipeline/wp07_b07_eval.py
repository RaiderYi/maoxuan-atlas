# -*- coding: utf-8 -*-
"""B07：经预算批准后的 20 题真实重跑（DeepSeek deepseek-flash）
冻结项与 wp07-r3 相同：同一 20 题、同一 prompt/pipeline 版本、同一语料；
仅替换供应商与模型（这是 B07 的目的：在已批准预算的真实模型上重跑）。
失败一律保留，不沿用任何旧版本结果。
运行：python pipeline/wp07_b07_eval.py
"""
import subprocess, json, io, os, re, time, hashlib

ROOT = r'D:/工作/maoxuan_viz/repo_stage'
os.chdir(ROOT)
RUN = 'b07'
OUT = f'pipeline/wp07-20q-records-{RUN}.json'
HIST = f'pipeline/wp07-20q-history-{RUN}.jsonl'
MANIFEST = f'pipeline/wp07-{RUN}-manifest.json'


def deepseek_key():
    """从 Hermes 本地配置读取 DeepSeek key；只返回，不打印。"""
    env = os.environ.get('DEEPSEEK_API_KEY')
    if env:
        return env.strip()
    for p in (os.path.expanduser('~/AppData/Local/hermes/config.yaml'),
              os.path.expanduser('~/.hermes/config.yaml')):
        if not os.path.isfile(p):
            continue
        t = io.open(p, encoding='utf-8', errors='replace').read()
        # providers.deepseek 段内的 api_key
        m = re.search(r'^\s*deepseek:\s*$.*?^\s{4}api_key:\s*(\S+)', t, re.S | re.M)
        if m and m.group(1).strip("'\""):
            return m.group(1).strip().strip("'\"")
    raise SystemExit('未找到 DeepSeek key（env DEEPSEEK_API_KEY 或 hermes config providers.deepseek.api_key）')


RUNNER = r'''
import { loadProviderConfig } from '../api/_lib.js';
import { loadCorpus, askPipeline, PROMPT_VERSION, PIPELINE_VERSION } from '../api/_ask.js';
import { costOfUsage } from '../api/_govern.js';
import fs from 'node:fs';
const data = JSON.parse(fs.readFileSync('site/data/sample-topic.json','utf8'));
const corpus = loadCorpus(data);
const no = parseInt(process.argv[2]), q = process.argv[3], expect = process.argv[4]||'ANSWERABLE';
try {
  const r = await askPipeline(q, { provider: loadProviderConfig(), corpus,
    timeoutMs: 120000, maxRetries: 2 }, null);
  process.stdout.write(JSON.stringify({ no, question: q, expect,
    promptVersion: PROMPT_VERSION, pipelineVersion: PIPELINE_VERSION,
    model: r.model, ms: r.ms, attempts: r.attempts ?? 1, attemptsLog: r.attemptsLog ?? [],
    usage: r.usage ?? null, cost: r.usage ? costOfUsage(r.usage) : null,
    status: r.status, answer: r.answer, citations: r.citations,
    evidenceIds: r.evidenceIds, hitIds: r.hitIds ?? [], bestScore: r.bestScore,
    fabricatedIntercepted: r.fabricatedIntercepted ?? [],
    badQuotesIntercepted: r.badQuotesIntercepted ?? [] }));
} catch (e) {
  const al = e.attemptsLog ?? [];
  let cost = null;
  try {
    const agg = al.reduce((a, x) => {
      const u = x.usage || {};
      a.prompt_tokens += Number(u.prompt_tokens || 0);
      a.completion_tokens += Number(u.completion_tokens || 0);
      a.prompt_cache_hit_tokens += Number(u.prompt_cache_hit_tokens || 0);
      a.prompt_cache_miss_tokens += Number(u.prompt_cache_miss_tokens ||
        (Number(u.prompt_tokens || 0) - Number(u.prompt_cache_hit_tokens || 0)));
      return a;
    }, { prompt_tokens:0, completion_tokens:0, prompt_cache_hit_tokens:0, prompt_cache_miss_tokens:0 });
    if (agg.prompt_tokens || agg.completion_tokens) cost = costOfUsage(agg);
  } catch (_) {}
  process.stdout.write(JSON.stringify({ no, question: q, expect,
    promptVersion: PROMPT_VERSION, pipelineVersion: PIPELINE_VERSION,
    error: String(e.message ?? e), code: e.code ?? null,
    attemptsLog: al, cost,
    detail: JSON.parse(JSON.stringify(e.detail ?? {})) }));
}
'''
io.open('pipeline/_one_q_b07.mjs', 'w', encoding='utf-8', newline='\n').write(RUNNER)

QUESTIONS = [
    ('中国的红色政权为什么能够存在？其发生和存在的原因是什么？', None),
    ('毛泽东认为一小块或若干小块红色区域能够存在的前提条件是什么？', None),
    ('井冈山根据地位于什么山脉的什么位置？', None),
    ('八月失败的原因和教训是什么？', None),
    ('湘赣边界的割据局面在湘鄂赣三省的地位如何？', None),
    ('边界党的组织存在什么问题？土籍客籍问题怎么造成的？', None),
    ('割据地区现势部分，边界各县城的情况如何？', None),
    ('军事问题上红军面临的困难有哪些？', None),
    ('土地问题上的分配标准是什么？', None),
    ('政权问题的核心矛盾是什么？如何解决？', None),
    ('革命性质问题的争论焦点是什么？', None),
    ('割据地区问题中，中段、北段、南段哪个最利于割据？为什么？', None),
    ('红色政权存在的五个条件分别是什么？（综合归纳）', None),
    ('边界割据一年多的经验教训，毛泽东是如何总结的？（综合）', None),
    ('文中提到的红军医院的条件如何？缺医少药到什么程度？', None),
    ('罗霄山脉中段作为根据地的地形优势有哪些具体描述？', None),
    ('井冈山时期红军使用的坦克型号是什么？', 'IRRELEVANT'),
    ('这篇文章的作者晚年在哪座城市逝世的？', 'IRRELEVANT'),
    ('薛定谔方程在井冈山斗争中的应用是什么？', 'IRRELEVANT'),
    ('1929年红军长征的路线是怎样的？', 'IRRELEVANT'),
]


def sha16(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()[:16]


raw_corpus = io.open('site/data/sample-topic.json', encoding='utf-8').read()
manifest = {
    'run': RUN,
    'purpose': 'B07 — 经批准的 50 元预算下，用生产所用模型（DeepSeek deepseek-flash）重跑冻结 20 题',
    'model': 'deepseek-flash',
    'providerUrl': 'https://api.deepseek.com',
    'promptVersion': 'wp07-r2',
    'pipelineVersion': 'wp07-r3',
    'retrieve': {'top': 8, 'minScore': 2, 'expandNeighbors': True},
    'maxRetries': 2,
    'corpusSha256_16': sha16(raw_corpus),
    'questionsSha256_16': sha16(json.dumps([q for q, _ in QUESTIONS], ensure_ascii=False)),
    'questionCount': len(QUESTIONS),
    'startedAt': time.strftime('%Y-%m-%dT%H:%M:%S'),
}
io.open(MANIFEST, 'w', encoding='utf-8').write(json.dumps(manifest, ensure_ascii=False, indent=1))
print('manifest:', json.dumps(manifest, ensure_ascii=False), flush=True)

if os.path.exists(OUT):
    raise SystemExit(f'{OUT} 已存在 — 本轮为冻结全量重跑，请先删除旧结果再运行（不沿用任何旧结果）。')

env = dict(os.environ)
env.update({
    'PROVIDER_URL': 'https://api.deepseek.com',
    'PROVIDER_KEY': deepseek_key(),
    'MODEL_ID': 'deepseek-flash',
    'PROVIDER_TIMEOUT_MS': '120000',
})

recs = {}


def append_hist(no, q, expect, rec):
    with io.open(HIST, 'a', encoding='utf-8') as f:
        f.write(json.dumps({'ts': time.strftime('%Y-%m-%dT%H:%M:%S'), 'no': no,
                            'question': q, 'expect': expect, **rec},
                           ensure_ascii=False) + '\n')


for no, (q, tag) in enumerate(QUESTIONS, 1):
    print(f'[{no}/{len(QUESTIONS)}] {q[:26]}', flush=True)
    try:
        r = subprocess.run(['node', 'pipeline/_one_q_b07.mjs', str(no), q, tag or 'ANSWERABLE'],
                           capture_output=True, text=True, timeout=420, env=env)
        out = r.stdout.strip()
        try:
            rec = json.loads(out)
        except Exception:
            rec = {'no': no, 'question': q, 'expect': tag or 'ANSWERABLE',
                   'error': 'bad output: ' + (out[:200] or r.stderr[:200])}
    except subprocess.TimeoutExpired:
        rec = {'no': no, 'question': q, 'expect': tag or 'ANSWERABLE', 'error': 'timeout 420s'}
    append_hist(no, q, tag or 'ANSWERABLE', rec)
    if rec.get('error'):
        print('   -> ERROR', rec['error'][:90], flush=True)
    elif rec.get('status') == 'insufficient':
        print('   -> INSUFFICIENT', flush=True)
    else:
        c = rec.get('cost') or {}
        print(f"   -> {rec.get('status')} {len(rec.get('citations', []))} cits "
              f"{rec.get('attempts')} att {rec.get('ms')} ms "
              f"{c.get('cny') if isinstance(c, dict) else c} CNY", flush=True)
    recs[no] = rec
    with io.open(OUT, 'w', encoding='utf-8') as f:
        json.dump([recs[k] for k in sorted(recs)], f, ensure_ascii=False, indent=1)
    if no < len(QUESTIONS):
        time.sleep(3)

print('ALL DONE ->', OUT, '| history ->', HIST, flush=True)
