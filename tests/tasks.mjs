// R07—R10 · 研读任务集合回归（复审 F04 的直接反例）
// 运行: node tests/tasks.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_LIB = path.join(__dirname, '..', 'site', 'lib');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
}

// 载入 MXStore（浏览器全局式 IIFE）
const storeSrc = fs.readFileSync(path.join(SITE_LIB, 'mx-store.js'), 'utf8');
new Function('window', 'localStorage', storeSrc)(undefined, undefined);
const MXStore = globalThis.MXStore;

function fakeLS(init = {}, opts = {}) {
  const s = Object.assign({}, init);
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null; },
    setItem(k, v) {
      if (opts.failSet && opts.failSet(k)) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      s[k] = String(v);
    },
    removeItem(k) { delete s[k]; },
    _dump() { return s; },
  };
}

// 每个场景重新装载 MXTasks（模块内部仅有函数，靠注入的 store/ls 隔离）
function loadTasks(ls) {
  const src = fs.readFileSync(path.join(SITE_LIB, 'mx-tasks.js'), 'utf8');
  const win = { MXStore: MXStore.make(ls) };
  new Function('window', 'localStorage', src)(win, ls);
  return win.MXTasks;
}

console.log('MXTasks · 基本创建与复用');
{
  const ls = fakeLS({});
  const T = loadTasks(ls);
  const spec = { resultId: 'r1', cardId: 'mao', articleId: 'v1n07', paragraphId: 'pv1n07-012', prompt: '读这一段', personName: '毛泽东', themeTitle: '调查' };
  const a = T.ensure(spec);
  ok('首次 ensure 创建任务', a.ok && a.created === true && !!a.task.taskId, a);
  const b = T.ensure(spec);
  ok('同一目标再次 ensure 复用同一个 taskId（不产生副本）', b.ok && b.created === false && b.task.taskId === a.task.taskId, b.task && b.task.taskId);
  ok('mx_tasks 落库为数组且只有 1 条', Array.isArray(JSON.parse(ls._dump().mx_tasks)) && JSON.parse(ls._dump().mx_tasks).length === 1);
}

console.log('MXTasks · 复审反例：重进已完成任务不得重置状态');
{
  const ls = fakeLS({});
  const T = loadTasks(ls);
  const spec = { resultId: 'r1', cardId: 'mao', articleId: 'v1n07', paragraphId: 'pv1n07-012', prompt: '读这一段' };
  const t = T.ensure(spec).task;
  const c = T.complete(t.taskId, 'n123');
  ok('complete 写入 noteId 与 completed', c.ok && c.task.state === 'completed' && c.task.noteId === 'n123', c);
  // 模拟 quiz.html 的"再次点击阅读"：先 ensure 再设为活动
  const again = T.ensure(spec);
  ok('再次进入：状态仍为 completed', again.task.state === 'completed', again.task.state);
  ok('再次进入：noteId 未丢失', again.task.noteId === 'n123', again.task.noteId);
  ok('任务总数没有因为重进而增加', JSON.parse(ls._dump().mx_tasks).length === 1);
}

console.log('MXTasks · 切换卡片不覆盖历史');
{
  const ls = fakeLS({});
  const T = loadTasks(ls);
  const A = T.ensure({ resultId: 'r1', cardId: 'mao', articleId: 'v1n07', prompt: 'A' });
  T.complete(A.task.taskId, 'nA');
  const B = T.ensure({ resultId: 'r1', cardId: 'zhou', articleId: 'v4n59', prompt: 'B' });
  T.setActive(B.task.taskId);
  const all = T.all();
  ok('两张卡各自保留一条任务', all.list.length === 2, all.list.length);
  const a2 = T.get(A.task.taskId).task;
  ok('前一张卡的完成任务不受影响', a2.state === 'completed' && a2.noteId === 'nA', a2);
  ok('活动指针指向后一张卡', T.active().task.taskId === B.task.taskId);
}

