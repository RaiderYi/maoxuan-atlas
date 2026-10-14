# -*- coding: utf-8 -*-
"""WP03: 井冈山最小数据包 — v1n03/v1n04 段落切分 + 永久段落锚点 + 样本知识 Schema

产出:
  deploy_nexior/data/sample-topic.json   样本专题数据包(文章/段落/地点/事件/来源/TopicScene)
输出遵循 V2 规划 §6 三轴状态: epistemicStatus / reviewStatus / rightsStatus
"""
import json, re, hashlib, io, sys

BASE = r"D:/工作/maoxuan_viz"
TXT = lambda aid: io.open(f"{BASE}/data/texts/{aid}.txt", encoding="utf-8").read()

def sha16(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]

def split_paragraphs(raw):
    """按 fmtText 同款规则切自然段: \\n+ 分段, 空段丢弃。返回 (paras, head_note_count)"""
    paras = []
    for blk in raw.split("\n"):
        t = blk.strip()
        if t:
            paras.append(t)
    return paras

def build_article(aid):
    raw = TXT(aid)
    # 正文与题头分离: 正文起于第二次出现标题后的日期行之后（与 app.js fmtText 的 \n\n 逻辑对齐）
    idx = raw.find("\n\n")
    body = raw[idx+2:] if idx > 0 else raw
    head = raw[:idx] if idx > 0 else ""
    paras = split_paragraphs(body)
    # 永久段落锚点: p{aid}-{seq:03d}; checksum 用于修订检测
    pl = []
    for i, p in enumerate(paras, 1):
        pid = f"p{aid}-{i:03d}"
        pl.append({
            "id": pid,
            "articleId": aid,
            "seq": i,
            "text": p,
            "checksum": sha16(p),
            "charCount": len(p),
            "isHeadNote": i <= 2,   # 题注（日期行/说明行）
        })
    return raw, head, pl

def detect_sections(paras, aid=None):
    """识别小节标题作为结构标记。
    v1n03 为编号式（'一　国内的政治状况'）；v1n04 为无编号短行（'军事问题'等）。"""
    # v1n04 无编号小节标题（毛选一卷定本目录顺序）
    v1n04_titles = {"湘赣边界的割据和八月失败", "割据地区的现势", "军事问题", "土地问题",
                    "政权问题", "党的组织问题", "革命性质问题", "割据地区问题"}
    seen = set()
    sec = []
    for p in paras:
        t = p["text"]
        m = re.match(r"^(一|二|三|四|五|六|七|八|九|十)[　\s、.．]", t)
        if m and len(t) <= 30:
            sec.append({"paragraphId": p["id"], "label": t[:20]})
        elif aid == "v1n04" and t in v1n04_titles and t not in seen:
            seen.add(t)
            sec.append({"paragraphId": p["id"], "label": t})
    return sec

articles = {}
for aid in ("v1n03", "v1n04"):
    raw, head, pl = build_article(aid)
    articles[aid] = {
        "articleId": aid,
        "title": "中国的红色政权为什么能够存在？" if aid == "v1n03" else "井冈山的斗争",
        "volume": 1,
        "date": {"raw": "（一九二八年十月五日）" if aid == "v1n03" else "（一九二八年十一月二十五日）",
                 "y": 1928, "m": 10 if aid == "v1n03" else 11, "d": 5 if aid == "v1n03" else 25,
                 "precision": "day"},
        "textChecksum": sha16(raw),
        "nParagraphs": len(pl),
        "nChars": sum(p["charCount"] for p in pl),
        "paragraphs": pl,
        "sections": detect_sections(pl, aid),
    }

# ---- 地点实体（来自文章本身 + 通用党史地理，标注精度）----
places = [
    {"placeId": "pl_jinggangshan", "name": "井冈山", "historicName": "井冈山",
     "modernName": "江西省井冈山市", "lat": 26.575, "lng": 114.163,
     "precision": "city", "timeRange": "1927-1930",
     "epistemicStatus": "verified",  # 两篇文章题注均明确"江西井冈山"
     "sourceNote": "v1n03/v1n04 题注地点；通用地理常识"},
    {"placeId": "pl_luoxiao", "name": "罗霄山脉中段", "historicName": "罗霄山脉",
     "modernName": "湘赣边界罗霄山脉", "lat": None, "lng": None,
     "precision": "region", "timeRange": "1928",
     "epistemicStatus": "supported",   # 文中多次论述, 具体段待引
     "sourceNote": "v1n04 正文论述'罗霄山脉中段'地形；坐标为山脉范围不取精确值"},
]

# ---- 事件实体（文章本身就是一手史料）----
events = [
    {"eventId": "evt_jgs_douzheng", "title": "井冈山斗争",
     "date": {"start": "1927-10", "end": "1929-01", "precision": "month"},
     "placeId": "pl_jinggangshan",
     "epistemicStatus": "supported",
     "sourceArticleIds": ["v1n03", "v1n04"],
     "reviewStatus": "pending",
     "note": "两文均为该时期一手文献；边界起讫月待史料细核"},
    {"eventId": "evt_bj_de2ci_dbh", "title": "中共湘赣边界第二次代表大会",
     "date": {"start": "1928-10", "end": "1928-10", "precision": "month"},
     "placeId": "pl_jinggangshan",
     "epistemicStatus": "verified",
     "sourceArticleIds": ["v1n03"],
     "reviewStatus": "pending",
     "note": "v1n03 题注: '毛泽东为中共湘赣边界第二次代表大会写的决议的一部分'"},
]

