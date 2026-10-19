# B02/B03 闭环：50 元预算变成跨实例硬上限（2026-10-19）

> 触发：产品负责人选择「Vercel Upstash 联网新建」方案。
> 结论：**KV 已接通，预算与限流从 `scope=instance` 变为 `scope=global`**；50 元现在是跨实例、跨冷启的真实上限口径，不再只是单实例内的软计数。

## 1. 做了什么

| 步骤 | 命令 / 动作 | 结果 |
|---|---|---|
| 1 | `npx vercel integration add upstash/upstash-kv -n maoxuan-kv -e production` | 新建 store `maoxuan-kv`（`store_UGnv6C78VTTfT9gs`），状态 `available`，仅连接 `nexior` 项目 |
| 2 | 平台自动注入环境变量 | `KV_REST_API_URL`、`KV_REST_API_TOKEN`、`KV_URL`、`REDIS_URL`、`KV_REST_API_READ_ONLY_TOKEN`（均为 provider-managed，值不回显） |
| 3 | `npx vercel --prod --yes` | 重新部署，函数读到新 env |
| 4 | `/api/status` 复核 | `budgetScope=global`、`kvConfigured=true`、`rateLimitScope=global` |

**未复用** `upstash-kv-claret-cable`（`fortunecalendar` 的库、状态 uninstalled）——避免跨项目串账。新建库与本项目一对一。

## 2. 代码侧前置改造（本次一并落地）

1. **键命名空间**：所有 KV 键加 `mx:` 前缀 —— `mx:budget:cny:<period>`、`mx:ledger:ai:<day>`、`mx:ledger:idem:<requestId>:<attemptId>`、`mx:rl:{sid|ip|global}:<window>`。即便将来与其它应用共用同一个 Redis 也不会串账。
2. **预算泄漏修复**：旧顺序是「先预留 0.06 元 → 再判 429」，429 分支不退还 → 每被限流一次白漏 0.06 元；范围为空那条 400 同样漏。现在**三级限流全部前移到预留之前**。
3. **三级限流**（B03）：会话+IP 5 次/分、纯 IP 12 次/分、全站 60 次/分，全部可用 env 覆盖（`ASK_RL_MAX_PER_MIN` / `ASK_RL_IP_PER_MIN` / `ASK_RL_GLOBAL_PER_MIN`）。纯 IP 桶是「丢 Cookie 也不再获得无限额度」的关键。

## 3. 生产实测证据

### 3.1 全局累加（不是实例内计数）

| 调用 | HTTP | 状态 | 本次费用 | budgetScope | 结算 | 台账落 KV |
|---|---|---|---|---|---|---|
| 第 1 次 | 200 | insufficient | 0.000938 元 | **global** | ok | true |
| 第 2 次 | 200 | insufficient | 0.000874 元 | **global** | ok | true |

- `/api/status` 读到 `used = 0.0018119999999999942`，与 0.000938 + 0.000874 **精确相等**
- 隔 6 秒再读（另一个函数实例）仍是同一数值 → 冷启动不再重置

### 3.2 直接读 Redis 核对键

```
KEYS mx:*  →  mx:budget:cny:2026-10
              mx:ledger:ai:2026-10-19
              mx:ledger:idem:req_958d6ffdb9da2d80:final
              mx:ledger:idem:req_b8c937fbf29c7591:final
              mx:rl:global:29872876
              mx:rl:ip:209.137.178.237:29872876
              mx:rl:sid:27354539fb79461b|209.137.178.237:29872876
              mx:rl:sid:4ebcdfb68ae6497f|209.137.178.237:29872876

GET mx:budget:cny:2026-10         → 0.0018119999999999942
HGETALL mx:ledger:ai:2026-10-19   → {calls: 2, cost: 0.001812}
```

三条都成立：①命名空间正确 ②金额与次数分账 ③幂等键按 requestId 落库（重试不会重复计费）。

### 3.3 限流跨实例

- 同一 IP 连续两次请求：`ip.used` 1 → 2，`scope=global`
- 生产冒烟中：同一 Cookie 第 6 次 → 429 `limitScope=session`；换 Cookie 第 7 次 → 429 `limitScope=ip`
- 被限流请求不消耗预算：`/api/status` 的 `used` 在限流前后无额外增量

## 4. 现在可以说的与不能说的

**可以说**：
- 50 元是跨实例、跨冷启的**真实金额**上限；超限时 `/api/ask` 返回 402 `budget_exhausted`，阅读/笔记不受影响
- 每次调用先预留 0.06 元、按真实 token 结算、失败退回；重试也计费
- 台账（次数 + 金额 + 幂等）在 Redis 中可查，不再依赖单实例内存

**不能说**：
1. **未做真实的「余额耗尽」生产测试**：把 `BUDGET_LIMIT_CNY` 调到极小值会影响真实用户，因此 402 分支只有离线断言（`api/test-b03.js` 与 `tests/regression.mjs`）覆盖。若需要生产级证据，建议在**独立 Preview 环境**用 0.01 元额度跑一次，我可以随时做。
2. **Upstash 免费额度/计费口径未核对**：本轮按 Vercel Marketplace 默认 plan 创建，未确认月度命令数上限与超额行为。KV 读写量级极低（每次提问约 6—8 条命令），但仍应去 Upstash 控制台确认 plan 与用量告警。
3. **KV 故障时的降级语义**：预算与台账一律「拒绝新增调用」（fail closed），限流降级为单实例并在日志标注 `kv_error`。这意味着**Upstash 故障 = AI 问答不可用**（阅读不受影响），这是有意的成本保护取舍。
4. **事实正确率仍未评**（B08 100 题人工核验未做）。

## 5. 复核命令

```bash
cd D:/工作/maoxuan_viz/deploy_nexior
npx vercel storage status            # maoxuan-kv → nexior / production / 5 个 env 变量
curl -s https://aibigplayer.top/api/status   # 期望 budgetScope=global, kvConfigured=true
node ../repo_stage/api/test-b03.js           # 5/5 限流与预算泄漏断言
node ../repo_stage/tests/regression.mjs      # 34/34
```

## 6. 回滚

- 断开 KV（回到单实例软计数）：Vercel 控制台移除 `maoxuan-kv` 与 nexior 的连接，或删除 `KV_REST_API_URL`/`KV_REST_API_TOKEN` 环境变量后重新部署 → `/api/status` 自动变回 `scope=instance`，代码无需改动
- 删除整个库：`npx vercel storage delete maoxuan-kv`（不可恢复，会同时移除项目连接）
- 关闭 AI：`npx vercel env rm PROVIDER_KEY production` + 重新部署
