# aibigplayer.top 现状基线审计报告（BASELINE_AUDIT）

> 审计日期：2026-10-14
> 审计对象：D:\工作\maoxuan_viz\（本地产线）+ repo_stage（Git 仓库 maoxuan-atlas）+ aibigplayer.top 线上站
> 审计方式：只读代码审计 + 数据抽查 + 线上可达性验证，未改动任何生产文件
> 对照基线：《aibigplayer_V2_产品整体规划与完整TODO.md》（2026-10-13 v1.0，166 项任务）

---

## 1. 资产总览

| 资产 | 路径 | 说明 |
|---|---|---|
| 本地产线 | `D:\工作\maoxuan_viz\` | extract.py → enrich.py → build_site.py → site/ |
| 前端站点 | `site/`（13MB） | 静态站：index.html + app.js(1213行) + map3d.html + sw.js + assets |
| Git 仓库 | `repo_stage/` → github.com/RaiderYi/maoxuan-atlas | 2 commits（初始发布 + v4 阅读器升级） |
| 数据层 | `data/`（10MB） | articles.json(217) / articles_full.json / enriched.jsonl / merged.json / place_bg.json / texts/(217 txt) |
| 部署 | Vercel 双项目：`site`(prj_CVtj…) 与 `nexior`(prj_LAhv…) | deploy_nexior/ 为第二份部署副本 |
| 基线备份 | `baselines/`（24MB） | M0_pre_20260930 / R0_pre_20260929 两版 |
| 版本控制 | `AIBIGPLAYER_B8E9B990E5A88C%85/` | V2 规划三件套（本规划的基线文档） |

线上验证：`https://aibigplayer.top/` HTTP 200，页面标题「毛泽东选集 · 地图与时间轴」，HTML 37.6KB（含压缩传输）。

## 2. 现状功能可用性矩阵（对照规划五大模块）

| 规划模块 | 现有实现 | 状态 | 证据 |
|---|---|---|---|
| **经典研读** | | | |
| 五卷 217 篇目录+阅读器 | `/read` 等价物：`#/view/cats`；字号调节、目录 TOC、阅读进度条、滚动位置记忆(localStorage)、书签/最近阅读、段落深链 `#/art/:id` | ✅ 可用（PARTIAL，无段落级锚点） | app.js L782-981（reader suite）、L870 fetch texts |
| 全文检索 | 三级分层搜索 `#/search/:q`，标题/元数据/全文关键词高亮 | ✅ 可用（PARTIAL，无语义/跨实体） | app.js L1102-1164 |
| **时空探索** | | | |
| 2D 地图 | Leaflet 1.9.4 + 本地瓦片缓存(6.6MB, z4-6, Esri/NatGeo) + 文章地点标注/路线 | ✅ 可用 | app.js L274-351、assets/tiles/ |
| 3D 地图 | map3d.html（189行）MapLibre + terrarium DEM + Carto 底图 | ✅ 可用（PARTIAL，与主站 hash 路由未打通） | map3d.html L76-78 |
| 时间轴年谱 | 像素比例时间轴 + 历史年份滑块/播放 + era 过滤 | ✅ 可用 | app.js L419-524 |
| **知识网络** | | | |
| 图谱 | ECharts 5.5 懒加载 force graph，文章↔事件关联，深浅主题适配 | ✅ 可用（PARTIAL，仅文章-事件，无人物/概念/证据边） | app.js L589+ |
| 统计视图 | `#/view/stats` 卷/时期分布 | ✅ 可用 | index.html statsGrid |
| **AI 研究室** | 无（enrich.py 仅为离线产线工具，非在线服务） | ❌ 缺失 | — |
| **我的书房** | 仅浏览器本地书签+进度（D07/D08 已达成本地版），无账号/跨设备/导出 | ❌ 缺失（本地模式 PARTIAL） | app.js L782-842 |
| **基础能力** | | | |
| PWA 离线 | sw.js v5：shell 预缓存 + 文章260/瓦片420 运行时缓存上限 | ✅ 可用 | sw.js L1-20 |
| 埋点 | track() 事件骨架已就绪但 **UNWIRED**（MX_ANALYTICS_ENDPOINT 未接） | ⚠️ 骨架在，无后端 | app.js L1078-1099 |
| 移动端 | hash 路由 + tabbar + 快捷键 1-4 | ✅ 可用 | app.js L1177-1187 |
| 缓存策略 | vercel.json：assets/texts 1年 immutable，data.js 1天 | ✅ 可用 | site/vercel.json |

**结论**：V1「展示型」产品已完整可用（阅读+地图+年谱+图谱+检索+PWA）。V2 规划的核心增量——统一知识底座（人物/事件/地点/证据实体模型）、跨模块联动、AI 研究室、个人书房——当前均未建设。现状数据模型只有「文章」一个实体（lat/lng/why/event 直接平铺在文章记录上，无 sourceIds、无证据状态、无段落锚点）。

## 3. 数据层审计

