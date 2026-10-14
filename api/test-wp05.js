// WP05 异常/边界测试 — 本地直接运行 (node api/test-wp05.js), 不需要部署
// 覆盖: 未配置预算/供应商阻断, 限流429, 超时阻断, 有界重试, 预算耗尽熔断, 密钥不入前端
import assert from 'node:assert';
import crypto from 'node:crypto';

// —— 轻量 mock: 不引测试框架, 手搓 req/res ——
function mockRes() {
  const r = { headers: {}, statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; } };
  return r;
}
const mockReq = (body, headers = {}) => ({ method: 'POST', body, headers });

// —— 动态导入被测模块 (每次清 env 重新加载, Budget/限流桶也会重置) ——
async function freshLoad(env) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const k of Object.keys(saved)) if (!(k in process.env)) delete process.env[k];
  const mod = await import(`./research.js?cb=${crypto.randomUUID()}`);
  // 恢复 env: research.js 顶层不读 env, 只在请求时读 → 只需保证测试注入窗口正确
  return mod;
}
process.envTest = true;

const results = [];
async function T(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name + ' — ' + e.message]); }
}

// ============ 1) 预算未配置 → 503 budget_not_configured ============
await T('budget not configured → 503 block', async () => {
  delete process.env.BUDGET_LIMIT_CREDIT;
  delete process.env.PROVIDER_URL; delete process.env.PROVIDER_KEY; delete process.env.MODEL_ID;
  const { default: handler } = await import('./research.js?cb=b1' + crypto.randomUUID());
  const res = mockRes();
  await handler(mockReq({ question: 'x' }), res);
  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.body.error.code, 'budget_not_configured');
});

// ============ 2) 供应商未配置 → 503 provider_not_configured ============
await T('provider not configured → 503', async () => {
  process.env.BUDGET_LIMIT_CREDIT = '10';
  delete process.env.PROVIDER_URL;
  const { default: handler } = await import('./research.js?cb=b2' + crypto.randomUUID());
  const res = mockRes();
  await handler(mockReq({ question: 'x' }), res);
  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.body.error.code, 'provider_not_configured');
});

// ============ 3) 空问题 → 400 ============
await T('empty question → 400', async () => {
  process.env.PROVIDER_URL = 'http://127.00.0.1:9/v1'; // 不可达, 但不应走到调用
  process.env.PROVIDER_KEY = 'test-key-not-real';
  process.env.MODEL_ID = 'test-model';
  const { default: handler } = await import('./research.js?cb=b3' + crypto.randomUUID());
  const res = mockRes();
  await handler(mockReq({ question: '   ' }), res);
  assert.strictEqual(res.statusCode, 400);
});

// ============ 4) 超时 → 504 upstream_timeout (上游挂起模拟) ============
await T('upstream hang → 504 timeout block', async () => {
  process.env.PROVIDER_TIMEOUT_MS = '300';
  process.env.MAX_RETRIES = '0';
  const srv = await httpServerHang(); // 挂起不响应的服务器
  process.env.PROVIDER_URL = `http://127.0.0.1:${srv.port}/v1`;
  const { default: handler } = await import('./research.js?cb=b4' + crypto.randomUUID());
  const res = mockRes();
  const t0 = Date.now();
  await handler(mockReq({ question: '井冈山在哪里' }), res);
  srv.server.close();
  assert.strictEqual(res.statusCode, 504, JSON.stringify(res.body));
  assert.ok(Date.now() - t0 < 5000, 'timeout must fire quickly');
});

// ============ 5) 上游 429 → 429 upstream_rate_limited ============
await T('upstream 429 → 429 rate limited', async () => {
  process.env.PROVIDER_TIMEOUT_MS = '2000';
  process.env.MAX_RETRIES = '1';
  const srv = await httpServerStatus(429, { retry_after: '30' });
  process.env.PROVIDER_URL = `http://127.0.0.1:${srv.port}/v1`;
  const { default: handler } = await import('./research.js?cb=b5' + crypto.randomUUID());
  const res = mockRes();
  await handler(mockReq({ question: 'x' }), res);
  srv.server.close();
  assert.strictEqual(res.statusCode, 429);
  assert.strictEqual(res.body.error.code, 'upstream_rate_limited');
  assert.strictEqual(res.headers['retry-after'], '30');
});

// ============ 6) 上游 402 余额不足 → 熔断 + 402 ============
await T('upstream 402 → circuit-break exhausted', async () => {
  const srv = await httpServerStatus(402, {}, '{"error":{"message":"insufficient balance"}}');
  process.env.PROVIDER_URL = `http://127.0.0.1:${srv.port}/v1`;
  const { default: handler } = await import('./research.js?cb=b6' + crypto.randomUUID());
  let res = mockRes();
  await handler(mockReq({ question: 'x' }), res);
  srv.server.close();
  assert.strictEqual(res.statusCode, 402);
  assert.strictEqual(res.body.error.code, 'budget_exhausted');
  // 第二次: 不再触上游 (熔断已标记)
  res = mockRes();
  await handler(mockReq({ question: 'x' }), res);
  assert.strictEqual(res.statusCode, 402, 'circuit breaker should short-circuit');
});

