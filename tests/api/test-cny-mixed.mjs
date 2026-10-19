// QA03 · 混合尝试费用记账反例测试 (R25/R26)
// 复审报告 F02 的两个复现反例 + 终态幂等互斥回归。
// mock 供应商 + 内存 KV, 不接触真实密钥、不产生真实费用。
// 运行: node site/api/test-cny-mixed.mjs
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

/* ---------- 内存 KV (与 test-cny.mjs 同语义) ---------- */
const kvStore = new Map();
let failNextIncrByFloat = 0;
const kv = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const args = JSON.parse(body || '[]');
    const cmd = String(args[0] || '').toUpperCase();
    const key = args[1];
    let result = null;
    let error;
    if (cmd === 'INCRBYFLOAT' && failNextIncrByFloat > 0) {
      failNextIncrByFloat--;
      error = 'injected kv failure';
    } else if (cmd === 'INCR') { const v = (Number(kvStore.get(key)) || 0) + 1; kvStore.set(key, v); result = v; }
    else if (cmd === 'INCRBY') { const v = (Number(kvStore.get(key)) || 0) + Number(args[2]); kvStore.set(key, v); result = v; }
    else if (cmd === 'DECRBY') { const v = (Number(kvStore.get(key)) || 0) - Number(args[2]); kvStore.set(key, v); result = v; }
    else if (cmd === 'INCRBYFLOAT') {
      const v = Math.round(((Number(kvStore.get(key)) || 0) + Number(args[2])) * 1e6) / 1e6;
      kvStore.set(key, v); result = String(v);
    }
    else if (cmd === 'HINCRBY') { const hk = key + ':' + args[2]; const v = (Number(kvStore.get(hk)) || 0) + Number(args[3]); kvStore.set(hk, v); result = v; }
    else if (cmd === 'HINCRBYFLOAT') { const hk = key + ':' + args[2]; const v = (Number(kvStore.get(hk)) || 0) + Number(args[3]); kvStore.set(hk, v); result = v; }
    else if (cmd === 'DEL') { kvStore.delete(key); result = 1; }
    else if (cmd === 'PEXPIRE' || cmd === 'EXPIRE') { result = 1; }
    else if (cmd === 'GET') { result = kvStore.has(key) ? String(kvStore.get(key)) : null; }
    else if (cmd === 'SET') { if (args.includes('NX') && kvStore.has(key)) result = null; else { kvStore.set(key, args[2]); result = 'OK'; } }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(error ? { error } : { result }));
  });
});
await new Promise((r) => kv.listen(0, '127.0.0.1', r));
const KV_URL = `http://127.0.0.1:${kv.address().port}`;

/* ---------- 序列驱动的 mock 供应商 ---------- */
const USAGE = { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 };
const PER_ATTEMPT = (1000 * 2.0 + 100 * 8.0) / 1e6;   // 0.0028 元
const FABRICATED = '{"status":"answered","answer":"答案是甲","citations":[{"id":"pv1n03-999","quote":"不存在的引文"}]}';
const OK_INSUFFICIENT = '{"status":"insufficient","answer":"","citations":[]}';
let seq = [];        // 依次返回的步骤; 用尽后沿用最后一步
let seqIdx = 0;
const upstream = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const step = seq[Math.min(seqIdx, seq.length - 1)] || {};
    seqIdx++;
    if (step.status && step.status !== 200) {
      res.writeHead(step.status, { 'Content-Type': 'application/json' });
      return res.end('{"error":"upstream"}');
    }
    const payload = { model: 'fake', choices: [{ message: { content: step.content ?? OK_INSUFFICIENT } }] };
    if (step.usage !== false) payload.usage = USAGE;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const UP_URL = `http://127.0.0.1:${upstream.address().port}`;

Object.assign(process.env, {
  KV_REST_API_URL: KV_URL,
  KV_REST_API_TOKEN: 'test',
  PROVIDER_URL: UP_URL,
  PROVIDER_KEY: 'test-key',
  MODEL_ID: 'fake-model',
  PROVIDER_TIMEOUT_MS: '2000',
  ASK_RL_MAX_PER_MIN: '100',
  ASK_RL_IP_PER_MIN: '100',
  ASK_RL_GLOBAL_PER_MIN: '1000',
  ASK_MAX_RETRIES: '1',
  BUDGET_LIMIT_CNY: '50',
  BUDGET_PERIOD: 'mixed-base',
});
const { default: handler } = await import(`../../site/api/ask.mjs?mixed=${crypto.randomUUID()}`);

let ipSeq = 0;
async function call(period, { limit = '50' } = {}) {
  process.env.BUDGET_PERIOD = period;
  process.env.BUDGET_LIMIT_CNY = limit;
  const sid = crypto.randomBytes(8).toString('hex');
  const res = mockRes();
  await handler(mockReq({ question: '井冈山在哪里', scope: { articleIds: ['v1n03'] } },
    { cookie: `mx_sid=${sid}`, 'x-forwarded-for': `198.51.100.${++ipSeq}` }), res);
  return res;
}
function run(period, steps) {
  seq = steps; seqIdx = 0;
  return call(period);
}
const budgetOf = (period) => Math.round(Number(kvStore.get(`mx:budget:cny:${period}`) || 0) * 1e6) / 1e6;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/* ---------- 反例 1 (F02): 第一次缺 usage, 第二次已知 usage 且成功 ----------
   旧行为: 整请求 costKnown=true, 只扣第二次 0.0028, 第一次变为零成本
   应有行为: 已知部分照扣, 未知部分继续预留 (不能标为费用完全已知) */
