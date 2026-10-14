# 数据产线输入 manifest（WP01-4）

> 生成：2026-10-14 · 用途：记录从原始输入到站点数据的完整链条，任何数据疑义可回溯到输入文件
> 规则：enrich.py 依赖 data/.key（GLM API），已列入 .gitignore 等价保护（不进 repo_stage）

## 产线链条

```
输入                       脚本            输出                     去向
─────────────────────────────────────────────────────────────────────────────
data/texts/*.txt (217)  → extract.py  → data/articles.json      ┐
                                          data/articles_full.json ├→ enrich.py → data/enriched.jsonl
data/place_bg.json      ─────────────────────────────────────────┘        │
                                                                            ↓
                                     build_site.py → site/data/data.js + data/texts/（复制）
                                                                            ↓
                                                          deploy_nexior/（规范源，= 线上）
```

## 输入文件清单（hash: sha256 前16位）

| 文件 | 大小 | 数量/条目 | 说明 |
|---|---|---|---|
| data/texts/ | 3.5MB | 217 个 txt | 原始全文（权利：人民出版社出版权，NOTICE §2） |
| data/place_bg.json | — | — | 地点背景补充 |
| data/.key | 49B | 1 | GLM API key（不入仓） |

## 关键中问产物

| 文件 | 说明 |
|---|---|
| data/articles.json | 217 条元数据（idx/vol/title/date_raw/background/n_chars/id） |
| data/articles_full.json | 含全文的完整记录 |
| data/enriched.jsonl | GLM-5.3 逐篇考证（place/lat/lng/era/why/event/links），**默认 inferred/pending，非 verified**（V2 §6 状态三轴） |
| data/merged.json | enrich 合并产物 |

## 最终数据（与线上一致，md5=42630b09…）

| 文件 | 条目 | 校验 |
|---|---|---|
| deploy_nexior/data/data.js | 217 条 DATA | 217/217 有 lat/why；era 分布：抗日77/解放71/社建54/土革13/大革命2 |

## 已知数据债（对照前轮线上审计）

- 169 条 links 未解析为有效关联（WP10 处理）
- 8/10 导览站点名与 DATA.place 错配（WP02/WP06 处理）
- why/event/坐标为模型生成，人工抽检过但未逐条核验（WP03 样本先行，WP10 全量）
