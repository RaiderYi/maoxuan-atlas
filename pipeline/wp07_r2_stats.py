# -*- coding: utf-8 -*-
"""WP07 r2 验收统计: 状态分布 / 引用100%在证据 / 引文逐字命中 / 邻段扩展比例 / 尝试分布"""
import json, io, re, sys
os_sep_note = "run in repo_stage"
import os
os.chdir(r'D:/工作/maoxuan_viz/repo_stage')
recs = json.load(io.open('pipeline/wp07-20q-records-r2.json', encoding='utf-8'))
d = json.load(io.open('site/data/sample-topic.json', encoding='utf-8'))
txt = {}
for a in d['articles'].values():
    for p in a['paragraphs']:
        txt[p['id']] = p['text']
norm = lambda s: re.sub(r'[\s\u3000]', '', s)

n = len(recs)
errs = [r for r in recs if r.get('error')]
oks = [r for r in recs if not r.get('error')]
ans = [r for r in oks if r.get('status') == 'answered']
par = [r for r in oks if r.get('status') == 'partial']
ins = [r for r in oks if r.get('status') == 'insufficient']

print(f'total={n}  errors={len(errs)}  answered={len(ans)}  partial={len(par)}  insufficient={len(ins)}')
for r in errs:
    print(f"  ERR  Q{r['no']}: {r.get('error','')[:70]} (retried={r.get('_retried',0)})")

# 引用 ID 100% 在证据
bad_ids = []
for r in oks:
    ev = set(r.get('evidenceIds', []))
    for c in r.get('citations', []):
        if c['id'] not in ev:
            bad_ids.append((r['no'], c['id']))
print(f'citation ids 100% in evidence: {not bad_ids}' + (f'  VIOLATIONS: {bad_ids}' if bad_ids else ''))

# 引文逐字命中段落原文 (口径: 本段 或 与紧邻段拼接 — 切段边界处的连续引文合法;
#                       剥离注号⑴-⑿ 与空白 — 注号是编辑标记非原文)
tot = 0; badq = []
arts = {aid: {p['id']: p for p in a['paragraphs']} for aid, a in d['articles'].items()}
norm2 = lambda s: re.sub(r'[\s\u3000⑴-⑿]', '', s)
for r in oks:
    for c in r.get('citations', []):
        tot += 1
        pid = c['id']; aid = pid[1:].split('-')[0]
        p = arts[aid][pid]; seq = p['seq']
        cand = [p['text']]
        nxt = arts[aid].get('p%s-%03d' % (aid, seq + 1)); prv = arts[aid].get('p%s-%03d' % (aid, seq - 1))
        if nxt: cand.append(p['text'] + nxt['text'])
        if prv: cand.append(prv['text'] + p['text'])
        if not any(norm2(c.get('quote', '')) in norm2(t) for t in cand):
            badq.append((r['no'], c['id'], c.get('quote', '')[:20]))
print(f'quote exact-in-paragraph (or adjacent join, notes stripped): {tot-len(badq)}/{tot}' + (f'  BAD: {badq}' if badq else ''))

# 邻段扩展: evidenceIds 中不在 hitIds 的比例 (扩展上下文段)
ext = [len(set(r.get('evidenceIds',[])) - set(r.get('hitIds',[]))) for r in oks if r.get('hitIds')]
if ext:
    print(f'neighbor-extension paras per q: avg={sum(ext)/len(ext):.1f} max={max(ext)}')

# 尝试分布 & 耗时
atts = [r.get('attempts',1) for r in oks]
mss = [r['ms'] for r in oks]
print(f'attempts: 1x={atts.count(1)} 2x={atts.count(2)} 3x={atts.count(3)}  avg_ms={sum(mss)//len(mss)}')
multi = [(r['no'], r.get('attempts')) for r in oks if r.get('attempts',1)>1]
print('multi-attempt questions:', multi)
fab = sum(len(r.get('fabricatedIntercepted',[])) for r in oks)
print(f'fabricated ids intercepted after retry-feedback: {fab}')

# partial 按语检查
for r in par:
    has = '按语：' in (r.get('answer') or '')
    print(f"partial Q{r['no']}: has-analyze-note={has}")

# 期望符合性
irr = [r for r in oks if r.get('expect')=='IRRELEVANT']
okirr = [r for r in irr if r.get('status')=='insufficient']
print(f'irrelevant correctly refused: {len(okirr)}/{len(irr)}')
ansb = [r for r in oks if r.get('expect')=='ANSWERABLE']
okans = [r for r in ansb if r.get('status') in ('answered','partial')]
print(f'answerable answered-or-partial: {len(okans)}/{len(ansb)}')
