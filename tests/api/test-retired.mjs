// R44 · 退役端点契约 — 旧 /api/research 必须稳定返回 410 且指向 /api/ask
// （原 test-wp05.mjs 测的是已退役端点的旧行为，实际 1/10 通过，属于过期测试，已由本用例取代）
import assert from 'node:assert';
import crypto from 'node:crypto';

function mockRes() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
  };
}
const { default: handler } = await import(`../../site/api/research.mjs?r=${crypto.randomUUID()}`);
const res = mockRes();
await handler({ method: 'POST', headers: {}, body: { question: 'x' } }, res);
assert.strictEqual(res.statusCode, 410);
assert.strictEqual(res.body.error.code, 'endpoint_retired');
assert.strictEqual(res.body.error.replacedBy, '/api/ask');
assert.strictEqual(res.headers['cache-control'], 'no-store');
console.log('✓ 退役端点 /api/research → 410 endpoint_retired (replacedBy=/api/ask)');
