# AI 启用记录：DeepSeek + 50 元预算（2026-10-18）

> 触发：产品负责人指示「AI 用 DeepSeek，预算 50 元人民币，其他完整进行」
> 结论：AI 问答已真实启用并通过生产验证；**预算为人民币真实计费口径**，不是调用次数估算。

## 1. 配置（Vercel Production 环境变量，值不回显）

| 变量 | 值 | 说明 |
|---|---|---|
| `PROVIDER_URL` | `https://api.deepseek.com` | OpenAI 兼容端点 |
| `MODEL_ID` | `deepseek-flash` | 官方 ID = DeepSeek-V4.1-Flash（1M 上下文，原生多模态） |
| `PROVIDER_KEY` | 已配置（Secret） | 存在 Vercel Secret，前端不可见 |
| `BUDGET_LIMIT_CNY` | `50` | 人民币预算上限 |
| `BUDGET_PERIOD` | `2026-10` | 按月重置 |

价格口径取自官方《模型 & 价格》页（deepseek-flash，**取高峰价保守计费**）：

| 项 | 官方高峰价 | 采用 |
|---|---|---|
| 输入·缓存未命中 | 2.00 元/百万 tokens | 2.00 |
| 输入·缓存命中 | 0.04 元/百万 tokens | 0.04 |
| 输出 | 8.00 元/百万 tokens | 8.00 |

单次请求费用上限预留 **0.06 元**（含最多 3 次上游尝试），拿到 `usage` 后按实际 token 结算并退回差额；调用失败退回预留。

## 2. 生产实测（`https://aibigplayer.top/api/ask`）

| 用例 | HTTP | status | 引用数 | 耗时 | 实际费用 | 剩余额度 |
|---|---|---|---|---|---|---|
| 红色政权存在需要哪些条件？（scope=v1n03） | 200 | partial | 10 | 18.9s | 0.031389 元 | 49.968611 |
| 八月失败的原因是什么？（scope=v1n04） | 200 | answered | 7 | 6.8s | 0.011153 元 | 49.988847 |
| 井冈山时期红军使用的火炮是什么型号？（scope=v1n03） | 200 | **insufficient** | **0** | 1.0s | 0.001603 元 | 49.998397 |

- 第三例是关键：**范围外/原文无据的问题被拒答且零引用**，没有编造型号。
- 回答正文带段落编号（如 `[pv1n03-036]`），引用经服务端逐字校验后才返回。
- `/api/status` 实测：`ai.enabled=true`、`reasonCode=null`、`quota={CNY, limit:50, used:0, left:50, period:"2026-10", scope:"instance"}`。

## 3. 前端端到端（真机 Chrome 155）

- 研究室：`aiBanner` 不出现、提问按钮可点；提问后 9.8s 返回，渲染 **13 条引用**。
- 「保存为研究卡」：落库 `answerRaw` 402 字、`requestId=req_be4fb531221b74d3`、13 条引用、`editedAnswer=null`、版本字段齐备。
- 首页：服务已启用，不再显示「AI 问答当前未开放」提示。

## 4. 治理现状与诚实限制

已生效：
- 范围契约（非法范围 400，不扩大到全库）、引用校验（虚构 ID 拦截）、三态结果、请求号与版本追踪、纠错接口
- 单实例限流（5 次/分钟/会话+IP）、旧 `/api/research` 410 关闭
- 每次调用前预留费用、超限 402 阻断、台账记录 CNY 金额与 token 数

**未生效（必须知道）**：
1. ~~**`scope=instance`**：`KV_REST_API_URL/TOKEN` 未配置 → 预算与限流只在单个函数实例内累计，冷启动会重置计数。~~ **已于 2026-10-19 闭环**：接入 Upstash `maoxuan-kv`（仅连接 nexior/production）后 `/api/status` 变为 `budgetScope=global`、`rateLimitScope=global`、`kvConfigured=true`；实测两次调用费用在 Redis 中精确累加、隔 6 秒另一实例读到同一数值。证据见 `docs/KV_HARD_CAP_20261019.md`。仍需注意：**Upstash 故障 = AI 问答不可用**（成本保护 fail-closed），且 Upstash plan 与用量告警尚未核对。
2. 单次 0.06 元预留的保护不变；接入 KV 后，冷启动也不再重置累计（已实测跨实例累加）。
3. 建议同时在 DeepSeek 控制台设置消费提醒/充值额度作为外部兜底。
4. `PROVIDER_KEY` 现在是本项目公共站点的付费凭据，建议单独申请一把仅用于本站的 Key，便于随时吊销（当前使用的是本机同一把 Key）。
5. ~~B07（20 题真实重跑）与 B08（100 题人工核验）仍未做~~ **B07 已于 2026-10-19 完成**（20/20 跑通、0 调用失败、108/108 引文逐字、4/4 资料外问题正确拒答、总花费 0.430540 元，见 `docs/B07_20Q_RERUN_20261019.md`）；**B08（100 题人工核验）仍未做**，因此事实正确率仍无可对外宣称的量化结论。当前能证明的仍是「能答、有据、会拒答」。
6. 5 人任务观察（C02/E12）仍未进行，AI 路径的用户可用性未经真人验证。

## 5. 回滚方式

- 关闭 AI：`vercel env rm PROVIDER_KEY production` 并重新部署 → `/api/status` 立即变为 `ai_not_configured`，前端自动显示「AI 问答暂未开放」，阅读/笔记/书房不受影响。
- 调整预算：改 `BUDGET_LIMIT_CNY` 后重新部署。
- 代码回滚：`git checkout p07-release` 或 Vercel 侧 Promote 上一个 deployment。