// —— 重置预算累计 (_lib 模块级状态; research 与 _lib 共享同一缓存实例) ——
{
  const lib = await import('./_lib.js'); // 无 query = research.js 实际引用的同一缓存实例
  if (lib.Budget && lib.Budget._spent !== undefined) lib.Budget._spent = 0;
}

// ============ 7) 真实成功调用 → 200 + 记账 + 预算递减 ============
await T('real success path → 200 + budget accounting', async () => {
  process.env.BUDGET_LIMIT_CREDIT = '10';
  const srv = await httpServerStatus(200, {}, JSON.stringify({
    model: 'glm-5.3', choices: [{ message: { content: '井冈山位于江西、湖南两省边界罗霄山脉中段。' } }],
    usage: { cost: { amount: 0.42, currency: 'credit' } },
  }));
  process.env.PROVIDER_URL = `http://127.0.0.1:${srv.port}/v1`;
  const { default: handler } = await import('./research.js?cb=b7' + crypto.randomUUID());
  const res = mockRes();
  await handler(mockReq({ question: '井冈山在哪里', scope: ['v1n03', 'v1n04'] }), res);
  srv.server.close();
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.ok, true);
  assert.ok(res.body.answer.includes('井冈山'));
  assert.strictEqual(res.body.usage.cost, 0.42);
  assert.strictEqual(res.body.usage.budgetLeft, 9.58);
});

// ============ 8) 预算耗尽 → 402 阻断 ============
await T('budget exhausted → 402 block', async () => {
  const srv = await httpServerStatus(200, {}, JSON.stringify({
    model: 'm', choices: [{ message: { content: 'ok' } }], usage: { cost: { amount: 5 } },
  }));
  process.env.PROVIDER_URL = `http://127.0.0.1:${srv.port}/v1`;
  const { default: handler } = await import('./research.js?cb=b8' + crypto.randomUUID());
  let res = mockRes();
  await handler(mockReq({ question: 'a' }), res); // cost 5 → spent 5+0.42(prev? no, module reloaded)
  res = mockRes();
  await handler(mockReq({ question: 'b' }), res); // cost 5 → spent 10 → exhausted
  srv.server.close();
  res = mockRes();
  await handler(mockReq({ question: 'c' }), res); // → 402
  assert.strictEqual(res.statusCode, 402, JSON.stringify(res.body));
  assert.strictEqual(res.body.error.code, 'budget_exhausted');
});

// ============ 9) 本站限流 → 429 (RL_MAX_PER_MIN) ============
await T('local rate limit → 429 after RL_MAX', async () => {
  process.env.RL_MAX_PER_MIN = '2';
  process.env.BUDGET_LIMIT_CREDIT = '100';
  const srv = await httpServerStatus(200, {}, JSON.stringify({
    model: 'm', choices: [{ message: { content: 'ok' } }], usage: {} }));
  process.env.PROVIDER_URL = `http://127.0.0.1:${srv.port}/v1`;
  const { default: handler } = await import('./research.js?cb=b9' + crypto.randomUUID());
  const codes = [];
  for (let i = 0; i < 3; i++) {
    const res = mockRes();
    await handler(mockReq({ question: 'q' + i }, { cookie: 'mx_sid=aaaaaaaaaaaaaaaa' }), res);
    codes.push(res.statusCode);
  }
  srv.server.close();
  assert.deepStrictEqual(codes, [200, 200, 429], JSON.stringify(codes));
});

// ============ 10) 密钥不出现在前端 ============
await T('no secrets in frontend files', async () => {
  const fs = await import('node:fs');
  const files = ['site/app.js', 'site/index.html', 'site/assets/map3d.js', 'site/sw.js'];
  let leaked = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const t = fs.readFileSync(f, 'utf8');
    if (/[A-Za-z0-9]{32,}/.test(t.replace(/[\u4e00-\u9fff]/g, ''))) leaked.push(f);
  }
  assert.deepStrictEqual(leaked, [], 'long-token-shaped strings in: ' + leaked.join(','));
});

// —— 本地挂起/状态码 http 服务器工具 ——
import http from 'node:http';
function listenOn(s) {
  return new Promise(resolve => s.listen(0, '127.0.0.1', () => resolve(s.address().port)));
}
async function httpServerHang() {
  const s = http.createServer(() => { /* never respond */ });
  const port = await listenOn(s);
  return { server: s, port };
}
async function httpServerStatus(status, headers = {}, body = '') {
  const s = http.createServer((req, resp) => { resp.writeHead(status, headers); resp.end(body); });
  const port = await listenOn(s);
  return { server: s, port };
}

// —— 汇总 ——
console.log('\n===== WP05 test summary =====');
let fail = 0;
for (const [st, name] of results) {
  console.log(`${st === 'PASS' ? '✓' : '✗'} ${st}  ${name}`);
  if (st === 'FAIL') fail++;
}
console.log(`${results.length - fail}/${results.length} passed`);
process.exitCode = fail ? 1 : 0; // 不显式 exit: 规避 Windows libuv UV_HANDLE_CLOSING 断言
