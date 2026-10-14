# DEPLOY.md — 部署与回滚操作说明（WP01 交付）

> 版本：2026-10-14 · 适用：maoxuan-atlas（aibigplayer.top）
> 规范源：`D:\工作\maoxuan_viz\deploy_nexior\`（与线上一致的唯一事实源）

## 1. 目录角色（WP01 确定）

| 目录 | 角色 | 说明 |
|---|---|---|
| `deploy_nexior/` | **规范源（canonical）** | 与 aibigplayer.top 线上逐字节一致（md5 已核）；Vercel 项目 `nexior`(prj_LAhv…) |
| `repo_stage/` | **Git 仓库** | github.com/RaiderYi/maoxuan-atlas；site/ 子目录跟踪规范源（texts/tiles/bak 被忽略） |
| `site/` | 旧构建快照（09-29） | ⚠️ 已过时，仅作历史参考，禁止再从此目录部署 |
| `data/` + `*.py` | 数据产线 | extract→enrich→build；产物回写规范源 |
| `baselines/` | 历史基线备份 | M0/R0 两版，只读 |

**修改规范**：改代码 → 先改 `deploy_nexior/` → 同步 `repo_stage/site/` → commit（回滚点）。禁止直接改 `site/`。

## 2. 本地启动

```bash
cd D:/工作/maoxuan_viz/deploy_nexior
python -m http.server 8000   # 或 npx serve
# 打开 http://localhost:8000  （需 WebGL 查看 3D 模式；不支持时自动降级 2D）
```

## 3. 部署（Vercel）

方式 A（CLI）：`cd deploy_nexior && vercel --prod`（需先 `vercel login`）
方式 B（Git 集成）：push 到 maoxuan-atlas 默认分支（若项目已连接仓库）

注意：`.vercel/project.json` 绑定的是 `nexior` 项目（aibigplayer.top 域名）；旧 `site`(prj_CVtj…) 项目是早期部署，**不要**用错。

## 4. 回滚

```bash
cd D:/工作/maoxuan_viz/repo_stage
git log --oneline                 # 找目标版本
git checkout <commit> -- site/    # 取回旧文件
cp site/app.js site/index.html ... ../deploy_nexior/
cd ../deploy_nexior && vercel --prod
```

回滚点 tag：`wp01-baseline`（385df9e，= 当前线上 M1 版）。

## 5. 数据重建（全量）

```bash
cd D:/工作/maoxuan_viz
python extract.py     # texts/ → articles.json（需原始输入，见 docs/DATA_MANIFEST.md）
python enrich.py      # GLM 考证 → enriched.jsonl（需 data/.key）
python build_site.py  # → site/data/data.js + texts（随后同步到 deploy_nexior/）
```

## 6. CI

`repo_stage/.github/workflows/ci-minimal.yml`：JS 语法 / 217篇数据完整性 / 旧URL路由存在性 / 前端无密钥。本地等价检查命令见 workflow 内注释。

## 7. 凭据

- GLM API key：`data/.key`（本地，不入仓）
- GitHub：remote URL 已去 token（WP01-2）；推送用 credential manager / SSH / 临时 PAT
- Vercel：`vercel login` 交互授权
- ⚠️ 旧 token（gho_…，曾存于本地 .git/config）**需在 GitHub Settings→Developer settings→Tokens 撤销轮换**——此操作需账号权限，人工执行