await T('反例1 混合尝试: 未知的第一笔不得被记成零成本', async () => {
  const r = await run('mixed-1', [
    { content: FABRICATED, usage: false },      // 不合规 + 上游没回 usage
    { content: OK_INSUFFICIENT, usage: true },  // 合规 + usage 已知
  ]);
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body).slice(0, 300));
  assert.strictEqual(r.body.usage.costKnown, false, '整请求不得标为费用完全已知');
  assert.strictEqual(r.body.usage.unknownCalls, 1, '必须报出 1 次未知费用的调用');
  assert.ok(near(r.body.usage.costCny, PER_ATTEMPT), 'costCny=' + r.body.usage.costCny);
  const b = budgetOf('mixed-1');
  assert.ok(b >= PER_ATTEMPT - 1e-9, `已发生的 0.0028 元必须扣掉, budget=${b}`);
  assert.ok(b > PER_ATTEMPT + 1e-9, `未知的那一笔要继续预留, budget=${b}`);
  assert.ok(b < r.body.usage.reserveCny + PER_ATTEMPT, `预留不得超出上限, budget=${b}`);
  assert.strictEqual(r.body.usage.settlement, 'partial_known_hold');
});

/* ---------- 反例 2 (F02): 第一次已知费用, 第二次上游 429 ----------
   旧行为: settlement=released, 全局预算回到 0 (第一笔被退掉)
   应有行为: 已发生费用保留, 不因后续拒绝而退款 */
await T('反例2 已知费用 + 后续 429: 已发生费用不得被释放', async () => {
  const r = await run('mixed-2', [
    { content: FABRICATED, usage: true },       // 不合规但已计费 0.0028
    { status: 429 },                            // 上游限流
  ]);
  assert.ok([429, 502].includes(r.statusCode), 'status=' + r.statusCode);
  const detail = r.body.error.detail || {};
  assert.notStrictEqual(detail.settlement, 'released', '已计费的请求不得整体释放');
  const b = budgetOf('mixed-2');
  assert.ok(near(b, PER_ATTEMPT), `第一笔 0.0028 元必须保留, budget=${b}`);
});

/* ---------- 回归: 两次尝试都已知 → 全额按实际结算 ---------- */
await T('回归: 两次尝试均已知费用 → settled_actual 合计', async () => {
  const r = await run('mixed-3', [
    { content: FABRICATED, usage: true },
    { content: FABRICATED, usage: true },
  ]);
  assert.strictEqual(r.statusCode, 502);
  assert.strictEqual(r.body.error.detail.settlement, 'settled_actual');
  assert.ok(near(budgetOf('mixed-3'), Math.round(PER_ATTEMPT * 2 * 1e6) / 1e6),
    'budget=' + budgetOf('mixed-3'));
});

/* ---------- 回归: 上游 402 直接拒绝且未计费 → 本次预留释放 (随后熔断把周期额度记为上限) ---------- */
await T('回归: 上游 402 未计费 → 本次预留释放, 并由熔断标记周期耗尽', async () => {
  const r = await run('mixed-4', [{ status: 402 }]);
  assert.strictEqual(r.statusCode, 402, JSON.stringify(r.body).slice(0, 200));
  assert.strictEqual(r.body.error.detail.settlement, 'released');
  assert.strictEqual(r.body.error.detail.cost, 0, '拒绝的调用不得产生费用');
  // markExhausted 把本周期剩余额度全部占住 (熔断), 这是设计行为, 与"本次是否计费"分开断言
  assert.ok(near(budgetOf('mixed-4'), 50), 'budget=' + budgetOf('mixed-4'));
});

/* ---------- R26: 终态互斥 — settle 之后 release 不得再改金额 ---------- */
await T('R26 终态互斥: 同一 request 的 settle 与 release 只能生效一次', async () => {
  const g = await import(`../../site/api/_govern.mjs?mixed=${crypto.randomUUID()}`);
  process.env.BUDGET_PERIOD = 'mixed-5';
  process.env.BUDGET_LIMIT_CNY = '50';
  const b = await g.makeCnyBudget();
  await b.reserve(1.0);
  const a1 = await b.settle(1.0, 0.25, { idemKey: 'req_x:final' });
  const a2 = await b.release(1.0, { idemKey: 'req_x:final' });
  assert.strictEqual(a1.ok, true);
  assert.strictEqual(a2.deduped, true, '终态已确定后 release 必须被去重');
  assert.ok(near(budgetOf('mixed-5'), 0.25), 'budget=' + budgetOf('mixed-5'));
});

/* ---------- R26: 守卫成功但金额写入失败 → 必须可重试, 不得吞掉这笔钱 ---------- */
await T('R26 结算可恢复: 金额写入失败后重试能够生效', async () => {
  const g = await import(`../../site/api/_govern.mjs?mixed=${crypto.randomUUID()}`);
  process.env.BUDGET_PERIOD = 'mixed-6';
  process.env.BUDGET_LIMIT_CNY = '50';
  const b = await g.makeCnyBudget();
  await b.reserve(1.0);
  failNextIncrByFloat = 1;
  const a1 = await b.settle(1.0, 0.25, { idemKey: 'req_y:final' });
  assert.strictEqual(a1.ok, false, '第一次写入失败必须如实返回失败');
  assert.strictEqual(a1.retryable, true, '必须标记为可重试');
  const a2 = await b.settle(1.0, 0.25, { idemKey: 'req_y:final' });
  assert.strictEqual(a2.ok, true, '重试必须能够生效 (守卫不得锁死未完成的结算)');
  assert.ok(near(budgetOf('mixed-6'), 0.25), 'budget=' + budgetOf('mixed-6'));
});

kv.close(); upstream.close();
console.log('');
for (const [s, n] of results) console.log(`${s === 'PASS' ? '✓' : '✗'} ${n}`);
const fail = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n结果: ${results.length - fail} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
