# 毛泽东选集 · 舆图（MaoXuan Atlas）

> 《毛泽东选集》第一至五卷 · 217 篇 · 交互式可视化研读站
> 地形舆图 · 历史进程 · 年谱 · 知识图谱 · 全文检索

**线上站点（Live Demo）**：https://aibigplayer.top

[English README → README_EN.md](README_EN.md)

---

## 项目简介

本项目将《毛泽东选集》五卷共 **217 篇文章**（1925—1957）结构化并可视化，让读者通过 **地图** 与 **时间轴** 进入每一篇文章的历史现场：

- 每一篇文章标注其 **写作时间、写作地点、历史背景（为什么写）、关联事件、关联文章**
- 点击地图上的地点，可以看到该地的大历史背景与在此期间写成的全部文章
- 拖动「历史进程」滑块（或点击播放），足迹路线随年代逐节点点亮：**广州 → 长沙 → 武汉 → 井冈山 → 瑞金 → 瓦窑堡 → 保安 → 延安 → 西柏坡 → 北平**

## 功能视图

| 视图 | 说明 |
|---|---|
| 舆图 | 真实地形晕渲底图（NatGeo）+ 中文地名层 + 朱砂足迹路线 + 地点历史背景卡 + 五时期筛选 |
| 年谱 | 1925—1957 横向时间轴：每年篇数直方图 + 按卷着色圆点 + 点击年份展开当年篇目面板 |
| 图谱 | 文章 × 历史事件力导向关联网络（按卷着色，点击入文） |
| 文章 | 背景卡（地点/时期/事件/为什么写）+ 全文阅读 + 关联文章跳转 + 前后篇导航 |
| 检索 | 标题/背景/事件/地点 + 全文模糊检索 |

## 技术栈

纯静态站，零构建、零后端：

- **Leaflet** — 地图引擎（瓦片自托管，无运行时外链）
- **ECharts** — 知识图谱力导向图
- 原生 HTML/CSS/JS，宣纸/朱砂/墨色的纸墨风设计
- 部署：Vercel（`vercel.json` 静态配置）

## 目录结构

```
site/            站点源码
  index.html     单页入口（五视图）
  app.js         全部交互逻辑
  assets/        leaflet / echarts / 中国GeoJSON（本地化）
  data/data.js   217篇结构化元数据（标题/日期/地点/经纬度/背景/事件/关联）
  data/texts/    [不入库] 全文文本，由产线生成
pipeline/        数据产线（需自备PDF运行）
  extract.py     PDF按目录切分217篇全文
  enrich.py      LLM逐篇考证地点/背景/事件/关联
  build_site.py  合并生成 data.js + texts/
  dl_tiles.py    预下载中国区域地形瓦片（Esri NatGeo, z4-z6）
data/            结构化中间数据（不含全文）
```

## 本地运行 / 复现

```bash
# 直接预览（texts 与 tiles 缺失时地图无地形、文章无全文）
cd site && python -m http.server 8901

# 完整复现（自备《毛泽东选集》PDF 后运行产线）
python pipeline/dl_tiles.py     # 下载地形瓦片 → site/assets/tiles/
python pipeline/extract.py      # 切分全文   → data/articles_full.json + texts/
python pipeline/enrich.py       # LLM考证    → data/enriched.jsonl（需 GLM API key）
python pipeline/build_site.py   # 合并出站   → site/data/
```

## 版权与法律声明（重要）

- **代码**（`site/`、`pipeline/`）：MIT License，可自由使用、修改、分发。
- **《毛泽东选集》文本**：著作权归著作权人所有（毛泽东同志 1976 年逝世，依《中华人民共和国著作权法》保护期为作者终生及其逝世后五十年；出版权归人民出版社所有）。**本仓库不含任何文章全文**；线上站点所载全文仅用于个人学习研读，不作任何商业用途。如需复现全文数据，请自备合法来源的 PDF 并自行运行产线脚本。
- **地点背景/事件/关联考证**：由大语言模型基于公开史料生成，已经人工抽检，但仍可能存在个别误差，仅供参考研读，不构成学术引用依据。
- **地形瓦片**：© Esri / National Geographic。本仓库不分发瓦片；`dl_tiles.py` 仅供个人学习用途在本地重建缓存，请遵守 Esri 的使用条款。
- **中国地图 GeoJSON**：来源 DataV.GeoAtlas（阿里云），仅供学习使用。

若任何权利方认为本项目内容存在侵权，请通过 Issue 联系，我将及时处理或下架。

## License

Code: [MIT](LICENSE) ｜ Texts: 不在本仓库分发，权利归原著作权人 ｜ See [NOTICE](NOTICE)
