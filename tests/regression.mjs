// A08: 故障注入回归 — 数据保全与范围契约（无外部依赖，失败则非零退出）
// 运行: node tests/regression.mjs
import http from 'node:http';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail) : '')); }
}

// ---------- 1. MXStore: 坏数据不被覆盖 / 事务删除与恢复 ----------
await import('../site/lib/mx-store.js');
const S = globalThis.MXStore;

function fakeLS(init = {}, opts = {}) {
  const store = Object.assign({}, init);
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) {
      if (opts.failSet && opts.failSet(k)) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      store[k] = String(v);
    },
    removeItem(k) { delete store[k]; },
    _dump() { return store; },
  };
}

console.log('MXStore · 坏数据保护');
{
  const ls = fakeLS({ mx_notes: '{broken json' });
  const m = S.make(ls);
  const r = m.read('mx_notes', 'array');
  ok('坏 JSON 读成 corrupt 而不是空库', r.status === 'corrupt', r);
  const up = m.update('mx_notes', 'array', (l) => l.concat([{ id: 'n1' }]));
  ok('损坏时 update 中止', up.ok === false && up.status === 'corrupt', up);
  ok('原始字节保持不变', ls._dump().mx_notes === '{broken json', ls._dump().mx_notes);
}
{
  const ls = fakeLS({ mx_notes: '{"a":1}' });
  const m = S.make(ls);
  const r = m.read('mx_notes', 'array');
  ok('结构不符（对象当数组）判为 corrupt', r.status === 'corrupt', r);
  ok('结构不符时不写入', ls._dump().mx_notes === '{"a":1}');
}
{
  const ls = fakeLS({});
  const m = S.make(null);   // storage 不可用
  const r = m.read('mx_notes', 'array');
  ok('存储不可用 → unavailable', r.status === 'unavailable', r);
  const up = S.make(ls).update('mx_notes', 'array', (l) => l.concat([{ id: 'x' }]));
  ok('空库可正常写入', up.ok === true && up.value.length === 1, up);
}

console.log('MXStore · 删除/恢复事务顺序');
{
  const ls = fakeLS({ mx_notes: JSON.stringify([{ id: 'n1', t: 1 }]) });
  const m = S.make(ls);
  // 用 failSet 模拟回收站写入失败
  const ls2 = fakeLS({ mx_notes: JSON.stringify([{ id: 'n1', t: 1 }]) }, { failSet: (k) => k === 'mx_trash' });
  const m2 = S.make(ls2);
  const r2 = m2.deleteWithTrash({ collKey: 'mx_notes', kind: 'note', id: 'n1' });
  ok('回收站写入失败 → 不删除原条目', r2.ok === false && JSON.parse(ls2._dump().mx_notes).length === 1, r2);
}
{
  const ls = fakeLS({ mx_notes: JSON.stringify([{ id: 'n1', t: 1 }]) });
  const m = S.make(ls);
  const r = m.deleteWithTrash({ collKey: 'mx_notes', kind: 'note', id: 'n1' });
  ok('正常删除：原集合空 + 回收站有 1 条', r.ok && JSON.parse(ls._dump().mx_notes).length === 0 && JSON.parse(ls._dump().mx_trash).length === 1, r);
  const back = m.restoreFromTrash({ index: 0 });
  ok('恢复：主集合回到 1 条 + 回收站清空', back.ok && JSON.parse(ls._dump().mx_notes).length === 1 && JSON.parse(ls._dump().mx_trash).length === 0, back);
}
{
  const ls = fakeLS({ mx_notes: '[]', mx_trash: JSON.stringify([{ kind: 'note', id: 'n9', payload: { id: 'n9' }, at: 1 }]) },
                    { failSet: (k) => k === 'mx_notes' });
  const m = S.make(ls);
  const r = m.restoreFromTrash({ index: 0 });
  ok('恢复写入失败 → 回收站条目保留', r.ok === false && JSON.parse(ls._dump().mx_trash).length === 1, r);
}

// ---------- 2. 范围契约 ----------
console.log('resolveScope · 反例矩阵');
const govern = await import('../api/_govern.js');
const ctx = {
  corpusParagraphs: [
    { id: 'pv1n03-001', articleId: 'v1n03' },
    { id: 'pv1n03-002', articleId: 'v1n03' },
    { id: 'pv1n04-001', articleId: 'v1n04' },
  ],
  topics: { jgs: { articles: ['v1n03', 'v1n04'] }, narrow: { articles: ['v1n03'] } },
};
function scopeThrows(body) {
  try { govern.resolveScope(body, ctx); return null; } catch (e) { return e.code || 'ERR'; }
}
ok('scope={} 被拒绝（不扩大为全库）', scopeThrows({ scope: {} }) === 'scope_invalid');
ok('scope=false 被拒绝', scopeThrows({ scope: false }) === 'scope_invalid');
ok('scope 数组被拒绝', scopeThrows({ scope: [] }) === 'scope_invalid');
ok('mode:corpus 正常受理', govern.resolveScope({ scope: { mode: 'corpus' } }, ctx).mode === 'corpus');
ok('显式 mode:corpus + articleIds 冲突被拒绝', scopeThrows({ scope: { mode: 'corpus', articleIds: ['v1n03'] } }) === 'scope_invalid');
ok('未提供 scope → corpus 且回显', govern.resolveScope({}, ctx).mode === 'corpus');
ok('未知文章被拒绝', scopeThrows({ scope: { articleIds: ['v9n99'] } }) === 'scope_invalid');
ok('未知段落被拒绝', scopeThrows({ scope: { paragraphIds: ['pv9n99-001'] } }) === 'scope_invalid');
ok('未知专题被拒绝', scopeThrows({ scope: { topicId: 'nope' } }) === 'scope_invalid');
ok('专题夹带外部文章被拒绝', scopeThrows({ scope: { topicId: 'narrow', articleIds: ['v1n04'] } }) === 'scope_invalid');
ok('topicId + 不在专题内的段落被拒绝',
   scopeThrows({ scope: { topicId: 'narrow', paragraphIds: ['pv1n04-001'] } }) === 'scope_invalid');
