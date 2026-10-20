# R01—R48 单一状态账本（2026-10-19 晚间批次）

本文件是**唯一当前状态**。此前 `N01_STATUS_20261019.md` 等文档中的叙述若与本文件冲突，
以本文件为准，旧文档只作历史记录（不要再从旧文档抄状态）。

口径约定：
- **DONE** = 有自动化断言或线上探测的可复核证据，命令写在本行
- **CODE-ONLY** = 代码与本地验证完成，但线上未生效（缺环境变量/未部署）
- **OPEN** = 未开始
- **BLOCKED(用户)** = 需要产品负责人决定或提供凭据

基线：main `b0b9ead` → 本批次提交见 `git log`；线上 `/api/version` 为准。

---

## 事故记录：正文 404（F01）

| 项目 | 内容 |
|---|---|
| 发现 | 2026-10-19 晚间复审，抽样 8 篇 `/data/texts/*.txt` 全部 404，覆盖六卡五篇 + 两篇 AI 样本 + 第五卷一篇 |
| 根因 | `site/data/texts/` 被 `.gitignore` 排除（著作权考虑），Vercel 由 GitHub 自动部署且 `buildCommand=null`，仓库里没有正文 → 部署产物里也没有正文。CI 只校验 `data.js` 的 217 条元数据，因此"CI 全绿 + 线上正文不可读"同时成立 |
| 不是根因 | 模型供应商、KV、限流、缓存；AI 可答是因为 `sample-topic.json` 随仓库发布 |
| 修复 | 新增受控内容包产线：`pipeline/build-content-pack.mjs` → `site/data/texts.pack.json`（gzip + AES-256-GCM，明文不入库）；`site/api/text.mjs` 解密后同源返回；`vercel.json` 保留 `/data/texts/*` → `/api/text` 重写，旧链接不失效 |
| 预防 | `pipeline/verify-deploy-assets.mjs` 进 CI（缺任一正文即失败）；`pipeline/probe-production.mjs` 上线后探测 8 篇 + 正文自检 |
| 当前状态 | **已闭环**。2026-10-20 上午由本机 Vercel CLI（`auth.json` 中的 CLI 登录态，昨日误判为"无登录凭证"而错记为 BLOCKED）写入 `TEXT_PACK_KEY`（Production + Preview），加密部署 `a629cb0` 后 `probe-production.mjs` = **15/15 通过**：8 篇正文全部返回字符数、旧地址 `/data/texts/v1n07.txt` 5345 字符可读 |

---

## 事故记录二：PWA 图标全部 404（2026-10-20 发现）

| 项目 | 内容 |
|---|---|
| 发现 | 同步 `deploy_nexior` 镜像时发现 `icons/` 只在旧本地目录里，仓库 `site/icons/` 根本不存在；线上实测 `icons/icon-192.png`、`icon-512.png`、`apple-touch-icon.png`、`icon-32.png` **全部 404** |
| 根因 | 与 F01 同一类：`manifest.webmanifest` 与 `index.html` 声明了 7 个图标，仓库没带这些文件 → Git 部署产物里也没有。此前门禁只查正文与肖像，不查 manifest/html 引用的资源 |
| 修复 | 从旧本地目录 `D:/工作/maoxuan_viz/site/icons/`（与 M0/R0 基线一致，2026-09-28 生成）恢复 7 个文件进 `site/icons/` 并提交 |
| 预防 | `pipeline/verify-deploy-assets.mjs` 增加 `[1b/7]`：逐个校验 manifest 声明图标 + `index.html` 里 `<link rel=icon>` 引用；已做红/绿验证（移走 icons 目录 → 5 条报错；恢复 → 0 错误） |
| 遗留 | 服务端仍需在 R03 发布门槛里覆盖更多"声明了但没带"的资源（字体、CSS 引用） |

## A. 发布与可用性

| ID | 状态 | 证据 / 说明 |
|---|---|---|
| R01 恢复受控正文供应 | DONE | `node tests/api/test-text.mjs` 9 例；217 篇逐篇解密 + 明文哈希对齐 manifest。**线上实证**：`TEXT_PACK_KEY` 已配置（Production+Preview），`a629cb0` 部署后 `/api/text?id=…` 八篇全部返回正文（v1n03 6926 / v1n04 19250 / v1n07 5345 / v4n59 3179 / v1n11 3884 / v3n02 5606 / v1n17 11689 / v5n01 2565 字符），旧地址 rewrite 同时可用 |
| R02 部署资产清单 | DONE（2026-10-20 增强） | `site/data/content-manifest.json`（逐篇明文/密文 SHA256、字数、缺失与短篇清单）；`node pipeline/verify-deploy-assets.mjs` 0 错误 |
| R03 发布前门槛 | DONE | 同一脚本进 CI（`.github/workflows/ci-minimal.yml` "Deploy asset gate"）；正文缺失 = 非零退出 = 不得接管生产 |
| R04 上线后关键路径探测 | DONE（首次 5/15 → 现 15/15） | 部署 `dpl_FjYAdgiq…`（提交 `a9fc776`）后实跑：版本/状态/首页/画廊 ✓；正文自检 `packFound=true, keyConfigured=false`；8 篇与旧地址全部 503 `text_unavailable`。**探测准确指出唯一缺失项是密钥，不是内容包** |
| R05 缓存自然升级 | DONE | `sw.js` v9 → v10：缓存版本整体作废；`/api/text?check=1` 不入缓存；正文走"缓存优先 + 后台刷新"，断网可读已读篇目。手机真机/弱网验收仍属 R24 |
| R06 统一状态与事故记录 | DONE | 本文件 + 事故表；旧 `N01_STATUS` 转历史 |

