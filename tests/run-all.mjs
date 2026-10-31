#!/usr/bin/env node
/* 统一测试入口 (R44): 一次跑完所有回归套件, 任一失败即非零退出
 * 用法: npm test   或   node tests/run-all.mjs
 * 产出: 每套件的通过/失败数汇总 (数字来自子进程真实输出, 不做估算)
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SUITES = [
  { name: '数据保全/范围契约回归', file: 'tests/regression.mjs' },
  { name: '研读任务集合 (R07-R11)', file: 'tests/tasks.mjs' },
  { name: 'CNY 费用治理', file: 'tests/api/test-cny.mjs' },
  { name: '混合尝试费用 (R25/R26)', file: 'tests/api/test-cny-mixed.mjs' },
  { name: '正文服务 (R01)', file: 'tests/api/test-text.mjs' },
  { name: '证据工作区 (R27)', file: 'tests/evidence.mjs' },
  { name: '三级限流 (B03)', file: 'tests/api/test-b03.mjs' },
  { name: 'AI 离线断言', file: 'tests/api/test-wp07-offline.mjs' },
  { name: '退役端点契约 (R44)', file: 'tests/api/test-retired.mjs' },
  { name: '问题解决管线 (R49/R50)', file: 'tests/api/test-solve.mjs' },
  { name: '访问统计 (R53)', file: 'tests/api/test-visit.mjs' },
  { name: '混合检索 (R55)', file: 'tests/api/test-retrieval.mjs' },
  { name: '全量语料产线 (R56)', file: 'tests/api/test-corpus.mjs' },
];

const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
const rows = [];
let failed = 0;

for (const s of SUITES) {
  const file = path.join(ROOT, s.file);
  if (!fs.existsSync(file)) { rows.push([s.name, 'MISSING', s.file]); failed++; continue; }
  if (only.length && !only.some(o => s.file.includes(o))) continue;
  const r = spawnSync(process.execPath, [file], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = /结果:\s*(\d+)\s*通过\s*\/\s*(\d+)\s*失败/.exec(out) || /(\d+)\s*passed/i.exec(out);
  const passed = m ? Number(m[1]) : null;
  const failCount = m && m[2] !== undefined ? Number(m[2]) : (r.status === 0 ? 0 : null);
  const ok = r.status === 0;
  if (!ok) {
    failed++;
    console.log('\n--- ' + s.name + ' 失败输出 (尾部) ---');
    console.log(out.split('\n').slice(-25).join('\n'));
  }
  rows.push([s.name, ok ? 'PASS' : 'FAIL', passed != null ? `${passed} 例` : (failCount != null ? `${failCount} 失败` : 'exit ' + r.status)]);
}

console.log('\n===== 测试汇总 =====');
for (const [n, st, d] of rows) console.log(`${st === 'PASS' ? '✓' : '✗'} ${n.padEnd(28, ' ')} ${d}`);
console.log(failed ? `\n✗ ${failed} 个套件失败` : `\n✓ 全部 ${rows.length} 个套件通过`);
process.exit(failed ? 1 : 0);
