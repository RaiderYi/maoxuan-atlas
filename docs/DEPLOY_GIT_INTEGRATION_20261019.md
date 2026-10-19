# Git 自动部署接入记录（2026-10-19）

> 触发：产品负责人要求「push 即自动部署」，并授权直接处理目录映射。
> 结论：**已接通**。push 到 `main` → Vercel 自动生产部署 → 自动接管 `aibigplayer.top`。
> 过程中曾把生产 API 打挂约 40 分钟（下文如实记录），已修复并回滚验证。

## 1. 接入前的事实（先纠一个误判）

原以为「Vercel 没接 Git」，实际是**接错了仓库**：

```
link: {"type":"github","repo":"Nexior","org":"RaiderYi","sourceless":true,...}
```

项目连的是 `RaiderYi/Nexior`（且 sourceless），而不是 `RaiderYi/maoxuan-atlas`。
所以 push maoxuan-atlas 永远不会有反应；今天之前的每一次上线都是我给 `vercel --prod` 手工发的。

## 2. 三个必须一起改的东西

### 2.1 目录归一（否则会部署错目录）

| 之前 | 问题 |
|---|---|
| 仓库 `site/`（前端）+ 仓库根 `api/`（函数） | 没有任何一个目录等于"站点根" |
| 部署用的 `deploy_nexior/`（扁平，含 api/） | 不在仓库里，Git 构建看不到 |

处理：`api/` → `site/api/`，使 `site/` 与 `deploy_nexior/` 结构完全一致；
21 处相对引用（pipeline 运行器、tests、dev-server）、`p05_eval.py` 冻结校验路径、
`package.json`、CI workflow 全部同步。

### 2.2 项目设置

| 项 | 值 | 说明 |
|---|---|---|
| Root Directory | `site` | Git 构建的站点根 |
| Framework | `null`（Other） | 静态站，避免误判成 Vite 去跑 build |
| Git 仓库 | `RaiderYi/maoxuan-atlas` | 先断开 Nexior 再连 |
| Production Branch | `main` | push main = 生产 |
| Auto-assign Custom Domains | `true` | 生产部署自动接管 aibigplayer.top |

### 2.3 函数改成 `.mjs`（本次事故的根因）

接入后第一次 git 部署，**生产 API 全部 500**：

```
ReferenceError: exports is not defined in ES module scope
This file is being treated as an ES module because it has a '.js' file extension
and '/var/task/package.json' contains "type": "module".
    at file:///var/task/site/api/version.js:3:23
```

链路：Vercel 把 ESM 函数**编译成 CommonJS** → 运行时因 `package.json` 的 `"type":"module"`
又把它当 **ESM** 解析 → 编译产物里的 `exports` 不存在 → 500。
CLI 部署走的是另一条构建路径，所以从未暴露。

**修法验证（先探针、后改真代码）**：

| 探针 | 结果 |
|---|---|
| `/api/ping.mjs`（新加） | **200** `{"ok":true,"ext":".mjs","node":"v24.21.0"}` |
| `/api/status.js`（同一部署） | **500** `FUNCTION_INVOCATION_FAILED` |

→ `.mjs` 对 Node 是 ESM 无歧义，Vercel 也接受。于是 11 个函数 + 3 个助手/测试文件
全部改为 `.mjs`，内部 import、regression、pipeline、p05_eval、CI、package.json 同步更新。
`ping.mjs` 保留为长期健康探针（返回 Node 版本）。

## 3. 事故时间线与止损

| 时刻（UTC） | 动作 |
|---|---|
| 02:21 | 首次 git 部署完成并接管别名 → `/api/status` 500 |
| 02:25 | **promote 回上一个 CLI 部署**（`nexior-p9u517znj`）→ `/api/status` 200，生产恢复 |
| 02:26 | 关闭 `autoAssignCustomDomains`，防止后续 push 继续抢占生产 |
| 02:32 | 用 30 秒窗口 promote 探针部署，确认 `.mjs` 可用后**立刻回滚** |
| 02:35 | `.mjs` 改造合并 main，promote 验证 |
| 02:36 | 重新打开 `autoAssignCustomDomains`，push 版本号提交 |
| 02:38 | 自动部署接管别名，`/api/version` 显示新 commit，`/api/ping` 200，真实提问 200 |

**未做好的地方**：第一次接 Git 就直推 main，没有先在分支/预览环境验证构建差异。
后续规则：**改动构建路径、运行时、API 形态时，先分支验证再合并**。

## 4. 现在的工作流

```
本地改动 → git commit → push origin main
        → GitHub Actions ci-minimal（语法/数据/回归34/限流5/CNY 9/离线断言/冻结校验/版本字段）
        → Vercel 自动构建（Root=site）→ 生产部署 → 自动接管 aibigplayer.top
```

- 分支 push → 自动 **Preview** 部署（但见 §5 第 1 条）
- 回滚：`npx vercel promote <上一个部署 URL> --yes`（3 秒生效），或 `git revert` 后 push
- 版本可查：`/api/version`（含 commit、部署 ID、releaseTag）、`/api/ping`（Node 版本）

## 5. 已知限制（必须知道）

1. **Preview 部署 URL 受 Vercel 防护**：直连返回登录页 HTML（200），外部无法直接验证；
   要外部验证需开 `Protection Bypass`，否则只以生产域名为验收口径。
2. **`deploy_nexior/` 现在是本地镜像**：不再参与自动部署。它的价值只剩"本地起服务/应急手工发"。
   长期应把它降级为只读备份，避免又出现三副本漂移。
3. **版本号需随发布手动更新**：`site/data/version.json` 的 `releaseTag` 不会自动变；
   但 `sourceCommit` 兜底取 `VERCEL_GIT_COMMIT_SHA`，所以 commit 不会错，只有 releaseTag 会滞后。
4. **构建耗时**：git 部署约 60—90 秒（含 clone），比 CLI 上传慢，属正常。

## 6. 验收证据

| 项 | 证据 |
|---|---|
| 自动部署生效 | 部署 `nexior-j4qv5c926…` `source=git` `sha=11f7a89` `branch=main` `target=production` |
| 别名自动接管 | `aibigplayer.top/api/version` → `R1.3.2-git-autodeploy`，`sourceCommit` 为完整 SHA |
| 函数正常 | `/api/ping` → `{"ok":true,"ext":".mjs","node":"v24.21.0"}` |
| AI 全链 | `POST /api/ask` → 200 `insufficient`、0 引用、`settlement=settled_actual`、`reserveCny=0.094476`、`budgetScope=global` |
| CI | `ci-minimal` 对合并后的提交 success |
| 本地回归 | regression 34/34、限流 5/5、CNY 9/9、离线断言、冻结校验全过 |
