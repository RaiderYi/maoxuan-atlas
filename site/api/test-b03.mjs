// B03 生产治理分支测试 — 本地直跑 (node api/test-b03.js), 不需要部署
// 覆盖: ①被限流的请求不消耗预算(旧顺序会每次漏 0.06 元) ②丢 Cookie 不再获得无限额度
// ③KV 键带 mx: 命名空间 ④三级限流同时在响应里可核对
import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';

function mockRes() {
  const r = {
    headers: {}, statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; },
  };
  return r;
}
const mockReq = (body, headers = {}) => ({ method: 'POST', body, headers });

const results = [];
async function T(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name + ' — ' + e.message]); }
}

// ---------- 假 KV (实现本管线用到的命令) ----------
const kvStore = new Map();
const kvKeys = [];
const kv = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const args = JSON.parse(body || '[]');
    const cmd = String(args[0] || '').toUpperCase();
    const key = args[1];
    let result = null;
    if (key) kvKeys.push(key);
    if (cmd === 'INCR') { const v = (Number(kvStore.get(key)) || 0) + 1; kvStore.set(key, v); result = v; }
    else if (cmd === 'INCRBY') { const v = (Number(kvStore.get(key)) || 0) + Number(args[2]); kvStore.set(key, v); result = v; }
    else if (cmd === 'DECRBY') { const v = (Number(kvStore.get(key)) || 0) - Number(args[2]); kvStore.set(key, v); result = v; }
    else if (cmd === 'INCRBYFLOAT') { const v = Math.round(((Number(kvStore.get(key)) || 0) + Number(args[2])) * 1e6) / 1e6; kvStore.set(key, v); result = String(v); }
    else if (cmd === 'HINCRBY') { const hk = key + ':' + args[2]; const v = (Number(kvStore.get(hk)) || 0) + Number(args[3]); kvStore.set(hk, v); result = v; }
    else if (cmd === 'HINCRBYFLOAT') { const hk = key + ':' + args[2]; const v = (Number(kvStore.get(hk)) || 0) + Number(args[3]); kvStore.set(hk, v); result = v; }
    else if (cmd === 'PEXPIRE' || cmd === 'EXPIRE') { result = 1; }
    else if (cmd === 'GET') { result = kvStore.has(key) ? String(kvStore.get(key)) : null; }
    else if (cmd === 'SET') { if (args.includes('NX') && kvStore.has(key)) result = null; else { kvStore.set(key, args[2]); result = 'OK'; } }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ result }));
  });
});
await new Promise((r) => kv.listen(0, '127.0.0.1', r));
const kvUrl = `http://127.0.0.1:${kv.address().port}`;

// ---------- 假上游: 一律返回 insufficient (零 token, 零成本, 不触发引用校验) ----------
const providerCalls = { n: 0 };
const upstream = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    providerCalls.n += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      model: 'fake-model',
      choices: [{ message: { content: '{"status":"insufficient","answer":"","citations":[]}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    }));
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));

process.env.KV_REST_API_URL = kvUrl;
process.env.KV_REST_API_TOKEN = 'test';
process.env.PROVIDER_URL = `http://127.0.0.1:${upstream.address().port}`;
process.env.PROVIDER_KEY = 'test-key';
process.env.MODEL_ID = 'fake-model';
process.env.BUDGET_LIMIT_CNY = '50';
process.env.BUDGET_PERIOD = 'b03test';
process.env.ASK_RL_MAX_PER_MIN = '5';
process.env.ASK_RL_IP_PER_MIN = '8';
process.env.ASK_RL_GLOBAL_PER_MIN = '60';

const { default: handler } = await import(`./ask.mjs?b03=${crypto.randomUUID()}`);
const BODY = { question: '井冈山在哪里', scope: { articleIds: ['v1n03'] } };
const IP = '203.0.113.9';

async function call(sid, ip = IP) {
  const res = mockRes();
  await handler(mockReq(JSON.parse(JSON.stringify(BODY)), { cookie: `mx_sid=${sid}`, 'x-forwarded-for': ip }), res);
  return res;
}
const budgetUsed = () => Number(kvStore.get('mx:budget:cny:b03test') || 0);

// ---------- 1. 会话限流: 前 5 次通过, 第 6 次 429 ----------
await T('同一会话第 6 次被限流, 429 且 limitScope=session', async () => {
  const sid = 'a'.repeat(16);
  const codes = [];
  for (let i = 0; i < 6; i++) {
    const r = await call(sid);
    codes.push(r.statusCode);
    if (r.statusCode === 429) {
      assert.strictEqual(r.body.error.code, 'rate_limited');
      assert.strictEqual(r.body.error.detail.limitScope, 'session');
    }
  }
  assert.deepStrictEqual(codes, [200, 200, 200, 200, 200, 429], codes);
});

// ---------- 2. 被限流不消耗预算 (核心回归: 旧顺序每次漏 0.06 元) ----------
await T('被限流的请求不消耗预算', async () => {
  // 上面 5 次成功调用都是 110 token 的 insufficient, 按官方高峰价成本 > 0 且远小于每次 0.06 预留
  const used = budgetUsed();
  const perCall = (100 * 2.0 + 10 * 8.0) / 1e6;    // ≈ 0.00028 元
  assert.ok(used > 0, '预算应随成功调用增加, 实际 ' + used);
  assert.ok(Math.abs(used - perCall * 5) < 1e-9,
    `预算应等于 5 次真实成本之和 ${(perCall * 5).toFixed(8)}, 实际 ${used}`);
  assert.ok(used < 0.06, '若第 6 次(429)也预留且未释放, 预算会多出 0.06, 实际 ' + used);
});

// ---------- 3. 丢 Cookie: 换 sid 仍被纯 IP 桶挡住 ----------
await T('丢 Cookie 不再获得无限额度 (IP 桶独立生效)', async () => {
  // 同一 IP 计数: 5 次成功 + 第 6 次(429 也算一次尝试) = 6; 上限 8 → 新 Cookie 再放行 2 次, 第 3 次应 429 ip
  const codes = [];
  let scope = null;
  for (let i = 0; i < 6; i++) {
    const sid = (String(i) + 'f'.repeat(15)).slice(0, 16);
    const r = await call(sid);
    codes.push(r.statusCode);
    if (r.statusCode === 429) { scope = r.body.error.detail.limitScope; break; }
  }
  assert.deepStrictEqual(codes, [200, 200, 429], codes);
  assert.strictEqual(scope, 'ip');
});

// ---------- 4. KV 键命名空间 ----------
await T('所有 KV 键都带 mx: 前缀', async () => {
  assert.ok(kvKeys.length > 0);
  const bad = [...new Set(kvKeys.filter((k) => !String(k).startsWith('mx:')))];
  assert.deepStrictEqual(bad, []);
});

// ---------- 5. 响应里的三级限流可核对 ----------
await T('响应 governance.rateLimits 三级齐全', async () => {
  const sid = '0123456789abcdef';
  const r = await call(sid, '198.51.100.77');   // 换 IP: 避免被上一个用例的 IP 桶挡住
  assert.strictEqual(r.statusCode, 200);
  const rl = r.body.governance.rateLimits;
  for (const k of ['session', 'ip', 'global']) {
    assert.ok(rl[k] && typeof rl[k].max === 'number' && typeof rl[k].used === 'number', '缺少 ' + k);
    assert.strictEqual(rl[k].scope, 'global');   // 有 KV → 全局
  }
});

kv.close();
upstream.close();
console.log('');
for (const [s, n] of results) console.log(`${s === 'PASS' ? '✓' : '✗'} ${n}`);
const fail = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n结果: ${results.length - fail} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