| 项 | 结果 |
|---|---|
| 文章量 | 217 篇全部就位（卷1:18 / 卷2:40 / 卷3:31 / 卷4:70 / 卷5:58），site/data/texts 217 个 txt 与 data.js 一一对应 |
| 富化覆盖 | 217/217 均有 lat/lng/why/event/links（GLM-5.3 离线生成，prompt 约束"不得虚构"，人工抽检） |
| 时期分布 | 抗日77 / 解放71 / 社建54 / 土地革命13 / 大革命2 |
| 实体模型 | ❌ 无 Person/Place/Event/Claim/Source 独立实体；地点是文章字段而非实体；无 evidenceIds |
| 段落级数据 | ❌ 无段落切分与锚点（检索只到篇级） |
| 权利台账 | ✅ NOTICE 已分项声明（代码MIT / 原文不分发仅个人学习 / 注释AI生成仅供参考 / 瓦片Esri / 三方库），但**线上站实际公开提供全文阅读+瓦片**，与 NOTICE"仅个人学习"口径存在张力，属合规待确认项 |

## 4. P0 阻断问题（按规划 A 域标准）

| # | 问题 | 严重度 | 说明 |
|---|---|---|---|
| P0-1 | **git remote URL 内嵌 GitHub token（gho_…）明文存储于本地 .git/config** | 高 | 本地文件泄露即暴露账号。建议改用 credential manager 或 SSH，并轮换该 token。未进仓库历史（仅本地 config），无公开泄露证据 |
| P0-2 | **线上公开毛选全文的著作权风险未闭环** | 高 | 人民出版社出版权；NOTICE 的"个人学习"免责口径不适用于公开网站。V2 规划 A05/A06/L05 的合规确认是商业化与存续的前置闸门 |
| P0-3 | **地图瓦片三方来源混用**：2D=本地 Esri 缓存，3D=Carto CDN+AWS terrarium 在线拉取 | 中 | 3D 页面依赖外部服务且未声明授权；Esri 条款禁止再分发缓存瓦片。规划 B14/A04 要求的地图授权台账缺失 |
| P0-4 | **埋点无后端**：track() 全部落到 console.debug | 中 | J01/J02（WQRS 北极星）无数据来源，Phase 5 增长验证无基线 |
| P0-5 | **deploy_nexior/ 与 site/ 与 repo_stage/site/ 三份副本内容已漂移**（diff 显示 app.js 等多处不一致） | 中 | 无单一事实源，发布走哪个目录、哪份是生产，需 A10 环境与回滚方案明确 |
| P0-6 | **无任何自动化测试/CI** | 中 | 规划 K01/K02 从零建设 |

## 5. 与规划 166 项任务的映射（抽样关键项）

| 任务 | 现状判定 |
|---|---|
| A01 页面功能矩阵 | 本报告即是（DONE for this round） |
| A02 构建/部署说明 | PARTIAL：Vercel 双项目在，但无文档化操作说明 |
| A03 数据清单 | PARTIAL：本报告 §3 覆盖 |
| A04 地图引擎盘点 | DONE（本报告 §2/P0-3） |
| A05 权利台账 | PARTIAL：NOTICE 有框架，线上口径未闭环（P0-2） |
| A07 移动端问题记录 | PARTIAL：tabbar/路由在，无截图留档 |
| B02-B08 实体ID/Schema/联动协议 | TODO（全部） |
| C02 段落锚点 | TODO |
| D03/D04/D07/D08 阅读器 | PARTIAL→接近 DONE（字号/TOC/进度/书签/本地保存已有，段落级深链缺） |
| D09 统一搜索 | PARTIAL（篇级有，跨实体无） |
| E01/E02/E05 地图/时间轴 | PARTIAL（各自可用，双向联动协议未建） |
| F01 图谱 | PARTIAL（文章-事件图有，四类实体视图无） |
| G/H 域 | TODO（全部） |
| K13 CWV | UNKNOWN（未测量） |

## 6. 首轮（两周 Sprint）建议执行顺序

1. **S1｜修复 P0-1**：git remote 去 token 化 + 轮换凭证（半小时级，先做）
2. **S2｜P0-5 单一事实源**：确定 site/ 为唯一构建产物目录，deploy_nexior 改为部署脚本输出；写 DEPLOY.md
3. **S3｜B02+B03 最小落地**：为文章/地点定义稳定 ID（现有 v{n}n{nn} 可沿用）；段落切分脚本（extract.py 扩展）产出 paragraph.json + 锚点，为 D04 段落深链与 G02 段落级检索打地基
4. **S4｜B07 证据状态最小版**：给 enriched 字段加 `status: "ai_inferred"` + `sourceNote`，前端在 why/event 卡片上显示「AI 辅助考证」标签（对齐 K16/G11）——成本极低、合规收益大
5. **S5｜P0-4 埋点接线**：MX_ANALYTICS_ENDPOINT 指向 Vercel Edge Function 或轻量分析服务，先收 page_view/article_open/search 三个事件建立基线
6. **S6｜合规决策会（人工）**：P0-2 全文公开口径 —— 三选一：维持非商用公开/加访问控制/收缩为节选+导读。此项决定 Phase 1 之后的路线是否成立
7. **S7｜K01 最小 CI**：repo_stage 加 GitHub Actions（node --check app.js + python 产线冒烟 + 链接抽查），主分支保护

**不建议现在做**：3D 剧场增强、AI 研究室、账号系统——规划明确数据契约先行，当前连实体模型都没有。

## 7. 审计局限（诚实声明）

- 未在真实浏览器中逐页操作线上站（仅 curl 验证可达性与 HTML 结构）；移动端体验、CWV、3D 实际渲染质量为 UNKNOWN
- enrich 数据的 why/event/坐标正确性仅确认了生成约束与覆盖量，未逐条人工核验（规划 C12/C14 范畴）
- Vercel 项目配置（域名绑定、路由规则）仅从本地 .vercel/project.json 推断，未登录控制台核实
