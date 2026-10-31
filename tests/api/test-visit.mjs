// R53 离线回归：访问统计的纯逻辑（页面归一 / 键名 / HGETALL 解析 / 口径说明）
// 无 KV 依赖（kvCmd 由注入决定）。运行: node tests/api/test-visit.mjs
import { normalizePage, dayKeyOf, keysFor, TOTAL_KEYS, hashToObj } from '../../site/api/_visit.mjs';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 200) : '')); }
}

console.log('visit · 页面归一');
ok('已知页面原样', normalizePage('research') === 'research');
ok('大小写归一', normalizePage('Solve') === 'solve');
ok('未知页面归为 other', normalizePage('hack') === 'other');
ok('空值归为 other', normalizePage(undefined) === 'other');
ok('带空白归一', normalizePage(' index ') === 'index');

console.log('visit · 键名与命名空间');
const k = keysFor('2026-10-31');
ok('当日 PV 键带 mx: 前缀与日期', k.pv === 'mx:visit:pv:2026-10-31');
ok('当日 UV 键正确', k.uv === 'mx:visit:uv:2026-10-31');
ok('总计键存在且不过期语义分离', TOTAL_KEYS.pv === 'mx:visit:pv:total' && TOTAL_KEYS.uv === 'mx:visit:uv:total');

console.log('visit · HGETALL 解析');
{
  const o = hashToObj(['index', '3', 'solve', '2']);
  ok('解析为 {page:count}', o.index === 3 && o.solve === 2, o);
  ok('求和口径 = PV 合计', Object.values(o).reduce((n, x) => n + x, 0) === 5);
  ok('空数组 → 空对象', Object.keys(hashToObj([])).length === 0);
}

console.log('visit · dayKey 口径');
ok('UTC 日格式 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(dayKeyOf()));
ok('显式 Date 透传', dayKeyOf(new Date(Date.UTC(2026, 0, 2))) === '2026-01-02');

console.log('');
console.log(`结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