ok('段落 + 不一致 articleIds 被拒绝',
   scopeThrows({ scope: { paragraphIds: ['pv1n03-001'], articleIds: ['v1n04'] } }) === 'scope_invalid');
{
  const s = govern.resolveScope({ scope: { paragraphIds: ['pv1n03-002'] } }, ctx);
  ok('段落范围返回 paragraphs 且只含该段', s.mode === 'paragraphs' && s.paragraphIds.length === 1 && s.articleIds[0] === 'v1n03', s);
}
{
  const ps = govern.scopeParagraphs({ mode: 'paragraphs', articleIds: ['v1n03'], paragraphIds: ['pv1n03-002'] }, ctx.corpusParagraphs);
  ok('段落范围真正收窄检索语料', ps.length === 1 && ps[0].id === 'pv1n03-002', ps.map(p => p.id));
}

// ---------- 3. 台账: KV 命令错误必须暴露（不假成功） ----------
console.log('recordUsage · KV 错误不伪装成功');
const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'ERR wrong number of arguments for \'incrbyfloat\' command' }));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
process.env.KV_REST_API_URL = `http://127.0.0.1:${port}`;
process.env.KV_REST_API_TOKEN = 'test-token';
const govern2 = await import('../api/_govern.js?v=2');
const ledger = await govern2.recordUsage({ requestId: 'req_test', attemptId: 'final', calls: 1, costKnown: false, cost: null, status: 'answered' });
ok('KV 返回 error → persisted=false 且带原因', ledger.persisted === false && !!ledger.error, ledger);
srv.close();


// ---------- 4. B02/B03: 跨实例预算原子预占 ----------
console.log('makeBudget · 跨实例与故障策略');
{
  const store = new Map();
  const kv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const args = JSON.parse(body || '[]');
      const cmd = String(args[0] || '').toUpperCase();
      const key = args[1];
      let result = null;
      try {
        if (cmd === 'INCRBY') { const v = (Number(store.get(key)) || 0) + Number(args[2]); store.set(key, v); result = v; }
        else if (cmd === 'DECRBY') { const v = (Number(store.get(key)) || 0) - Number(args[2]); store.set(key, v); result = v; }
        else if (cmd === 'GET') { result = store.has(key) ? String(store.get(key)) : null; }
        else if (cmd === 'SET') { if (args.includes('NX') && store.has(key)) result = null; else { store.set(key, args[2]); result = 'OK'; } }
        else if (cmd === 'HINCRBY') { result = Number(args[3]); }
        else if (cmd === 'HINCRBYFLOAT') { result = Number(args[3]); }
        else if (cmd === 'EXPIRE') { result = 1; }
      } catch (e) { res.end(JSON.stringify({ error: String(e.message) })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
    });
  });
  await new Promise((r) => kv.listen(0, '127.0.0.1', r));
  process.env.KV_REST_API_URL = `http://127.0.0.1:${kv.address().port}`;
  process.env.KV_REST_API_TOKEN = 'k';
  process.env.BUDGET_LIMIT_CREDIT = '1';
  process.env.BUDGET_PERIOD = 'test-period';
  const g = await import('../api/_govern.js?v=budget');
  const b1 = await g.makeBudget();
  const b2 = await g.makeBudget();          // 模拟两个独立服务进程
  ok('预算 scope=global（有 KV）', b1.scope === 'global', b1.scope);
  const r1 = await b1.reserve(1);
  const r2 = await b2.reserve(1);           // 第二个进程只能拿到 0 次
  ok('两进程争抢 1 次额度：只成功 1 次', r1 === true && r2 === false, { r1, r2 });
  ok('回滚后全局用量仍为 1', (await b1.used()) === 1, await b1.used());

  // KV 故障 → 拒绝新增调用（不能放开成本控制）
  kv.close();
  await new Promise((r) => setTimeout(r, 60));
  const r3 = await b1.reserve(1);
  ok('KV 故障时拒绝新增调用', r3 === false, r3);
}

console.log('');
console.log(`结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
