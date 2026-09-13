# -*- coding: utf-8 -*-
"""Phase1: 毛选PDF切分217篇 → articles.json + texts/"""
import fitz, json, os, re

PDF = r"C:\Users\选择永恒\Desktop\个人读书\毛泽东选集（1-5卷） (毛泽东) (Z-Library).pdf"
OUT = r"D:\工作\maoxuan_viz\data"
os.makedirs(os.path.join(OUT, "texts"), exist_ok=True)

doc = fitz.open(PDF)
toc = doc.get_toc()

# build article list
vols = ["第一卷", "第二卷", "第三卷", "第四卷", "第五卷"]
articles = []
cur_vol = None
cur_vol_num = 0
for i, (lvl, title, page) in enumerate(toc):
    if lvl == 1:
        cur_vol = title
        cur_vol_num = vols.index(title) + 1
        continue
    # next toc page for end boundary
    nxt = toc[i+1][2] if i+1 < len(toc) else doc.page_count + 1
    articles.append({
        "idx": len(articles) + 1,
        "vol": cur_vol_num,
        "vol_name": cur_vol,
        "title_raw": title,
        "start_page": page,
        "end_page": nxt - 1,
    })

print("articles:", len(articles))

# volume 5 starts a new numbering "01、" per volume; strip leading num
def clean_title(t):
    m = re.match(r'^\d+、(.*)$', t)
    return m.group(1).strip() if m else t.strip()

DATE_RE = re.compile(r'[（(]\s*一九[一二三四五六七八九十〇零○\d]*年(?:[一二三四五六七八九十〇零○\d]*月)?(?:[一二三四五六七八九十〇零○\d]*日)?\s*[）)]')

results = []
for a in articles:
    # extract full text of the article's page range
    txts = []
    for pg in range(a["start_page"] - 1, min(a["end_page"], doc.page_count)):
        txts.append(doc[pg].get_text())
    full = "\n".join(txts).strip()
    head = full[:600]
    # date: usually in first parens within head
    dm = DATE_RE.search(head)
    date_str = dm.group(0) if dm else ""
    # background note: first paragraph after date that starts with "这是" or similar annotation
    bg = ""
    para_split = re.split(r'\n\s*\n|\n(?=[^\s])', full)
    for p in para_split[1:8]:
        ps = p.strip().replace('\n', '')
        if len(ps) > 25 and (ps.startswith('这是') or ps.startswith('本文是') or ps.startswith('这是毛泽东')):
            bg = ps
            break
    a_out = {
        "id": f"v{a['vol']}a{a['idx'] if a['vol']==1 else a['idx'] - sum(1 for x in articles[:a['idx']-1] if x['vol']!=a['vol']) if False else ''}",
    }
    # simpler id: v{vol}_{seq_in_vol}
    results.append(a)
    a["title"] = clean_title(a["title_raw"])
    a["date_raw"] = date_str
    a["background"] = bg
    a["text"] = full
    a["n_chars"] = len(full)
    # write per-article text file
    seq = sum(1 for x in articles[:a["idx"]-1] if x["vol"] == a["vol"])
    a["id"] = f"v{a['vol']}n{seq+1:02d}"
    with open(os.path.join(OUT, "texts", a["id"] + ".txt"), "w", encoding="utf-8") as f:
        f.write(f"{a['title']}\n{date_str}\n\n{full}")

# assemble json (text kept in separate files to keep json slim; also embed for search)
meta = [{k: v for k, v in a.items() if k != "text"} for a in articles]
with open(os.path.join(OUT, "articles.json"), "w", encoding="utf-8") as f:
    json.dump(meta, f, ensure_ascii=False, indent=1)
# full data with text for the site build
with open(os.path.join(OUT, "articles_full.json"), "w", encoding="utf-8") as f:
    json.dump(articles, f, ensure_ascii=False)

# stats
no_date = [a["id"] + " " + a["title"] for a in articles if not a["date_raw"]]
no_bg = sum(1 for a in articles if not a["background"])
print("no_date:", len(no_date)); [print("  ", x) for x in no_date[:15]]
print("no_background:", no_bg, "/", len(articles))
print("total chars:", sum(a["n_chars"] for a in articles))
print("sample:", json.dumps({k: articles[0][k] for k in ("id","vol","title","date_raw","background","n_chars")}, ensure_ascii=False, indent=1)[:500])
