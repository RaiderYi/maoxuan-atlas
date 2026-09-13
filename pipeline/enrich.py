# -*- coding: utf-8 -*-
"""Phase1b: LLM逐篇考证 地点/背景/事件/关联 → enriched.json"""
import json, time, urllib.request, os, sys

API = "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions"
KEY = open("data/.key").read().strip()

arts = json.load(open("data/articles_full.json", encoding="utf-8"))
OUT_F = "data/enriched.jsonl"
done = set()
if os.path.exists(OUT_F):
    for line in open(OUT_F, encoding="utf-8"):
        try: done.add(json.loads(line)["id"])
        except: pass
print(f"already enriched: {len(done)}/{len(arts)}", flush=True)

PROMPT = """你是党史文献研究助手。对下面这篇《毛泽东选集》文章做结构化考证。只依据文章本身的日期、题注和正文线索，常识可补充，但不得虚构。

输出严格JSON（不要markdown代码块）：
{{
 "place": "写作地点（市/县级，如：江西井冈山、陕西延安、河北西柏坡、北平、北京、陕北靖边县青阳岔。无法确定写具体推断：瑞金时期在中央苏区通常写'江西瑞金'）",
 "lat": 纬度浮点,
 "lng": 经度浮点,
 "era": "革命阶段（大革命时期/土地革命战争时期/抗日战争时期/解放战争时期/社会主义革命和建设时期）",
 "why": "为什么写这篇文章：1-2句话，因果链（针对什么问题/回应什么事件/为谁而写）",
 "event": "关联历史事件（短词，如：井冈山斗争、长征、六届六中全会、辽沈战役。没有则写'—'）",
 "links": ["关联文章标题数组，0-3篇，必须是毛选内其他文章，写完整标题"]
}}

文章：{vol}卷 第{seq}篇
标题：{title}
日期：{date}
正文开头：{head}"""

def call(payload, retry=0):
    req = urllib.request.Request(API, data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode())

out = open(OUT_F, "a", encoding="utf-8")
n_ok = n_fail = 0
for a in arts:
    if a["id"] in done: continue
    # find context: text after title line
    body = a["text"][len(a["title"]):][:900]
    seq = int(a["id"].split("n")[1])
    p = PROMPT.format(vol=a["vol"], seq=seq, title=a["title"], date=a["date_raw"], head=body.replace("\n", " "))
    try:
        resp = call({"model": "glm-5.3", "messages": [{"role": "user", "content": p}],
                     "temperature": 0.2, "max_tokens": 600, "thinking": {"type": "disabled"}})
        content = resp["choices"][0]["message"]["content"].strip()
        s = content.find("{"); e = content.rfind("}")
        obj = json.loads(content[s:e+1])
        obj["id"] = a["id"]
        out.write(json.dumps(obj, ensure_ascii=False) + "\n"); out.flush()
        n_ok += 1
    except Exception as ex:
        n_fail += 1
        print("FAIL", a["id"], a["title"][:20], repr(ex)[:120], flush=True)
        time.sleep(3)
print(f"done ok={n_ok} fail={n_fail}")
