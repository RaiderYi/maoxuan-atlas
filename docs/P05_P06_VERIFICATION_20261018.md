# P05（AI 可信问答）与 P06（游客书房）验收记录（2026-10-18）

> 环境：本地 8000 + CDP 真机 Chrome（缓存禁用、SW 注销）；服务端代码 `api/_govern.js`（新增）、`api/ask.js`、`api/feedback.js`、`api/_lib.js`
> 线上 AI 仍为未配预算状态（`budget_not_configured` 503），因此 AI 真实回答无法在本机取得——本记录只声称已经验证的部分。

## P05.1 范围契约（✅ 代码与契约已验证）

新增 `resolveScope()`，三种范围显式建模：

| mode | 输入 | 服务端行为 |
|---|---|---|
| corpus | 省略 scope | 检索全语料，响应回显 `scopeResolved.mode='corpus'` |
| articles | `{articleIds:[...]}` 或 `{topicId}` | 逐个校验存在；topicId 必须存在且 articleIds ⊆ 专题文章 |
| paragraphs | `{paragraphIds:[...]}` | 逐个校验存在；与 articleIds 交叉核对一致 |

拒绝规则（**不静默扩大**）：
- 未知文章 / 未知段落 / 未知专题 / 专题夹带外部文章 → `400 scope_invalid`，`error.detail` 列出具体非法 id
- `scope` 传了但等于空集 → `400 scope_invalid`（提示"要全语料请显式省略 scope"）
- 范围合法但无段落 → `400 scope_empty`

顺序修正：请求校验（400）现在先于预算/供应商（402/503），范围错误不会被"AI 未配置"掩盖。

前端：专题上下文发送 `{topicId:"jgs"}`，文章上下文发送 `{articleIds:[...]}`；回答头部显示"范围：N 篇文章（专题 jgs）"，与响应 `scopeResolved` 同源。

## P05.2 三态结果与等待体验（✅）

- `answered` / `partial` / `insufficient` 三态独立呈现
- partial：顶部标【部分回答】+ 独立"缺口说明"块（从 answer 的「按语：」提取），并保留原答案
- insufficient：明确写出"不猜测、不编页码"，并给三条下一步（换问法 / 先检索再带段落问 / 写成笔记）
- 错误：**问题保留在输入框**，错误信息带错误码与请求号，可修改重试
- 取消：文案改为"取消只停止本页等待，已发出的模型调用可能仍在服务端继续并计费"（不承诺停止计费）
- 迟到结果：`curReq` 代次校验，旧请求结果一律丢弃

## P05.3 评测可移植与冻结重跑（✅ 部分，真实模型重跑待模型环境）

新增 `pipeline/p05_eval.py`：
- 路径全部相对仓库根（`--root` 可覆盖），不再硬编码 `D:/工作/...`
- 模型配置只读环境变量 `PROVIDER_URL / PROVIDER_KEY / MODEL_ID`，不读本机密钥文件
- 启动即核对冻结清单 `pipeline/wp05-frozen.json`（promptVersion / pipelineVersion / 语料 sha256 / 语料内容 hash），任一不符 → 退出码 3 拒绝评测
- 题目来自冻结文件 `pipeline/p05-questions.json`（20 题，含 expect），不从历史结果挑选
- 失败全部保留：error 记录同样写入结果并计入分母（`denominator_note` 明确写入）
- `--check-only` 已实测两次通过：`[freeze] OK` + `[check-only] 可移植性自检通过`

**未完成（诚实标注）**：真实模型重跑需要 `PROVIDER_*` 环境变量，当前环境未配置 → 脚本按设计拒绝运行（退出码 4），没有产出任何伪造分数。公开推广前的 100 题人工核验门槛仍未开始。

## P05.4 跨实例限流与费用记账（✅ 代码就绪，KV 未配置时显式降级）

- `rateLimit()`：配置 `KV_REST_API_URL/TOKEN`（Upstash/Vercel KV）时用 `INCR + PEXPIRE`，**跨实例生效**；未配置或 KV 故障时退化为单实例，并在响应 `governance.rateLimitScope='instance'` 与前端提示"限流为单实例"中明示
- 调用预占：沿用 `Budget.reserve()`（每次模型调用前预占，含重试）
- 台账 `recordUsage()`：**次数与金额分开**记；上游未返回金额时 `cost=null` 且单独累计 `unknownCostCalls`，响应 `usage.costKnown=false`，**绝不记为 0**
- 台账落 Vercel stdout（`t:'ai_ledger'`）+ KV 可用时按日聚合（保留 90 天）