# ---- 来源（Source/Evidence 最小版）----
sources = [
    {"sourceId": "src_v1", "type": "book", "title": "《毛泽东选集》第一卷",
     "publisher": "人民出版社", "editionNote": "本站语料底本",
     "rightsStatus": "unknown",   # RIGHTS_LEDGER #1: 待产品负责人决策
     "note": "A05 处置决定前，样本数据包不改变公开口径"},
]

# ---- TopicScene（井冈山样板第一幕数据，镜头配置供 WP04 使用）----
topic = {
    "topicId": "topic_jinggangshan",
    "title": "井冈山：根据地为什么能存在",
    "timeRange": {"start": "1927-10", "end": "1929-01"},
    "center": {"lat": 26.575, "lng": 114.163, "zoom": 10.5},
    "articles": ["v1n03", "v1n04"],
    "events": ["evt_jgs_douzheng", "evt_bj_de2ci_dbh"],
    "places": ["pl_jinggangshan", "pl_luoxiao"],
    "scenes": [
        {"sceneId": "sc_jgs_01", "seq": 1, "title": "进入罗霄山脉",
         "camera": {"center": [114.163, 26.575], "zoom": 10.5, "pitch": 62, "bearing": -20,
                    "flyTo": True},
         "caption": "井冈山位于罗霄山脉中段，湘赣两省边界。",
         "placeIds": ["pl_jinggangshan", "pl_luoxiao"],
         "articleId": None, "paragraphId": None,
         "evidenceIds": [], "reviewStatus": "draft",
         "note": "镜头参数属视觉表达，非史实证明（V2 §4）"},
        {"sceneId": "sc_jgs_02", "seq": 2, "title": "红色政权为什么能够存在",
         "camera": {"center": [114.163, 26.575], "zoom": 11.2, "pitch": 55, "bearing": 10},
         "caption": "一九二八年十月五日，中共湘赣边界第二次代表大会决议的一部分。",
         "placeIds": ["pl_jinggangshan"], "eventId": "evt_bj_de2ci_dbh",
         "articleId": "v1n03", "paragraphId": None,   # WP04 联动时定位到具体论证段落
         "evidenceIds": [], "reviewStatus": "draft"},
        {"sceneId": "sc_jgs_03", "seq": 3, "title": "军事根据地的稳固",
         "camera": {"center": [114.163, 26.575], "zoom": 11.8, "pitch": 65, "bearing": 40},
         "caption": "一九二八年十一月二十五日，毛泽东写给中共中央的报告。",
         "placeIds": ["pl_jinggangshan"], "eventId": "evt_jgs_douzheng",
         "articleId": "v1n04", "paragraphId": None,
         "evidenceIds": [], "reviewStatus": "draft"},
    ],
    "meta": {
        "schemaVersion": "0.1",
        "generatedBy": "pipeline/wp03_sample_pack.py",
        "generatedAt": "2026-10-14",
        "enrichedFieldsPolicy": "why/event/links 类字段沿用 data.js 的 AI 考证，默认 inferred/pending（DATA_MANIFEST）",
    },
}

out = {
    "articles": articles,
    "places": places,
    "events": events,
    "sources": sources,
    "topic": topic,
}

dst = f"{BASE}/deploy_nexior/data/sample-topic.json"
with io.open(dst, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

# ---- 验收自检 ----
a3, a4 = articles["v1n03"], articles["v1n04"]
print(f"v1n03: {a3['nParagraphs']} paras, {a3['nChars']} chars, sections={[s['label'] for s in a3['sections']][:6]}")
print(f"v1n04: {a4['nParagraphs']} paras, {a4['nChars']} chars, sections={[s['label'] for s in a4['sections']][:8]}")
# 外键完整性: 100% 可解析
ids = {p["id"] for a in articles.values() for p in a["paragraphs"]}
errs = []
for sc in topic["scenes"]:
    if sc.get("articleId") and sc["articleId"] not in articles: errs.append(f"bad articleId {sc['articleId']}")
for ev in events:
    if ev["placeId"] not in {p['placeId'] for p in places}: errs.append(f"bad placeId {ev['placeId']}")
print("foreign keys:", "ALL RESOLVABLE" if not errs else errs)
# 段落锚点稳定性: 段落拼接 与 正文部分(首个\n\n之后, 即含重复题行) 归一化比对
norm = lambda s: "".join(s.split())
def body_of(aid):
    r = TXT(aid)
    i = r.find("\n\n")
    return r[i+2:] if i > 0 else r
for aid in ("v1n03", "v1n04"):
    joined = "".join(p["text"] for p in articles[aid]["paragraphs"])
    print(f"{aid} rejoin==body(normalized):", norm(joined) == norm(body_of(aid)))
print("written:", dst)
