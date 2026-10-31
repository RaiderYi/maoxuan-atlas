# 毛泽东选集 · 有据研读（MaoXuan Atlas）

> 《毛泽东选集》第一至五卷 · 217 篇 · 有据研读站
> 带着问题读经典 · 经典研读 · 专题 · 书房 · 舆图/年谱/图谱

**线上站点**：https://aibigplayer.top

> 本 README 为 2026-10-31 重写版。项目已从"舆图可视化站"演进为"有据研读工具"；
> 演进过程与当前权威状态见 `docs/STATUS_LEDGER_20261019.md`（单一状态账本）。

---

## 产品形态（当前）

| 入口 | 说明 |
|---|---|
| **带着问题读经典**（`solve.html`） | 说出你的现实问题 → AI 解构并最多追问 2 次（可跳过）→ 解决方案卡（一句话判断/问题拆解/行动方案/模拟示例/经典依据），引用可回到原文核对上下文；无相关原文时诚实降级为"AI 一般性分析" |
| **AI 研究室**（`research.html`） | 向语料直接提问，回答带段落编号引用，可逐条打开原文上下文；研究卡可改写、导出 |
| **经典研读 / 专题 / 书房**（`index.html`） | 全文阅读、段落定位、摘录笔记、人物卡、研读任务、备份导入导出 |
| **探索**（`index.html` 内） | 舆图、年谱、知识图谱、语料统计（第一代可视化遗产） |

## 技术架构

**前端**：原生 HTML/CSS/JS，零构建、零框架；共享设计令牌 `site/lib/mx-tokens.css`；
共用存储语义 `mx-store.js`（损坏识别/事务删除/回收站/备份）；证据定位 `mx-evidence.js`（按原文文本回查，不信编号）。

**后端**：Vercel Serverless Functions（Node.js ESM），全部带 `mx:` 命名空间治理：

| 端点 | 职责 |
|---|---|
| `/api/ask` | 语料问答：范围契约 → 检索 → DeepSeek → **引用逐字校验**（虚构 ID/伪造引文整份拦截）→ 三态（answered/partial/insufficient） |
| `/api/solve` | 问题解决闭环：解构+追问 → 方案卡；经典依据同 ask 校验标准；无依据时服务端强制降级 general |
| `/api/text` | 受控正文服务：AES-256-GCM 加密内容包解密同源返回，旧地址 rewrite 兼容 |
| `/api/visit` `/api/stats` | 匿名访问统计（PV/UV，只记页面名）与聚合查询；非关键路径 fail-open |
| `/api/status` `/api/version` `/api/feedback` `/api/ping` | 状态/版本/纠错/探针 |

**治理**（ask/solve 同构）：Upstash KV 全局预算（CNY 真实计费，fail-closed）+ 三级限流（会话/IP/全站）+ 请求号与版本追踪 + 幂等台账；KV 故障 = AI 关闭、阅读不受影响。

**部署**：Vercel Git 集成，push 到 main 自动部署；`site/vercel.json` 声明函数资源与语料打包。
**CI**（`.github/workflows/ci-minimal.yml`）：JS 语法 / 217 篇数据完整性 / 旧 URL 路由 / 前端无密钥 / 全部离线回归套件 / 发布资产门槛（正文与图标缺失即失败）/ 锚点映射 / 冻结评测 / 版本元数据。
**上线探测**：`node pipeline/probe-production.mjs --expect-commit <sha>`（版本一致性 + 正文 8 篇抽样 + 页面 + 统计口）。

## 语料边界（诚实口径）

- **可阅读**：217 篇全文（加密内容包随部署发布，任何访问者可读——这是阅读站的功能本身）。
- **AI 可问**：**217 篇全部接入**（2026-10-31 取得权利方授权后扩容；`site/data/corpus-full.pack.json`
  加密语料包，明文不入仓库）。授权文件归档状态见 `docs/RIGHTS_LEDGER.md` #1；
  对外推广/商业化仍待书面凭据归档并核对范围。
- 检索单元为**语义块**（PDF 折行按句末标点合并，均值 ~224 字；标题/日期/节标题独立成块），
  引用一律按原文文本回查定位；"自然段编辑级重建"列入内容建模待办（R14 关联）。
- "段"为固定字宽切片（同篇相邻编号文字连续），引用定位一律按原文文本回查

## 目录结构

```
site/                站点（部署根）
  index.html + app.js   单页主体（研读/书房/舆图/年谱/图谱）
  research.html      AI 研究室
  solve.html         带着问题读经典（问题解决）
  quiz.html          人物卡答题
  lib/               mx-tokens / mx-store / mx-tasks / mx-evidence
  api/               9 个生产函数（+_ 前缀共享模块；白名单由 verify-deploy-assets 把关）
  data/              data.js(元数据) / sample-topic.json / texts.pack.json(加密正文) / 锚点与清单
pipeline/            产线与质检
  extract.py → enrich.py → build_site.py      数据产线（需自备 PDF 与 key）
  build-content-pack.mjs / build-anchor-map.mjs  内容包与锚点产线
  verify-deploy-assets.mjs                    发布资产门槛（进 CI）
  probe-production.mjs                        上线后关键路径探测
  wp07_20q.js 等                              20 题评测与历史记录
tests/               11 个离线回归套件（run-all.mjs 统一入口）
docs/                状态账本 / 部署 / 内容包 / 权利台账 / 验证记录
```

## 本地运行 / 复现

```bash
# 站点本地预览（AI 与正文接口需要 Vercel 环境变量，本地缺省时相关功能如实提示不可用）
cd site && python -m http.server 8901

# 测试（离线，不需要网络与密钥）
node tests/run-all.mjs

# 发布门槛与上线探测
node pipeline/verify-deploy-assets.mjs
node pipeline/probe-production.mjs --expect-commit <sha>
```

## 权利与法律声明（重要）

- **代码**（`site/`、`pipeline/`、`tests/`）：MIT License。
- **《毛泽东选集》文本**：著作权归著作权人，出版权归人民出版社。**本仓库不分布 217 篇全文**
  （`texts.pack.json` 为加密包且明文不入 git 历史；`sample-topic.json` 含两篇样本的原文切片，
  用于 AI 问答演示——该口径与权利台账 #1 一并处于"待产品负责人处置"状态，见下）。
- **公开处置未决项**：线上公开阅读、AI 引用、对外推广的授权路径尚未最终决策
  （维持非商用公开 / 访问控制 / 节选导读 / 获取授权，见 `docs/RIGHTS_LEDGER.md`）；
  在该决策关闭前，本项目不进行任何形式的对外推广或商业化。
- **考证注释/富化元数据**：AI 生成、人工抽检，仅供参考，不构成学术引用依据。
- **地形瓦片**：© Esri / National Geographic，仅个人学习用途本地重建；**中国 GeoJSON**：DataV.GeoAtlas，学习用途。

若任何权利方认为本项目内容存在侵权，请通过 Issue 联系，我将及时处理或下架。

## License

Code: [MIT](LICENSE) ｜ Texts: 不在本仓库分发，权利归原著作权人 ｜ See [NOTICE](NOTICE)
