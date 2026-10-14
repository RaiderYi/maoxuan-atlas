# WP05 服务端 AI 通道 — 环境变量与部署说明

> 交付：2026-10-14 · 代码：`api/research.js`（接口）+ `api/_lib.js`（适配层/预算/限流）+ `api/test-wp05.js`（异常测试 10/10）+ `api/real-call-check.js`（真实调用验收）

## 架构

浏览器 → `/api/research` (Vercel Serverless Function, Node 18+) → 模型适配层 → OpenAI 兼容上游（GLM / AceData / 任意兼容方）

- **密钥只在服务端环境变量**，浏览器/前端包/仓库中无任何密钥（CI 第4项 + 本地测试第10项双重校验）
- **预算熔断**：`BUDGET_LIMIT_CREDIT` 未配置 → 503 阻断生成；累计耗尽或上游余额异常 → 402 熔断（后续请求短路，不再触上游）
- **限流**：匿名会话 cookie（`mx_sid`, HttpOnly）+ IP 双键，默认 5 次/分钟（`RL_MAX_PER_MIN`），429 + Retry-After
- **超时**：`AbortController`，默认 60s（`PROVIDER_TIMEOUT_MS`）→ 504 阻断本次生成
- **有界重试**：默认 ≤1 次重试（`MAX_RETRIES`），仅对 429/5xx/invalid_token 类瞬时错误；余额类错误不重试
- **阅读隔离**：本接口只管 AI 生成；任何失败（503/402/429/504/502）不影响静态站点阅读/剧场/地图
- **脱敏日志**：stdout JSON 行（时间/会话/IP哈希/模型/问题长度+前24字/费用/余额），不含密钥与完整问题

## 环境变量（Vercel → Project Settings → Environment Variables）

| 变量 | 必填 | 示例 | 说明 |
|---|---|---|---|
| `PROVIDER_URL` | ✅ | `https://open.bigmodel.cn/api/coding/paas/v4` | OpenAI 兼容 base（也可 `https://api.acedata.cloud/v1`）|
| `PROVIDER_KEY` | ✅ | （bigmodel GLM key，本地 `data/.key`）| 服务端密钥 |
| `MODEL_ID` | ✅ | `glm-5.3` | 模型 id |
| `BUDGET_LIMIT_CREDIT` | ✅ | `50` | **非空才允许调用**；金额由产品负责人确定 |
| `PROVIDER_TIMEOUT_MS` |  | `60000` | 默认 60s |
| `MAX_RETRIES` |  | `1` | 默认 1（总尝试 ≤2）|
| `RL_MAX_PER_MIN` |  | `5` | 每会话每分钟上限 |
| `ALLOW_ORIGIN` |  | `https://aibigplayer.top` | CORS |

未配置 `PROVIDER_*`/`BUDGET_LIMIT_CREDIT` 时接口返回 503/402 阻断——这是设计行为，不是故障。

## 验收记录（2026-10-14）

- 异常测试 `node api/test-wp05.js`：**10/10 通过**（未配置预算/供应商阻断、空问题400、上游挂起→504、上游429透传、上游402熔断短路、成功路径记账（cost 0.42 → 余 9.58）、预算耗尽402、本地限流429、前端无密钥）
- 真实调用 `node api/real-call-check.js`：**成功**（glm-5.3，18.6s wall，1375 tokens，答案正确概括《井冈山的斗争》核心问题）
- 已知边界：内存级限流/预算为**区域级**（serverless 实例间不共享）；生产前可换 Vercel KV，当前单区域流量下可接受，已在代码注释标记

## 生产部署步骤（待产品负责人定预算后）

1. `cp repo_stage/api/ deploy_nexior/api/`（api/ 与静态站同根，Vercel 自动识别 Serverless Functions）
2. `npx vercel env add` 逐项录入上表（Production + Preview）
3. `cd deploy_nexior && npx vercel --prod`
4. 冒烟：`curl -X POST https://aibigplayer.top/api/research -H 'Content-Type: application/json' -d '{"question":"test"}'` → 应 200（预算内）
