# 正文内容包：产线、部署与轮换（R01 / R02 / R43）

## 为什么有这层

全文受著作权保护，不能直接进公开仓库（`site/data/texts/` 在 `.gitignore` 里）。
但线上是 Vercel **Git 自动部署**（Root Directory=`site`、`buildCommand=null`），
只部署仓库里的文件 —— 于是正文从未进入部署产物，`/data/texts/*.txt` 全部 404。

解法：把本地全文编译成**可提交的加密内容包**，由服务端解密后同源返回。
明文不进仓库、不进部署包；密钥只存在于部署环境变量。

```
site/data/texts/*.txt  ──build-content-pack.mjs──▶  site/data/texts.pack.json   (gzip + AES-256-GCM，可提交)
                                                    site/data/content-manifest.json (只有哈希与统计，可公开)
site/api/text.mjs  ◀── vercel.json rewrite ──  /data/texts/{id}.txt （旧地址）
        ▲
        └── 浏览器 /app.js 直接请求 /api/text?id=…
```

## 一次性初始化

```bash
# 1) 生成密钥（只做一次；输出同时写入 data/.textpack.key，已 gitignore）
node pipeline/build-content-pack.mjs --gen-key

# 2) 编译内容包（217 篇）
node pipeline/build-content-pack.mjs
#   ✓ 217/217 篇；明文 1,115,856 字 / 3.03MB → 包 1.75MB

# 3) 本地校验：逐篇解密 + 明文哈希 + 覆盖完整性
node tests/api/test-text.mjs

# 4) 发布门槛（不需要密钥，校验密文与覆盖）
node pipeline/verify-deploy-assets.mjs
```

### 部署环境变量（关键一步）

在 Vercel 项目 `nexior` → Settings → Environment Variables 增加：

| Key | Value | 环境 |
|---|---|---|
| `TEXT_PACK_KEY` | `node pipeline/build-content-pack.mjs --gen-key` 输出的 base64 | Production + Preview |

**没有这个变量时** `/api/text` 会返回 503 `text_unavailable`（reason=`key_missing`），
前端显示"正文服务暂时不可用"，而不是假装成功。
`/api/text?check=1` 可直接查看 `keyConfigured` / `packFound` / `articleCount`。

## 部署后验收

```bash
node pipeline/probe-production.mjs                     # 默认 https://aibigplayer.top
node pipeline/probe-production.mjs --base https://<预览域名>
node pipeline/probe-production.mjs --expect-commit <sha> --wait 120   # 等部署生效
```

探测内容：`/api/version`、`/api/status`、`/api/text?check=1`、
复审抽样的 8 篇（v1n03 v1n04 v1n07 v4n59 v1n11 v3n02 v1n17 v5n01）、
旧地址 `/data/texts/v1n07.txt`、`/`、`/quiz.html`。

## 正文更新流程（改文章/补内容）

```bash
# 1) 改 site/data/texts/{id}.txt（或重跑管线生成）
# 2) 重建内容包与清单（manifest 会记录每篇哈希与字数）
node pipeline/build-content-pack.mjs
# 3) 跑门槛 + 提交（pack 与 manifest 一起提交，缺一不可）
node pipeline/verify-deploy-assets.mjs && git add site/data/texts.pack.json site/data/content-manifest.json
```

`content-manifest.json` 里的 `missingArticles` 必须为空；`shortArticles` 是给编辑复核的短篇清单
（如 v5n03《人民英雄们永垂不朽》碑文 176 字，属正常）。

## 轮换密钥

1. `node pipeline/build-content-pack.mjs --gen-key --force`（生成新密钥并覆盖本地文件）
2. 重新 `build-content-pack.mjs`
3. 先更新 Vercel 的 `TEXT_PACK_KEY`，再推送新内容包 —— **顺序不能反**：
   先推包后换密钥，会出现一段解不开的窗口（服务返回 503 `text_decrypt_failed`，不会返回乱码）

## 现有边界（诚实记录）

- 加密解决的是"明文不进公开仓库/不被搜索引擎直接抓取"，**不等于版权授权**；
  公开范围与处置仍属 R42 台账范围。
- 解密后的正文任何访问者都能读到（这就是阅读站的功能本身），不要把它当访问控制。
- `/api/text` 有 ETag + 内存缓存（单实例最多 24 篇），批量接口最多 25 篇/次。
- 内容包 1.75MB 进仓库；若语料大幅扩张，应先评估仓库体积与函数冷启动内存。
