// WP07 本地 dev server: 静态 site/ + /api/* 真实函数 (Node 18+, 零依赖)
// 用法: node pipeline/dev-server.js  (在 repo_stage 目录)
// 环境变量同生产: PROVIDER_URL/PROVIDER_KEY/MODEL_ID/BUDGET_LIMIT_CREDIT
// key 默认从 D:/工作/maoxuan_viz/data/.key 读取 (若未设 PROVIDER_KEY)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
if (!process.env.PROVIDER_KEY) {
  try { process.env.PROVIDER_KEY = fs.readFileSync('D:/工作/maoxuan_viz/data/.key', 'utf8').trim(); } catch {}
}
if (!process.env.PROVIDER_URL) process.env.PROVIDER_URL = 'https://open.bigmodel.cn/api/coding/paas/v4';
if (!process.env.MODEL_ID) process.env.MODEL_ID = 'glm-5.3';
if (!process.env.BUDGET_LIMIT_CREDIT) process.env.BUDGET_LIMIT_CREDIT = '20'; // 本地试用额度
process.env.PROVIDER_TIMEOUT_MS ??= '90000';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    // API 路由
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.replace(/^\/api\//, '').replace(/\.js$/, '');
      // 按 mtime 缓存模块: 代码没变就复用实例 (限流桶/预算累计跨请求保留 — 与生产一致);
      // 代码变了自动失效重载 (开发热更新)
      const modPath = path.join(ROOT, 'api', `${name}.js`);
      const mtime = fs.statSync(modPath).mtimeMs;
      if (!globalThis.__apiMods) globalThis.__apiMods = new Map();
      let entry = globalThis.__apiMods.get(name);
      if (!entry || entry.mtime !== mtime) {
        entry = { mtime, mod: await import(`../site/api/${name}.js?cb=${mtime}`) };
        globalThis.__apiMods.set(name, entry);
      }
      const mod = entry.mod;
      // 收集 body
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      // 原生 http res → Vercel 风格适配器
      const vres = {
        statusCode: 200, _headers: {},
        status(c) { this.statusCode = c; return this; },
        setHeader(k, v) { this._headers[k] = v; return this; },
        json(o) {
          const payload = JSON.stringify(o);
          res.writeHead(this.statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...this._headers });
          res.end(payload);
          return this;
        },
      };
      req.body = body;
      await mod.default(req, vres);
      return;
    }
    // 静态
    let p = path.join(ROOT, 'site', url.pathname === '/' ? 'index.html' : url.pathname);
    if (!p.startsWith(path.join(ROOT, 'site'))) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
    const ext = path.extname(p);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(e.message ?? e) }));
  }
});
const PORT = parseInt(process.env.DEV_PORT ?? '8126', 10);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`dev server: http://127.0.0.1:${PORT}/research.html  (api at /api/ask)`);
});
