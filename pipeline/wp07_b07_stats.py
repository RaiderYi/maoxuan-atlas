# -*- coding: utf-8 -*-
"""B07 统计：20 题（DeepSeek deepseek-flash）状态分布 / 引用有效性 / 引文逐字 / 延迟 / 成本
口径与 wp07_r3_stats.py 一致，便于与 r3(GLM-5.3) 横向对照。
运行：python pipeline/wp07_b07_stats.py
"""
import json, io, re, os, statistics as st
from collections import Counter

os.chdir(r'D:/工作/maoxuan_viz/repo_stage')
RUN = 'b07'
recs = json.load(io.open(f'pipeline/wp07-20q-records-{RUN}.json', encoding='utf-8'))
HIST = f'pipeline/wp07-20q-history-{RUN}.jsonl'
man = json.load(io.open(f'pipeline/wp07-{RUN}-manifest.json', encoding='utf-8'))
d = json.load(io.open('site/data/sample-topic.json', encoding='utf-8'))
arts = {aid: {p['id']: p for p in a['paragraphs']} for aid, a in d['articles'].items()}
norm2 = lambda s: re.sub(r'[\s\u3000⑴-⑿]', '', s)

n = len(recs)
errs = [r for r in recs if r.get('error')]
oks = [r for r in recs if not r.get('error')]
ans = [r for r in oks if r.get('status') == 'answered']
par = [r for r in oks if r.get('status') == 'partial']
ins = [r for r in oks if r.get('status') == 'insufficient']
ansable = [r for r in recs if r.get('expect') == 'ANSWERABLE']
irrel = [r for r in recs if r.get('expect') == 'IRRELEVANT']

print(f'===== B07 验收（{man["model"]} / prompt {man["promptVersion"]} / pipeline {man["pipelineVersion"]}）=====')
print(f'corpus={man["corpusSha256_16"]}  questions={man["questionsSha256_16"]}  started={man["startedAt"]}')
print(f'total={n}  errors={len(errs)}  answered={len(ans)}  partial={len(par)}  insufficient={len(ins)}')
for r in errs:
    print(f"  ERR  Q{r['no']}: {r.get('error','')[:80]}")

# 1) 返回率 (answered+partial) / 全 20 题
ret_all = len(ans) + len(par)
print(f'\n[返回] 20 题中给出答案(answered+partial) = {ret_all}/{n} = {ret_all/n:.0%}')
ret_ans = len([r for r in ansable if r.get('status') in ('answered', 'partial')])
print(f'[返回] 可答题 16 题中 = {ret_ans}/{len(ansable)} = {ret_ans/len(ansable):.0%}'
      f'（调用失败 {len([r for r in ansable if r.get("error")])} 题计入分母）')

# 2) 拒答: 应拒答的 4 题是否拒答; 可答题是否被误拒
ok_irr = [r for r in irrel if r.get('status') == 'insufficient']
print(f'[拒答] 资料外问题正确拒答 = {len(ok_irr)}/{len(irrel)}')
wrong_refuse = [r for r in ansable if r.get('status') == 'insufficient']
print(f'[拒答] 可答题被误拒 = {len(wrong_refuse)}/{len(ansable)}' +
      (f'  误拒题号: {[r["no"] for r in wrong_refuse]}' if wrong_refuse else ''))

# 3) 引用 ID 必须在证据集合内
bad_ids = []
for r in oks:
    ev = set(r.get('evidenceIds', []))
    for c in r.get('citations', []):
        if c['id'] not in ev:
            bad_ids.append((r['no'], c['id']))
print(f'\n[引用] id 100% 在证据内: {not bad_ids}' +
      (f'  违规: {bad_ids}' if bad_ids else ''))

# 4) 引文逐字命中（正序拼接口径：本段 / 上段+本段 / 本段+下段）
tot = 0
badq = []
for r in oks:
    for c in r.get('citations', []):
        tot += 1
        pid = c['id']
        aid = pid[1:].split('-')[0]
        p = arts[aid][pid]
        seq = p['seq']
        cands = [p['text']]
        nxt = arts[aid].get('p%s-%03d' % (aid, seq + 1))
        prv = arts[aid].get('p%s-%03d' % (aid, seq - 1))
        if nxt:
            cands.append(p['text'] + nxt['text'])
        if prv:
            cands.append(prv['text'] + p['text'])
        if not any(norm2(c.get('quote', '')) in norm2(t) for t in cands):
            badq.append((r['no'], c['id'], c.get('quote', '')[:20]))
print(f'[引用] 引文逐字命中 = {tot-len(badq)}/{tot}' + (f'  BAD: {badq}' if badq else ''))

# 5) 延迟
mss = sorted(r['ms'] for r in oks if isinstance(r.get('ms'), int))
if mss:
    p50 = mss[len(mss)//2]
    print(f'\n[延迟] n={len(mss)}  avg={sum(mss)//len(mss)}ms  p50={p50}ms  max={max(mss)}ms  min={min(mss)}ms')

# 6) 成本
costs = [r['cost']['cny'] for r in oks if isinstance(r.get('cost'), dict) and isinstance(r['cost'].get('cny'), (int, float))]
errcosts = [r['cost']['cny'] for r in errs if isinstance(r.get('cost'), dict) and isinstance(r['cost'].get('cny'), (int, float))]
allc = costs + errcosts
print(f'[成本] 成功题 {len(costs)} 题合计 {sum(costs):.6f} 元；失败题已计费 {len(errcosts)} 题 {sum(errcosts):.6f} 元')
if allc:
    print(f'[成本] 全部合计 {sum(allc):.6f} 元，单题均值 {sum(allc)/len(allc):.6f} 元')
tokens = sum((r.get('usage') or {}).get('prompt_tokens', 0) + (r.get('usage') or {}).get('completion_tokens', 0)
             for r in oks if r.get('usage'))
print(f'[成本] token 总量（成功题）≈ {tokens}')

# 7) 重试与拦截
atts = [r.get('attempts', 1) for r in oks]
print(f'\n[重试] 1 次成功={atts.count(1)}  2 次={atts.count(2)}  3 次={atts.count(3)}')
fab = sum(len(r.get('fabricatedIntercepted', [])) for r in oks) + sum(len(r.get('badQuotesIntercepted', [])) for r in oks)
print(f'[守卫] 虚构 id / 伪造引文被拦截 = {fab} 处')
for r in par:
    print(f"[按语] partial Q{r['no']}: 含按语={'按语：' in (r.get('answer') or '')}")

# 8) 历史文件还原性
try:
    hist = [json.loads(l) for l in io.open(HIST, encoding='utf-8') if l.strip()]
    cnt = Counter(h['no'] for h in hist)
    multi = {k: v for k, v in cnt.items() if v > 1}
    print(f'\n[留痕] history {len(hist)} 条尝试，多次尝试题号: {multi if multi else "无"}')
except FileNotFoundError:
    print('\n[留痕] history: not found')

print('\nNOTE: 返回 ≠ 事实正确。事实正确率需 B08 人工核验（100 题口径）；本表只给返回率/拒答率/引用有效性/延迟/成本。')
