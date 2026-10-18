# ADR-001｜取消 3D，产品重定位为「有原文依据的经典研读工具」

> 日期：2026-10-17 · 决策人：产品负责人 · 状态：已接受（Accepted）
> 依据：《AIBIGPLAYER_V2_产品重审与去3D执行方案_20261017.md》

## 背景

AIBIGPLAYER V2 曾以「3D 与 AI 双核心」为规划，围绕三维地图效果反复选型（MapLibre+AWS DEM → 高德 v2.1Beta terrain），消耗了大量技术成本，但未证明三维展示帮助用户更好地理解、核查和保存知识。产品负责人明确要求砍掉全部 3D 地图设计。

## 决策

**取消**：三维地图、地形服务选型与采购、DEM、自建地形、镜头飞行、行军动画、三维导演台、双引擎降级及相关宣传。旧 T01—T52、S01—S09、MAP01—MAP12 停止排期，不改名继续，不放入自动恢复的未来迭代。

**保留**：文章、证据、地点、事件、二维地图、年谱、图谱、AI 研究室、游客本地研究卡，以及全部成果数据与 Git 历史。

**新产品主线**：一个问题 → 找到原文 → 读懂上下文 → 核查 AI 引用 → 写下自己的理解 → 保存并再次使用。

## 后果

- 正面：技术栈收敛，团队聚焦「文献、上下文、证据、成果积累」的衔接，这是产品差异所在。
- 负面：放弃三维视觉展示能力；已投入的 3D 建设（含 terrain-test 验证）成为沉没成本，但保留 Git 历史与验证记录供追溯。
- 风险：已有用户若期待 3D 剧场，需通过迁移说明页引导到专题阅读；旧链接必须兼容不白屏。

## 执行

由 P01—P08 八个工作包承接（本 ADR 覆盖 P01 范围冻结）。旧 WP 状态保留历史，不重新标未完成，也不把取消包标 DONE。

## 基线（冻结）

- 代码：repo_stage main = af8f3ca（去 3D 前最后一版，含 terrain-test.html）
- 线上：aibigplayer.top（dpl_qumu6s8x2，含 terrain-test 验证页）
- 回滚：`git tag de3d-baseline`（本 tag 打在 af8f3ca）
- 数据备份清单：sample-topic.json（corpusSha256_16=d038279340bdbb57）、wp07-20q-records-r3.json、wp07-r3-manifest.json、docs/ 治理文档全套

## 用户数据保护红线

去 3D 过程中：不清除 mx_marks（收藏）、mx_read（阅读记录）、mx_recent（最近阅读）、mx_research_cards（研究卡）；只处理废弃状态 mx_mapmode=3d、jgs_scene、jgs_cam。禁止 indiscriminate localStorage.clear()。
