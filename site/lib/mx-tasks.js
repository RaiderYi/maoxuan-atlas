/*! MXTasks — 研读任务的持久集合（R07—R10）
 *
 * 复审发现的问题（F04）：
 *   · quiz.html 的阅读链接每次直接覆盖 mx_active_task 并写入 state=reading，
 *     重新进入一个已完成的任务会把 state 打回 reading、丢掉 noteId；
 *   · 存储里只有"一个活动任务"，开始另一张卡就覆盖上一张的上下文；
 *   · 备份没有包含任务，换设备/清缓存后任务与笔记的对应关系消失。
 *
 * 本模块的规则：
 *   1. 任务按 taskId 存在 mx_tasks（数组）里，mx_active_task 只保存"当前指针"；
 *   2. 同一张卡的同一目标（cardId + articleId + paragraphId）只对应一个任务，
 *      再次进入已完成任务不会重置状态；想再练一次必须显式 reopen() 生成新记录；
 *   3. 所有写操作都返回 {ok}，失败由调用方如实提示，不假装保存成功；
 *   4. 旧数据（mx_active_task 是完整任务对象、没有 mx_tasks）会被读时迁移，不丢 noteId。
 */
(function (root) {
  'use strict';
  var TASKS_KEY = 'mx_tasks';
  var ACTIVE_KEY = 'mx_active_task';
  var SCHEMA = 'mx-tasks@1';

  function uid() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function make(store, ls) {
    var S = store, LS = ls;

    function readTasks() {
      var r = S.read(TASKS_KEY, 'array');
      if (r.status === 'ok') return { ok: true, list: r.value };
      if (r.status === 'missing') return { ok: true, list: [] };
      return { ok: false, status: r.status, error: r.error, raw: r.raw };
    }
    function writeTasks(list, opts) {
      var w = S.update(TASKS_KEY, 'array', function () { return list; });
      if (w.ok) return { ok: true, value: w.value };
      return { ok: false, status: w.status, error: w.error || 'storage unavailable' };
    }
    function readActiveRaw() {
      try {
        var raw = LS && LS.getItem(ACTIVE_KEY);
        if (!raw) return null;
        var o = JSON.parse(raw);
        return o && typeof o === 'object' ? o : null;
      } catch (e) { return null; }
    }
    function writeActive(o) {
      try {
        if (!LS) return { ok: false, error: 'storage unavailable' };
        if (o) LS.setItem(ACTIVE_KEY, JSON.stringify(o));
        else LS.removeItem(ACTIVE_KEY);
        return { ok: true };
      } catch (e) { return { ok: false, error: String((e && e.name) || e) }; }
    }

    function sameTask(t, spec) {
      if (!t) return false;
      if (spec.cardId && t.cardId) return t.cardId === spec.cardId;
      if (spec.resultId && t.resultId && spec.resultId === t.resultId) return true;
      return false;
    }

    /* 读时迁移：旧版把整个任务塞在 mx_active_task 里 */
    function migrate(r) {
      var list = r.list;
      var active = readActiveRaw();
      if (!active) return { list: list, active: null };
      if (!active.taskId) {
        var legacy = {
          taskId: uid(), schema: SCHEMA,
          resultId: active.resultId || null, cardId: active.cardId || null,
          personName: active.personName || '', themeTitle: active.themeTitle || '',
          articleId: active.articleId || null, paragraphId: active.paragraphId || null,
          prompt: active.prompt || '', state: active.state === 'completed' ? 'completed' : (active.state || 'todo'),
          noteId: active.noteId || null, attemptNo: 1,
          createdAt: active.startedAt || Date.now(), updatedAt: Date.now(),
          completedAt: active.completedAt || null, migratedFrom: 'mx_active_task@v1',
        };
        var hit = null;
        for (var i = 0; i < list.length; i++) if (sameTask(list[i], legacy)) hit = list[i];
        if (!hit) { list = list.concat([legacy]); hit = legacy; }
        var w = writeTasks(list);
        var wa = writeActive({ taskId: hit.taskId, updatedAt: Date.now() });
        return { list: list, active: hit, migrated: true, writeOk: w.ok && wa.ok, writeError: w.ok ? wa.error : w.error };
      }
      var found = null;
      for (var j = 0; j < list.length; j++) if (list[j].taskId === active.taskId) found = list[j];
      return { list: list, active: found, pointerOnly: true };
    }

    function all() {
      var r = readTasks();
      if (!r.ok) return r;
      var m = migrate(r);
      return { ok: true, list: m.list, active: m.active || null };
    }

    function get(taskId) {
      var r = all();
      if (!r.ok) return r;
      for (var i = 0; i < r.list.length; i++) if (r.list[i].taskId === taskId) return { ok: true, task: r.list[i] };
      return { ok: true, task: null };
    }

    /** 找到该目标对应的任务（不重置已完成状态）；没有则创建。 */
    function ensure(spec) {
      spec = spec || {};
      var r = all();
      if (!r.ok) return { ok: false, status: r.status, error: r.error };
      var list = r.list, found = null;
      for (var i = list.length - 1; i >= 0; i--) {
        var t = list[i];
        if (!sameTask(t, spec)) continue;
        if (spec.cardId && t.cardId !== spec.cardId) continue;
        if (spec.articleId && t.articleId && t.articleId !== spec.articleId) continue;
        if (spec.paragraphId && t.paragraphId && spec.paragraphId !== t.paragraphId) continue;
        found = t; break;
      }
      if (found) return { ok: true, task: found, created: false };
      var now = Date.now();
      var task = {
        taskId: uid(), schema: SCHEMA,
        resultId: spec.resultId || null, cardId: spec.cardId || null,
        personName: spec.personName || '', themeTitle: spec.themeTitle || '',
        articleId: spec.articleId || null, paragraphId: spec.paragraphId || null,
        prompt: spec.prompt || '', state: 'todo', noteId: null, attemptNo: 1,
        createdAt: now, updatedAt: now, completedAt: null,
      };
      list = list.concat([task]);
      var w = writeTasks(list);
      if (!w.ok) return { ok: false, status: w.status, error: w.error };
      return { ok: true, task: task, created: true };
    }

    /** 显式再练一次：保留旧记录，新建一条 attemptNo+1 的任务并设为活动。 */
    function reopen(taskId) {
      var r = all();
      if (!r.ok) return { ok: false, status: r.status, error: r.error };
      var list = r.list, old = null;
      for (var i = 0; i < list.length; i++) if (list[i].taskId === taskId) { old = list[i]; break; }
      if (!old) return { ok: false, error: 'task not found' };
      var now = Date.now();
      var fresh = {
        taskId: uid(), schema: SCHEMA,
        resultId: old.resultId, cardId: old.cardId, personName: old.personName, themeTitle: old.themeTitle,
        articleId: old.articleId, paragraphId: old.paragraphId, prompt: old.prompt,
        state: 'todo', noteId: null, attemptNo: (old.attemptNo || 1) + 1,
        createdAt: now, updatedAt: now, completedAt: null, reopens: old.taskId,
      };
      list = list.concat([fresh]);
      var w = writeTasks(list);
      if (!w.ok) return { ok: false, status: w.status, error: w.error };
      var wa = writeActive({ taskId: fresh.taskId, updatedAt: now });
      return { ok: wa.ok, task: fresh, activeWrite: wa.ok, error: wa.error };
    }

    function touch(taskId, patch) {
      var r = all();
      if (!r.ok) return { ok: false, status: r.status, error: r.error };
      var list = r.list, idx = -1;
      for (var i = 0; i < list.length; i++) if (list[i].taskId === taskId) idx = i;
      if (idx < 0) return { ok: false, error: 'task not found' };
      var next = {};
      for (var k in list[idx]) if (Object.prototype.hasOwnProperty.call(list[idx], k)) next[k] = list[idx][k];
      for (var k2 in patch) if (Object.prototype.hasOwnProperty.call(patch, k2)) next[k2] = patch[k2];
      next.updatedAt = Date.now();
      list[idx] = next;
      var w = writeTasks(list);
      return w.ok ? { ok: true, task: next } : { ok: false, status: w.status, error: w.error };
    }

    /** 只有笔记真正落库后才调用；返回写入结果，调用方必须检查。 */
    function complete(taskId, noteId) {
      return touch(taskId, { state: 'completed', noteId: noteId || null, completedAt: Date.now() });
    }

    function setActive(taskId) {
      return writeActive({ taskId: taskId, updatedAt: Date.now() });
    }
    function active() {
      var r = all();
      if (!r.ok) return r;
      return { ok: true, task: r.active || null, list: r.list };
    }
    function clearActive() { return writeActive(null); }

    /** 该文章下的任务（可按段落锚点过滤），最近更新的在前 */
    function forArticle(articleId, paragraphId) {
      var r = all();
      if (!r.ok) return r;
      var list = r.list.filter(function (t) {
        if (t.articleId !== articleId) return false;
        if (paragraphId && t.paragraphId && t.paragraphId !== paragraphId) return false;
        return true;
      }).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      return { ok: true, list: list };
    }

    return {
      schema: SCHEMA, keys: { tasks: TASKS_KEY, active: ACTIVE_KEY },
      all: all, get: get, ensure: ensure, reopen: reopen, touch: touch, complete: complete,
      setActive: setActive, active: active, clearActive: clearActive, forArticle: forArticle,
      _readActiveRaw: readActiveRaw,
    };
  }

  var impl = make(root.MXStore, typeof localStorage !== 'undefined' ? localStorage : null);
  impl.make = make;                    /* 供 Node 沙箱注入故障后端 */
  root.MXTasks = impl;
})(typeof window !== 'undefined' ? window : globalThis);
