// QA02 · CNY 费用治理反例测试 — 本地直跑 (node api/test-cny.js)
// 用 mock 供应商 + 内存 KV，不消耗任何生产额度、不接触真实密钥。
// 覆盖: 失败仍计费 / 缺 usage 不记零 / 预留上界覆盖实际 / 重复结算幂等 /
//       小额预算并发不超发 / KV 故障停止新增 / 上游 402 熔断不二次异常
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

/* ---------- 内存 KV ---------- */
const kvStore = new Map();
const kv = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const args = JSON.parse(body || '[]');
    const cmd = String(args[0] || '').toUpperCase();
    const key = args[1];
    let result = null;
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
const KV_URL = `http://127.0.0.1:${kv.address().port}`;

/* ---------- 可切换行为的 mock 供应商 ---------- */
let behavior = 'ok_insufficient';
const USAGE = { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 };  // 每次尝试 0.0028 元
const PER_ATTEMPT = (1000 * 2.0 + 100 * 8.0) / 1e6;
const upstream = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const send = (status, obj, delay = 0) =>
      setTimeout(() => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
      }, delay);
    if (behavior === 'ok_insufficient') {
      return send(200, { model: 'fake', choices: [{ message: { content: '{"status":"insufficient","answer":"","citations":[]}' } }], usage: USAGE });
    }
    if (behavior === 'fabricated') {
      return send(200, { model: 'fake', choices: [{ message: { content: '{"status":"answered","answer":"答案是甲","citations":[{"id":"pv1n03-999","quote":"不存在的引文"}]}' } }], usage: USAGE });
    }
    if (behavior === 'no_usage') {
      return send(200, { model: 'fake', choices: [{ message: { content: '{"status":"insufficient","answer":"","citations":[]}' } }] });
    }
    if (behavior === 'slow') {
      return send(200, { model: 'fake', choices: [{ message: { content: '{"status":"insufficient"}' } }], usage: USAGE }, 1500);
    }
    if (behavior === 'upstream_402') {
      return send(402, '{"error":"insufficient balance"}');
    }
    return send(500, '{"error":"unexpected"}');
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const UP_URL = `http://127.0.0.1:${upstream.address().port}`;

/* ---------- 加载被测 handler (单次导入: KV URL 在模块级读取) ---------- */
Object.assign(process.env, {
  KV_REST_API_URL: KV_URL,
  KV_REST_API_TOKEN: 'test',
  PROVIDER_URL: UP_URL,
  PROVIDER_KEY: 'test-key',
  MODEL_ID: 'fake-model',
  PROVIDER_TIMEOUT_MS: '400',
  ASK_RL_MAX_PER_MIN: '100',
  ASK_RL_IP_PER_MIN: '100',
  ASK_RL_GLOBAL_PER_MIN: '1000',
  BUDGET_LIMIT_CNY: '50',
  BUDGET_PERIOD: 'cny-base',
});
const { default: handler } = await import(`./ask.mjs?cny=${crypto.randomUUID()}`);

let ipSeq = 0;
async function call(period, { limit = '50', ip } = {}) {
  process.env.BUDGET_PERIOD = period;
  process.env.BUDGET_LIMIT_CNY = limit;
  const sid = crypto.randomBytes(8).toString('hex');
  const res = mockRes();
  await handler(mockReq({ question: '井冈山在哪里', scope: { articleIds: ['v1n03'] } },
    { cookie: `mx_sid=${sid}`, 'x-forwarded-for': ip || `198.51.100.${++ipSeq}` }), res);
  return res;
}
const budgetOf = (period) => Number(kvStore.get(`mx:budget:cny:${period}`) || 0);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* ---------- 1. 正常成功：预留换成真实费用 ---------- */
await T('成功调用：额度=真实费用（不是预留上限）', async () => {
  behavior = 'ok_insufficient';
  const r = await call('cny-ok');
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body).slice(0, 200));
  assert.strictEqual(r.body.usage.settlement, 'settled_actual');
  assert.strictEqual(r.body.usage.costKnown, true);
  assert.ok(near(r.body.usage.costCny, PER_ATTEMPT), 'costCny=' + r.body.usage.costCny);
  assert.ok(near(budgetOf('cny-ok'), PER_ATTEMPT), 'budget=' + budgetOf('cny-ok'));
  assert.ok(r.body.usage.reserveCny >= r.body.usage.costCny, '预留上界必须 ≥ 实际');
});

/* ---------- 2. FIX02：引用校验失败仍然计费（旧实现全额退回） ---------- */
await T('引用校验失败：按两次尝试的真实费用结算，不退回全部预留', async () => {
  behavior = 'fabricated';
  const r = await call('cny-fab');
  assert.strictEqual(r.statusCode, 502);
  assert.strictEqual(r.body.error.code, 'citation_validation_failed');
  assert.strictEqual(r.body.error.detail.settlement, 'settled_actual');
  const expected = Math.round(PER_ATTEMPT * 2 * 1e6) / 1e6;   // 两次尝试都被计费
  assert.ok(near(budgetOf('cny-fab'), expected), `budget=${budgetOf('cny-fab')} expected=${expected}`);
  assert.ok(budgetOf('cny-fab') > 0, '失败不得被记成零元');
});