## P05.5 纠错与版本追踪（✅）

- 每次请求生成 `requestId`（`req_` + 16 hex），响应体与 `X-Request-Id` 头都带；错误响应同样带
- 响应包含 `model / promptVersion / pipelineVersion / corpusVersion / scopeResolved`，页面在"请求号"一行显示管线与语料版本
- 每条引用带「引用不相关」按钮，回答下方带「结论无依据」按钮，可补一句原因；POST `/api/feedback` 记录 requestId + kind + citationId + 版本四元组
- 反馈只落元数据与用户自填理由，不保存完整问题与笔记正文；KV 未配置时返回 `persisted:false` 并在页面提示"仅记录在服务日志"

---

# P06 游客书房与成果保全

## P06.1 独立书房与聚合（✅）

- 书房独立视图：阅读记录 / 收藏 / 摘录笔记 / 研究卡 / 专题进度 / 专题结论 统一聚合
- **迁移前先备份**：首次进入写 `mx_backup_p06`（原始字符串快照），再写 `mx_schema=mx-library@2`
- 兼容旧 schema：研究卡补 `answerRaw`（原始 AI 回答），缺字段不删除
- 不要求注册，全部本机存储

## P06.2 原始回答 / 人工改写 / 独立笔记分离（✅）

- 研究卡：`answerRaw`（原始 AI 回答，写入后不再改）与 `editedAnswer`（人工改写）分开；界面标注"含人工改写（原始 AI 回答另存）"
- 摘录/笔记与 AI 数据分属不同 key（`mx_notes` / `mx_research_cards`），互不覆盖
- 历史卡片缺 `answerRaw` 时按 `answer` 回填并如实标注

## P06.3 损坏 / 空间不足 / 禁用存储（✅ 关键项）

实测：把 `mx_notes` 写成 `{broken json` → 重进书房
- 出现红色告警"有 1 处本地数据读取失败（读取失败不等于数据为空，本站没有覆盖它们）"
- 提供原始内容预览 + 一键复制
- **原始值保持为 `{broken json` 未被覆盖**（实测 `rawStillBroken: true`）
- 写入失败（配额/禁用）走 `toast` 明确提示"保存失败：本地存储不可用或空间不足"，不假成功

## P06.4 查找 / 筛选 / 恢复阅读（✅）

- 查找框匹配：标题、摘录、笔记正文、段落号、引用 id
- 类型筛选：全部 / 摘录 / 笔记 / 研究卡；实测「摘录」→1 条、全部→3 条
- 每条成果带「回到原段」（`#/art/<articleId>/<paraId>`）与「在研究室查看」；专题结论区带依据段落直链
- 无结果与空库各有独立空态与下一步操作

## P06.5 JSON 备份恢复与 Markdown 导出（✅）

- 导出 JSON：`mx-library@2` 结构（含 stats、exportedAt、全部成果 key），实测 3417 字节
- 导出 Markdown：摘录/笔记（含来源）、研究卡（区分我的改写与 AI 原始回答）、专题结论与依据，实测 1239 字节
- 导入：只合并不覆盖，规则为**同 id 同日内容跳过、较新时间戳替换、本地较新保留**；实测新增 1 条 + 冲突条目按较新替换（`n1Quote='冲突：更新的版本'`）
- 导入校验：结构不符/版本不识别/本地 key 已损坏 → 中止并说明，不覆盖
- 内容安全：导入只做 JSON 解析与数据写入，渲染一律 `textContent`，不执行任何内容
- 删除：确认后进回收站 `mx_trash`，实测删除→回收站 1 条→恢复成功

## 已知未完成（P05/P06）

1. **AI 真实回答未在生产验证**（预算未配置，503）——需要产品负责人定预算并配置 `PROVIDER_*`、`BUDGET_LIMIT_CREDIT`
2. **KV 未配置** → 限流单实例、台账与反馈仅在日志（响应已如实标注）
3. 100 题人工核验未开始（P05.3 门槛）
4. 书房暂无"按文章分组视图"与"批量导出选中项"
5. 反馈中的 `prompt` 追问（用户补充原因）用的是浏览器 `prompt()`，移动端体验一般
