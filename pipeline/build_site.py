# -*- coding: utf-8 -*-
"""build_site.py: 合并数据 → site/ 静态站
- data/articles_full.json + enriched.jsonl → data.js (var DATA={...})
- 逐篇texts瘦身（去页眉噪音），输出到 site/data/texts/
- 复制 index.html 模板（含echarts本地）
"""
import json, os, re, shutil

ROOT = r"D:\工作\maoxuan_viz"
arts = json.load(open(f"{ROOT}/data/articles_full.json", encoding="utf-8"))
enr = {}
for line in open(f"{ROOT}/data/enriched.jsonl", encoding="utf-8"):
    try:
        o = json.loads(line); enr[o["id"]] = o
    except: pass
print("enriched:", len(enr), "/", len(arts))

CHN = {'〇':0,'零':0,'○':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9}
def chn2num(s):
    if s.isdigit(): return int(s)
    y=0
    for ch in s:
        if ch in CHN and CHN[ch]<=9: y=y*10+CHN[ch]
    return y
def chn_month(s):
    s = s.replace('月','')
    if s.isdigit(): return int(s)
    if s=='十': return 10
    if '十' in s:
        a,b = s.split('十'); return (CHN.get(a,1) if a else 1)*10+(CHN.get(b,0) if b else 0)
    return CHN.get(s)

def parse_date(dr):
    import re
    m = re.search(r'一九([〇零○一二三四五六七八九十\d]+)年(?:([〇零○一二三四五六七八九十\d]+)月)?(?:([〇零○一二三四五六七八九十\d]+)日)?', dr or '')
    if not m: return None, None, None
    y = 1900 + chn2num(m.group(1)); mo = chn_month(m.group(2)) if m.group(2) else 1
    d = chn_month(m.group(3)) if m.group(3) else 1
    return y, mo, d

articles = []
for a in arts:
    y, mo, d = parse_date(a["date_raw"])
    e = enr.get(a["id"], {})
    articles.append({
        "id": a["id"], "vol": a["vol"], "title": a["title"], "dateRaw": a["date_raw"],
        "y": y, "m": mo, "d": d,
        "place": e.get("place",""), "lat": e.get("lat"), "lng": e.get("lng"),
        "era": e.get("era",""), "why": e.get("why",""), "event": e.get("event",""),
        "links": e.get("links",[]), "nChars": a["n_chars"], "startPage": a["start_page"],
        "text": a["text"],
    })
# validate lat/lng
bad = [a["id"] for a in articles if not a["lat"] or not a["lng"] or not (18<a["lat"]<54 and 73<a["lng"]<136)]
print("bad coords:", len(bad), bad[:10])
import collections
print("era dist:", dict(collections.Counter(a["era"] for a in articles)))
print("places:", len(set(a["place"] for a in articles if a["place"])))
json.dump(articles, open(f"{ROOT}/data/merged.json","w",encoding="utf-8"), ensure_ascii=False)

# data.js for site (split texts into separate files to keep main payload small)
os.makedirs(f"{ROOT}/site/data/texts", exist_ok=True)
meta = []
for a in articles:
    t = a.pop("text")
    open(f"{ROOT}/site/data/texts/{a['id']}.txt","w",encoding="utf-8").write(t)
    meta.append(a)
with open(f"{ROOT}/site/data/data.js","w",encoding="utf-8") as f:
    f.write("const DATA=" + json.dumps(meta, ensure_ascii=False) + ";")
print("site data written:", len(meta), "articles; data.js",
      round(os.path.getsize(f"{ROOT}/site/data/data.js")/1024), "KB")