/* ---------- 3. FIX02：上游没回 usage → 保留预留，不算零元 ---------- */
await T('缺 usage：记为未知并保留预留（不按 0 元已知费用结算）', async () => {
  behavior = 'no_usage';
  const r = await call('cny-nousage');
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.usage.settlement, 'held');
  assert.strictEqual(r.body.usage.costKnown, false);
  assert.strictEqual(r.body.usage.cost, null);
  const held = budgetOf('cny-nousage');
  assert.ok(near(held, r.body.usage.reserveCny), `held=${held} reserve=${r.body.usage.reserveCny}`);
});

/* ---------- 4. 超时：保留预留（上游可能已计费） ---------- */
await T('超时：保留预留不释放，返回可恢复的 504', async () => {
  behavior = 'slow';
  const r = await call('cny-timeout');
  assert.strictEqual(r.statusCode, 504);
  assert.strictEqual(r.body.error.code, 'upstream_timeout');
  assert.strictEqual(r.body.error.detail.settlement, 'held');
  assert.ok(budgetOf('cny-timeout') > 0);
});

/* ---------- 5. 重复结算幂等 ---------- */
await T('重复 settle 同一 request/attempt：只生效一次', async () => {
  const g = await import(`./_govern.mjs?dup=${crypto.randomUUID()}`);
  process.env.BUDGET_PERIOD = 'cny-dup';
  process.env.BUDGET_LIMIT_CNY = '50';
  const b = await g.makeCnyBudget();
  await b.reserve(1.0);
  const a1 = await b.settle(1.0, 0.25, { idemKey: 'req_dup:final', mode: 'settle' });
  const a2 = await b.settle(1.0, 0.25, { idemKey: 'req_dup:final', mode: 'settle' });
  assert.strictEqual(a1.ok, true);
  assert.strictEqual(a2.deduped, true);
  assert.ok(near(budgetOf('cny-dup'), 0.25), 'budget=' + budgetOf('cny-dup'));
});

/* ---------- 6. 小额预算：预留大于剩余额度 → 直接阻断，不发起调用 ---------- */
await T('剩余额度小于预留上界：402 且额度回到 0（回滚正确）', async () => {
  behavior = 'ok_insufficient';
  const r = await call('cny-tiny', { limit: '0.001' });
  assert.strictEqual(r.statusCode, 402);
  assert.strictEqual(r.body.error.code, 'budget_exhausted');
  assert.ok(r.body.error.detail.reserveCny > 0.001);
  assert.ok(near(budgetOf('cny-tiny'), 0), 'budget=' + budgetOf('cny-tiny'));
});

/* ---------- 7. 并发临界：额度只够一次时不能放出两次 ---------- */
await T('并发临界值：额度仅够一次时只放行一个请求', async () => {
  behavior = 'ok_insufficient';
  const probe = await call('cny-probe', { limit: '0.001' });
  const reserve = probe.body.error.detail.reserveCny;
  const limit = String(Math.round(reserve * 1.5 * 1e6) / 1e6);
  const [a, b] = await Promise.all([call('cny-race', { limit }), call('cny-race', { limit })]);
  const codes = [a.statusCode, b.statusCode].sort();
  assert.deepStrictEqual(codes, [200, 402], 'codes=' + JSON.stringify(codes));
  assert.ok(budgetOf('cny-race') <= Number(limit) + 1e-9, 'budget=' + budgetOf('cny-race'));
});

/* ---------- 8. FIX04：上游 402 熔断，不得二次异常 ---------- */
await T('上游 402：返回 upstream_insufficient 并把本周期额度标记为耗尽', async () => {
  behavior = 'upstream_402';
  const r1 = await call('cny-up402');
  assert.strictEqual(r1.statusCode, 402, JSON.stringify(r1.body).slice(0, 200));
  assert.strictEqual(r1.body.error.code, 'upstream_insufficient');
  assert.ok(budgetOf('cny-up402') >= 50 - 1e-9, '熔断后额度应记为上限, 实际 ' + budgetOf('cny-up402'));
  const r2 = await call('cny-up402');
  assert.strictEqual(r2.statusCode, 402);
  assert.strictEqual(r2.body.error.code, 'budget_exhausted');
});

/* ---------- 9. KV 故障：停止新增调用（fail closed） ---------- */
await T('KV 故障时拒绝新增模型调用', async () => {
  kv.close();
  await new Promise((r) => setTimeout(r, 60));
  behavior = 'ok_insufficient';
  const r = await call('cny-kvdown');
  assert.ok([402, 503].includes(r.statusCode), 'status=' + r.statusCode);
});

upstream.close();
console.log('');
for (const [s, n] of results) console.log(`${s === 'PASS' ? '✓' : '✗'} ${n}`);
const fail = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n结果: ${results.length - fail} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
