# M1 稳定修复验收：FIX01—FIX04 + QA02（2026-10-19）

> 依据《AIBIGPLAYER_V2_人物肖像卡与研读体验升级_TODO_20261019.md》§4A / §4D / §6 M1
> 基线：`3d26d80`（R1.2.2-kv-hard-cap）→ 本轮代码 `73a5943` + `9180689`
> 状态口径：**已编码 / 离线验证 / 线上验证** 分开写，不合并成“已完成”。

## 1. 逐项状态

| 项 | 已编码 | 离线验证 | 线上验证 | 说明 |
|---|---|---|---|---|
| FIX01 AI 回答保存按钮 | ✔ `site/research.html` | ✔ DOM/CSS 规则核对 | ✔ 真机 Chrome 155 | 见 §2.1 |
| FIX02 失败/缺 usage 保守记账 | ✔ `api/ask.js` | ✔ `api/test-cny.js` 4 例 | ✔ 生产响应字段 | 见 §2.2 |
| FIX03 CNY 预留上界与幂等结算 | ✔ `api/_govern.js` + `ask.js` | ✔ `api/test-cny.js` 4 例 | ✔ 生产 `reserveCny=0.094428` | 见 §2.3 |
| FIX04 上游 402 分支二次异常 | ✔ `_govern.markExhausted()` | ✔ `api/test-cny.js` | ⛔ 未在生产触发（需上游真余额不足） | 见 §2.4 |
| FIX05 旧成果/配置兼容 | 🟡 仅约束 | — | — | 见 §3，M2 卡片上线前必须完成 |
| FIX06 版本与遗留公开事项 | ✔ 版本可查 | — | ✔ `/api/version` | 见 §4 |

## 2. 证据

### 2.1 FIX01（P0）保存按钮永不可见

- 根因：CSS `.cardBtns{margin-top:14px;display:none}`，而回答成功后代码写
  `parentNode.style.display = ""` —— 空字符串使 inline 样式失效，回落到 CSS 的 `none`。
  结果：**任何 answered / partial 回答都不会显示“保存为研究卡”**，与复审发现一致。
- 修复：改为 `display = "block"`（insufficient 分支仍显式 `none`）。
- 真机验证（production，Chrome 155，CDP 直连）：

  | 检查 | 结果 |
  |---|---|
  | 回答后 `.cardBtns` inline / computed | `block` / **`block`** |
  | 按钮实际可见（`getBoundingClientRect` 宽高 > 0） | **true** |
  | 回答状态 | `answered`，3 条引用 |
  | 点保存后卡数 | 2 → 3 |
  | 新卡字段 | `requestId=req_c31ec9eaa2c5caf7`、`status=answered`、`citations=3`、`answerRaw` 等 16 字段齐备 |
  | 刷新后 | 仍在（3 张） |

- **同时发现的真实缓存缺陷（已修）**：Vercel `cleanUrls` 下 `/research` 无扩展名，
  旧 sw.js 的 shell 判定（`\.(html|js|css|webmanifest)$` 或末尾 `/`）没有命中，
  于是走 cache-first 的 data 分支 → **部署后老访客仍拿到旧 research.html**。
  实测：修好的版本上线后，浏览器里按钮仍是 `display:none`，手动注销 SW 后才正常。
  修复：`req.mode === "navigate" || req.destination === "document"` 一律按 shell（network-first），
  缓存名 `mx-v8 → mx-v9` 强制驱逐旧 shell。

### 2.2 FIX02（P0）失败不等于上游未计费

旧实现：`catch` 里无条件 `budget.release(RESERVE)` 全额退回；成功路径则把没有 `usage` 的响应当 0 元结算。
两种都在**少记真实支出**。

新实现（三条分支）：

| 情形 | 处理 | 台账 |
|---|---|---|
| 全部尝试的用量已知（token 或金额） | `settle` 成真实合计 | `cost`=真实值, `costKnown=true` |
| 上游明确拒绝（402/429）或 0 次调用 | `release` 释放预留 | 不产生费用记录 |
| 超时 / 引用校验失败 / 缺 usage / 5xx | `hold` 保留预留，不结算 | `cost=null`, `costKnown=false` |