console.log('MXTasks · 同篇文章的两张卡（党委会的工作方法）不串任务');
{
  const ls = fakeLS({});
  const T = loadTasks(ls);
  const zhou = T.ensure({ resultId: 'r1', cardId: 'zhou', articleId: 'v4n59', paragraphId: 'pv4n59-003', prompt: 'Z' });
  const liu = T.ensure({ resultId: 'r1', cardId: 'liu', articleId: 'v4n59', paragraphId: 'pv4n59-021', prompt: 'L' });
  ok('同篇不同卡是两条任务', zhou.task.taskId !== liu.task.taskId);
  const byPara = T.forArticle('v4n59', 'pv4n59-021');
  ok('按段落锚点能选到正确的卡', byPara.list.length === 1 && byPara.list[0].cardId === 'liu', byPara.list.map(x => x.cardId));
  T.setActive(zhou.task.taskId);
  const act = T.active().task;
  ok('活动任务按指针解析为周恩来卡', act.cardId === 'zhou', act.cardId);
}

console.log('MXTasks · 显式再练一次');
{
  const ls = fakeLS({});
  const T = loadTasks(ls);
  const t = T.ensure({ resultId: 'r1', cardId: 'mao', articleId: 'v1n07', prompt: 'A' }).task;
  T.complete(t.taskId, 'n1');
  const r = T.reopen(t.taskId);
  ok('reopen 生成新 taskId', r.ok && r.task.taskId !== t.taskId, r);
  ok('新任务 attemptNo=2 且状态 todo', r.task.attemptNo === 2 && r.task.state === 'todo', r.task);
  ok('旧记录仍然是 completed', T.get(t.taskId).task.state === 'completed');
  ok('活动指针切到新记录', T.active().task.taskId === r.task.taskId);
}

console.log('MXTasks · 旧数据迁移（mx_active_task 是完整任务对象）');
{
  const legacy = { resultId: 'old', cardId: 'mao', personName: '毛泽东', themeTitle: '调查',
    articleId: 'v1n07', paragraphId: 'pv1n07-012', prompt: '旧任务', state: 'completed', noteId: 'nOLD', startedAt: 1700000000000 };
  const ls = fakeLS({ mx_active_task: JSON.stringify(legacy) });
  const T = loadTasks(ls);
  const a = T.active();
  ok('迁移后仍能读到任务', a.ok && !!a.task, a);
  ok('noteId 未丢失', a.task && a.task.noteId === 'nOLD', a.task && a.task.noteId);
  ok('completed 状态未被打回 todo', a.task && a.task.state === 'completed', a.task && a.task.state);
  ok('mx_tasks 已写入迁移记录', Array.isArray(JSON.parse(ls._dump().mx_tasks)));
  ok('活动键变成指针（只剩 taskId）', !JSON.parse(ls._dump().mx_active_task).cardId);
}

console.log('MXTasks · 存储失败与损坏的如实处理');
{
  const ls = fakeLS({}, { failSet: (k) => k === 'mx_tasks' });
  const T = loadTasks(ls);
  const r = T.ensure({ resultId: 'r1', cardId: 'mao', articleId: 'v1n07', prompt: 'A' });
  ok('写不进去时返回 ok:false（不假装保存成功）', r.ok === false && !!r.error, r);
}
{
  const ls = fakeLS({ mx_tasks: '{broken' });
  const T = loadTasks(ls);
  const r = T.ensure({ resultId: 'r1', cardId: 'mao', articleId: 'v1n07', prompt: 'A' });
  ok('任务集合损坏时拒绝写入', r.ok === false && r.status === 'corrupt', r);
  ok('损坏的原始字节保持不变', ls._dump().mx_tasks === '{broken');
}
{
  const ls = fakeLS({});
  const T = loadTasks(ls);
  const t = T.ensure({ resultId: 'r1', cardId: 'mao', articleId: 'v1n07', prompt: 'A' }).task;
  ok('complete 不存在的任务返回 ok:false', T.complete('nope', 'x').ok === false);
  ok('touch 不存在的任务返回 ok:false', T.touch('nope', {}).ok === false);
  ok('setActive 只写指针', (T.setActive(t.taskId).ok) && Object.keys(JSON.parse(ls._dump().mx_active_task)).sort().join(',') === 'taskId,updatedAt');
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
