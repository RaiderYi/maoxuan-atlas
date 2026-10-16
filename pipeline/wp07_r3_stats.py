# -*- coding: utf-8 -*-
"""WP07-r3 验收统计: 状态分布 / 引用100%在证据 / 引文逐字命中(正序拼接口径) / 邻段扩展 / 尝试分布 / 分母=16"""
import json, io, re, os
from collections import Counter
os.chdir(r'D:/工作/maoxuan_viz/repo_stage')
RUN = 'r3'
recs = json.load(io.open(f'pipeline/wp07-20q-records-{RUN}.json', encoding='utf-8'))
HIST = f'pipeline/wp07-20q-history-{RUN}.jsonl'
d = json.load(io.open('site/data/sample-topic.json', encoding='utf-8'))
arts = {aid: {p['id']: p for p in a['paragraphs']} for aid, a in d['articles'].items()}
norm2 = lambda s: re.sub(r'[\s\u3000⑴-⑿]', '', s)

n = len(recs)
errs = [r for r in recs if r.get('error')]
oks = [r for r in recs if not r.get('error')]
ans = [r for r in oks if r.get('status') == 'answered']
par = [r for r in oks if r.get('status') == 'partial']
ins = [r for r in oks if r.get('status') == 'insufficient']

print(f'===== WP07-{RUN} 验收 =====')
print(f'total={n}  errors={len(errs)}  answered={len(ans)}  partial={len(par)}  insufficient={len(ins)}')
for r in errs:
    print(f"  ERR  Q{r['no']}: {r.get('error','')[:80]}")

# 引用 ID 100% 在证据
bad_ids = []
for r in oks:
    ev = set(r.get('evidenceIds', []))
    for c in r.get('citations', []):
        if c['id'] not in ev: bad_ids.append((r['no'], c['id']))
print(f'citation ids 100% in evidence: {not bad_ids}' + (f'  VIOLATIONS: {bad_ids}' if bad_ids else ''))

# 引文逐字命中 (正序拼接口径: 本段 或 上一段+本段 或 本段+下一段)
tot = 0; badq = []
for r in oks:
    for c in r.get('citations', []):
        tot += 1
        pid = c['id']; aid = pid[1:].split('-')[0]
        p = arts[aid][pid]; seq = p['seq']
        cands = [p['text']]
        nxt = arts[aid].get('p%s-%03d' % (aid, seq + 1)); prv = arts[aid].get('p%s-%03d' % (aid, seq - 1))
        if nxt: cands.append(p['text'] + nxt['text'])
        if prv: cands.append(prv['text'] + p['text'])
        if not any(norm2(c.get('quote', '')) in norm2(t) for t in cands):
            badq.append((r['no'], c['id'], c.get('quote', '')[:20]))
print(f'quote exact (forward-order adjacent join, notes stripped): {tot-len(badq)}/{tot}' + (f'  BAD: {badq}' if badq else ''))

# 邻段扩展
ext = [len(set(r.get('evidenceIds', [])) - set(r.get('hitIds', []))) for r in oks if r.get('hitIds')]
if ext: print(f'neighbor-extension paras per q: avg={sum(ext)/len(ext):.1f} max={max(ext)}')

# 尝试分布
atts = [r.get('attempts', 1) for r in oks]
mss = [r['ms'] for r in oks]
print(f'attempts: 1x={atts.count(1)} 2x={atts.count(2)} 3x={atts.count(3)}  avg_ms={sum(mss)//len(mss)}')
print('multi-attempt questions:', [(r['no'], r.get('attempts')) for r in oks if r.get('attempts', 1) > 1])
fab = sum(len(r.get('fabricatedIntercepted', [])) for r in oks) + sum(len(r.get('badQuotesIntercepted', [])) for r in oks)
print(f'fabricated/bad-quote ids intercepted: {fab}')

# partial 按语
for r in par:
    print(f"partial Q{r['no']}: has-analyze-note={'按语：' in (r.get('answer') or '')}")

# 期望符合性 — 分母 = 可答题 16 (含失败)
irr = [r for r in oks if r.get('expect') == 'IRRELEVANT']
okirr = [r for r in irr if r.get('status') == 'insufficient']
print(f'irrelevant correctly refused: {len(okirr)}/{len(irr)}')
ALL_ANS = [r for r in recs if r.get('expect') == 'ANSWERABLE']
okans = [r for r in ALL_ANS if r.get('status') in ('answered', 'partial')]
err_ans = [r for r in ALL_ANS if r.get('error')]
print(f'answerable (denominator=16 incl. failures): returned answered-or-partial {len(okans)}/{len(ALL_ANS)}, call-failed {len(err_ans)}/{len(ALL_ANS)}')
print('NOTE: returned != factually correct; correctness requires human/content review')

# history 还原性
try:
    hist = [json.loads(l) for l in io.open(HIST, encoding='utf-8') if l.strip()]
    cnt = Counter(h['no'] for h in hist)
    print(f'history: {len(hist)} attempts logged, questions with >1 attempt: {{k:v for k,v in cnt.items() if v>1}}')
except FileNotFoundError:
    print('history: not found')