每次尝试的费用优先用上游给的金额；只有 token 时按官方价目表换算；两者都没有记未知。

### 2.3 FIX03（P0）预留上界可证明

- 旧值：固定 0.06 元。但 2 次尝试 ×（输入 + 4096 输出上限）最坏可达 0.09 元以上。
- 新值：`estimateReserveCny({inputChars, maxOutputTokens, attempts})`，
  以**字符数作 token 上界**、按未命中价（更贵的口径）与输出价计算，乘尝试次数后向上取整。
- 生产实测：`reserveCny = 0.094428`，同一次请求 `costCny = 0.004918`，`settlement=settled_actual`。
  即**预留在最坏情况下也覆盖实际费用**，再按真实用量退回差额。
- 幂等：`settle/release` 带 `(requestId:final)` 键，KV `SET NX` 去重；
  重复结算返回 `deduped=true` 且金额不变（离线断言覆盖）。

### 2.4 FIX04（P1）上游 402 二次异常

旧代码 `budget.markExhausted()` —— `makeCnyBudget()` 从来没有这个方法，命中即 `TypeError` → 500。
现已实现：把本周期键 `SET` 为上限值，并把该分支改成 `await`。离线断言：上游 402 → 返回
`upstream_insufficient`，随后同一周期再次提问返回 `budget_exhausted`，无二次异常。

## 3. QA02（P0）反例测试：9/9 通过

`node api/test-cny.js`（mock 供应商 + 内存 KV，零生产花费）：

```
✓ 成功调用：额度=真实费用（不是预留上限）
✓ 引用校验失败：按两次尝试的真实费用结算，不退回全部预留
✓ 缺 usage：记为未知并保留预留（不按 0 元已知费用结算）
✓ 超时：保留预留不释放，返回可恢复的 504
✓ 重复 settle 同一 request/attempt：只生效一次
✓ 剩余额度小于预留上界：402 且额度回到 0（回滚正确）
✓ 并发临界值：额度仅够一次时只放行一个请求
✓ 上游 402：返回 upstream_insufficient 并把本周期额度标记为耗尽
✓ KV 故障时拒绝新增模型调用
结果: 9 通过 / 0 失败
```

回归未退化：`tests/regression.mjs` 34/34、`api/test-b03.js` 5/5、`api/test-wp07-offline.mjs` 全过、
`pipeline/p05_eval.py --check-only` 冻结校验通过。

## 4. FIX06 版本与遗留事项（核对结果）

- 版本链：`3d26d80`（R1.2.2-kv-hard-cap）→ `73a5943`（M1 修复）→ `9180689`（sw v9）
- 回滚点：tag `de3d-baseline`（去 3D 前）、`p07-release`；本轮无数据库迁移，回滚只需 revert commit
- **仍未关闭**：RIGHTS_LEDGER #1 毛选全文公开口径（A/B/C/D 四选一，需决策人）；旧 GitHub `gho_` token 撤销（需人工）；高德 key 轮换（历史 commit 可检出）；Upstash plan 与用量告警未核对
- 这些**不因换卡面而默认解决**（按 §FIX06 要求保留）

## 5. 本轮没有证明的事

1. FIX04 的上游 402 分支只在 mock 上验证，生产未触发过真实上游余额不足。
2. FIX01 的“保存失败明确提示”未做故障注入（存储写入失败场景），M2 与 FLOW03 一起补。
3. SW v9 的升级路径只验证了“注销旧 SW 后拿到新页面”；**未做“老访客不清缓存自然升级”的端到端验证**，属于 QA08 范围。
4. 手机真机、弱网、200% 文本缩放全未测（QA03/QA04）。
5. 人物肖像零进展：本轮没有产生任何肖像资产，M2 尚未开始。