## B. 任务与个人成果

| ID | 状态 | 证据 / 说明 |
|---|---|---|
| R07 持久任务集合 | DONE | `site/lib/mx-tasks.js`；`node tests/tasks.mjs` 28 例：重进已完成任务保留 `noteId`、切卡不覆盖、`reopen` 生成第 2 次记录、旧 `mx_active_task` 迁移不丢数据 |
| R08 三类任务入口 | DONE(结果页/画廊/书房) | `quiz.html` 的 `startReadingTask()` 结果卡与画廊共用；书房"继续研读任务"一栏按 `data-task` 设指针后跳原文。**AI 研究室入口未接**（该页不产生任务） |
| R09 保存事务反馈 | DONE | 笔记写入与 `MXTasks.complete()` 分别校验；任务状态没落库时提示"笔记已保存，但任务状态未写回本地"，不再无条件显示"已完成" |
| R10 人物卡幂等与关联 | DONE | `quiz.html saveCard()` 按 `resultId + cardId` 复用原记录只更新；`readingTaskState` 由真实任务状态推导 |
| R11 全量备份与恢复 | DONE(本地逻辑) | `LIB_KEYS` 增加 `mx_tasks` / `mx_active_task`；导出含两者；导入按 `taskId` 合并、保留较新。真机导入导出验收未做 |
| R12 书房继续任务与回收站 | PARTIAL | 继续任务列表 + `人物卡` 筛选已加；"删卡不默认删笔记"沿既有回收站实现，恢复后关联验证未做真机 |

## C. 内容与知识底座

| ID | 状态 | 说明 |
|---|---|---|
| R13 统一锚点映射 | DONE（7 篇范围） | `pipeline/build-anchor-map.mjs` → `site/data/anchor-map.json`：逐条记录锚点行号、字符指纹、引文校验结果与别名；前端改为按映射校正（旧编号会提示"已按映射校正"）。**实测 6 张人物卡的锚点全部错位**：mao 006→003、deng 133→131、chen 142→140、zhou 044→042、liu 017→015（前五条已按证据修正），zhu 的引文在当前正文本里找不到 → 取消锚点、`quoteVerified:false`、审核状态从 `paragraph_anchor_verified` 降为 `paragraph_anchor_unverified` |
| R14 来源与内容状态 | PARTIAL | `content-manifest.json` 记录 title/vol/字数/哈希；`anchor-map.json` 记录引文核对结果；"原文/注释/AI推断/用户观点"四态仍未建模 |
| R15 六卡文字与第六图 | PARTIAL | 六卡的**引文-段落对应关系**已逐条核对（见 R13）；朱德卡引文不在 v1n11 正文中，需编辑确认出处或替换引文；第六张正式肖像仍缺；主题文字审校未做 |
| R16 优化现有专题 | OPEN | |
| R17 两个新短专题 | OPEN | |
| R18 编辑发布与纠错流程 | OPEN | |

## D. 定位与审美交互

| ID | 状态 | 说明 |
|---|---|---|
| R19 固定用户与首次成果 | OPEN | 首页仍写"地图与时间轴"（F07 未修） |
| R20—R23 样板/共用视觉/卡片/分享 | OPEN | 需要真实样板 + 签收，不能用"颜色已更换"关闭 |
| R24 专注阅读与手机验收 | PARTIAL | 证据面板在 CDP 390×844 模拟下为底部抽屉（宽 390、高 497、关闭按钮可见、横向溢出 0）；桌面横向溢出 0。**真机、弱网、200% 缩放仍未做** |

## E. AI 质量与费用

| ID | 状态 | 证据 |
|---|---|---|
| R25 混合尝试费用 | DONE | `node tests/api/test-cny-mixed.mjs` 6 例（复审两反例 + 402 回归） |
| R26 原子结算与配置上界 | DONE(代码) / PARTIAL(对账) | 终态互斥（守卫键去 mode）、写入失败可重试（删守卫 + `retryable`）、预留与实际调用配置同源；**离线对账工具未做**，仍需人工按台账复核 |
| R27 回答与证据工作区 | DONE | `site/lib/mx-evidence.js` + 研究室证据面板。引文按原文回查定位（不信编号），按文章与真实行号分组，只有重叠或相隔 ≤1 行才合并；连续行按硬折行拼成整段显示（不再出现半句话），模型引文降为小字单列；桌面右侧抽屉 / ≤720px 底部抽屉，显示该段前后各 1 段并高亮命中行；正文不可用时报具体原因。**线上实测**：真实提问 6 条引用 → 2 个证据块（第 37–40 段合并 4 条、第 47–48 段合并 2 条），未定位 0 条；`tools/verify-r27-live.mjs` 可复跑 |
| R28 多状态与取消回归 | PARTIAL | 取消逻辑沿用；三态/超时/迟到结果回归未补 |
| R29 人工质量评审闭环 | OPEN | 20 题人工评审未重跑 |
| R30 七篇小包扩展 | OPEN | 需先定公开范围（与 R01 同一决策） |

## F—H. 留存 / 运营 / 商业

R31—R48 全部 OPEN。其中 R37（事件收集）仍是 `NOT WIRED`，R44 已随本次改动完成工程入口拆分：
`site/api/` 只剩 10 个受控入口，测试在 `tests/`、诊断在 `tools/`。

---

## 线上实测（2026-10-19 23:2x，部署 dpl_FjYAdgiq… / 提交 a9fc776）

```
node pipeline/probe-production.mjs --expect-commit a9fc776
✓ /api/version      R1.6.0-content-and-tasks · a9fc776
✓ /api/status       AI enabled · 预算 0.10/50 CNY
✗ /api/text?check=1 packFound=true  keyConfigured=false        ← 内容包已进部署，只缺密钥
✗ /api/text?id=v1n03 … v5n01 (8 篇)   HTTP 503 text_unavailable
✗ /data/texts/v1n07.txt（旧地址重写） HTTP 503
✓ /  ✓ /quiz.html
5/15 通过
```

结论：R01 的产线本身在线上成立（`packFound=true`，说明内容包随部署走通、rewrite 生效、函数能读到包），
**唯一未完成的是 Vercel 环境变量 `TEXT_PACK_KEY`**。该动作需要项目权限，本机无 Vercel CLI 登录态
（`deploy_nexior/.env.local` 里的 OIDC token 经 Vercel API 验证返回 `invalidToken`），故交由产品负责人完成。

## 本批次本地真实执行结果

```
node tests/run-all.mjs                    → 8 个套件全通过（34 + 28 + 9 + 6 + 9 + 5 + 离线 + 退役）
node pipeline/verify-deploy-assets.mjs    → 0 错误 / 0 警告，发布资产达标
node --check site/app.js && site/sw.js    → OK；quiz.html 内联脚本 1 块 OK
node pipeline/build-content-pack.mjs      → 217/217 篇，明文 1,115,856 字 / 3.03 MB → 包 1.75 MB
```

## 运维待决：本地两套目录已漂移（本次复核新发现）

`deploy_nexior/` 曾是"规范源"，但现在线上由 GitHub 自动部署（`repo_stage` → RaiderYi/maoxuan-atlas）。
2026-10-19 夜间批次的全部改动只落在 `repo_stage`，`deploy_nexior` 已落后一个批次：

| 缺失/落后 | 具体 |
|---|---|
| 新文件 | `site/api/text.mjs`、`site/lib/mx-tasks.js`、`site/lib/mx-evidence.js`、`data/anchor-map.json`、`data/texts.pack.json`、`data/content-manifest.json` |
| 旧版本 | `app.js`、`quiz.html`、`research.html`、`vercel.json`、`sw.js` |
| 反向污染 | `deploy_nexior/api/` 仍留着 `test-b03.mjs`、`test-cny.mjs`、`test-wp05.mjs`、`test-wp07-offline.mjs`、`real-call-check.mjs`（R44 已把这些挪出生产入口） |

影响：两套目录不能再互为备份，误部署 `deploy_nexior` 会把测试端点重新暴露、并让正文回退成 404。
**2026-10-20 处置**：按"`repo_stage` 为唯一真源"执行——把 `repo_stage/site` 全量同步到 `deploy_nexior`（477 个文件），
清掉 7 个孤儿文件（5 个 `api/test-*.mjs` / `real-call-check.mjs` 与 2 个 `*.bak_m1`），
只保留 `deploy_nexior` 独占的 `.vercel/`、`.env.local`、`.agents/`、`.claude/`、`package.json`（Vercel CLI 与项目元数据用）。
`deploy_nexior` 从此定位为"本机镜像 + Vercel CLI 操作目录"，**不再作为部署源**；任何改动只改 `repo_stage` 并 push。

## 未关闭的关键项（按优先级）

1. **R20—R24 三个关键样板页**（结果卡 / 阅读任务 / 证据面板）与真机、弱网、200% 缩放验收；R19 首页仍写"地图与时间轴"
2. R28 三态与迟到结果回归、R29 二十题人工质量评审（都还没重跑）
3. R37—R48 留存、事件收集（`NOT WIRED`）、看板、五人观察与商业验证
4. 运维待决：`deploy_nexior` 与 `repo_stage` 已漂移，需定唯一真源（见上节）
