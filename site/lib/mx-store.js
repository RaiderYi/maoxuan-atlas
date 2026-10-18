/*! MXStore — 统一本地存储读写模块 (R1.1 A01/A02)
 * 目的：正文页 / 专题页 / 研究室 / 书房 共用同一套读写语义，消除"某入口能识别损坏、另一入口照样覆盖"的分叉。
 *
 * 语义：
 *   读取 → { status: 'ok' | 'missing' | 'corrupt' | 'unavailable', value, raw, error }
 *     · corrupt    = 键存在但不是可解析的预期结构（绝不当作空库）
 *     · unavailable= localStorage 本身不可用（隐私模式/被禁用）
 *   写入 → { ok, error }（调用方必须检查；失败不得假装成功）
 *
 *   事务：deleteWithTrash / restoreFromTrash 先写副本、确认成功后才改主集合；
 *         任一步失败则回滚已写入的部分，并返回明确错误。
 *
 * 兼容：把 localStorage 作为可注入后端，便于 Node 沙箱注入故障做回归断言。
 */
(function (root) {
  'use strict';

  function make(backend) {
    var LS = backend;

    function rawGet(key) {
      try {
        if (!LS) return { ok: false, unavailable: true, error: 'storage unavailable' };
        return { ok: true, value: LS.getItem(key) };
      } catch (e) {
        return { ok: false, unavailable: true, error: String(e && e.message || e) };
      }
    }
    function rawSet(key, str) {
      try {
        if (!LS) return { ok: false, error: 'storage unavailable' };
        LS.setItem(key, str);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e && e.name || e) };
      }
    }
    function rawRemove(key) {
      try {
        if (!LS) return { ok: false, error: 'storage unavailable' };
        LS.removeItem(key);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e && e.name || e) };
      }
    }

    /** kind: 'array' | 'object' | 'any' */
    function read(key, kind) {
      var g = rawGet(key);
      if (!g.ok) return { status: 'unavailable', value: null, error: g.error };
      if (g.value === null || g.value === undefined) return { status: 'missing', value: null, raw: null };
      var parsed;
      try { parsed = JSON.parse(g.value); }
      catch (e) { return { status: 'corrupt', value: null, raw: g.value, error: 'JSON 解析失败: ' + (e && e.message) }; }
      kind = kind || 'any';
      if (kind === 'array' && !Array.isArray(parsed)) {
        return { status: 'corrupt', value: null, raw: g.value, error: '结构不符：期望数组' };
      }
      if (kind === 'object' && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) {
        return { status: 'corrupt', value: null, raw: g.value, error: '结构不符：期望对象' };
      }
      return { status: 'ok', value: parsed, raw: g.value };
    }

    function write(key, value) {
      var str;
      try { str = JSON.stringify(value); }
      catch (e) { return { ok: false, error: '无法序列化: ' + (e && e.message) }; }
      return rawSet(key, str);
    }

    function remove(key) { return rawRemove(key); }

    /** 读-改-写：损坏时中止（绝不覆盖），写入失败原值保持不变 */
    function update(key, kind, mutator) {
      var cur = read(key, kind);
      if (cur.status === 'corrupt') return { ok: false, status: 'corrupt', error: '本地数据损坏，已中止写入以保留原值', raw: cur.raw };
      if (cur.status === 'unavailable') return { ok: false, status: 'unavailable', error: cur.error };
      var base = cur.value;
      if (base === null) base = (kind === 'array' ? [] : {});
      var next;
      try { next = mutator(base); }
      catch (e) { return { ok: false, status: 'mutator_error', error: String(e && e.message || e) }; }
      if (next === undefined) next = base;
      var w = write(key, next);
      if (!w.ok) return { ok: false, status: 'write_failed', error: w.error };
      return { ok: true, status: 'ok', value: next };
    }

    function health(keys) {
      var out = [];
      (keys || []).forEach(function (k) {
        var r = read(k, 'any');
        if (r.status === 'corrupt' || r.status === 'unavailable') {
          out.push({ key: k, status: r.status, error: r.error || '', raw: r.raw || null });
        }
      });
      return out;
    }

    /** A02: 删除必须先成功写入可恢复副本，撤销时先确认目标写入成功再清副本 */
    function deleteWithTrash(opts) {
      var collKey = opts.collKey, kind = opts.kind, id = opts.id, trashKey = opts.trashKey || 'mx_trash';
      var coll = read(collKey, 'array');
      if (coll.status === 'corrupt') return { ok: false, error: '主集合损坏，已中止删除以保留原值', code: 'corrupt' };
      if (coll.status === 'unavailable') return { ok: false, error: coll.error, code: 'unavailable' };
      var list = coll.value || [];
      var target = null, rest = [];
      list.forEach(function (x) {
        if (x && x.id === id) { if (!target) target = x; else rest.push(x); } else rest.push(x);
      });
      if (!target) return { ok: false, error: '未找到该条目', code: 'not_found' };

      var tr = read(trashKey, 'array');
      if (tr.status === 'corrupt') return { ok: false, error: '回收站损坏，已中止删除（原条目保留）', code: 'trash_corrupt' };
      if (tr.status === 'unavailable') return { ok: false, error: tr.error, code: 'unavailable' };
      var prevTrash = tr.value || [];
      var newTrash = [{ kind: kind, id: id, payload: target, at: Date.now() }].concat(prevTrash).slice(0, 200);

      var w1 = write(trashKey, newTrash);
      if (!w1.ok) return { ok: false, error: '回收站写入失败，未删除原条目: ' + w1.error, code: 'trash_write_failed' };

      var w2 = write(collKey, rest);
      if (!w2.ok) {
        var rb = write(trashKey, prevTrash);       // 回滚副本，保持"要么都成、要么都不动"
        return { ok: false, error: '主集合写入失败，已回滚回收站: ' + w2.error, code: 'coll_write_failed', rollback: rb.ok };
      }
      return { ok: true, record: target };
    }

    function restoreFromTrash(opts) {
      var trashKey = opts.trashKey || 'mx_trash';
      var idx = opts.index;
      var tr = read(trashKey, 'array');
      if (tr.status === 'corrupt') return { ok: false, error: '回收站损坏，无法恢复', code: 'trash_corrupt' };
      if (tr.status === 'unavailable') return { ok: false, error: tr.error, code: 'unavailable' };
      var list = tr.value || [];
      if (idx == null) {
        idx = -1;
        for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === opts.id) { idx = i; break; }
      }
      var rec = list[idx];
      if (!rec) return { ok: false, error: '回收站中没有该条目', code: 'not_found' };
      var collKey = opts.collKey || (rec.kind === 'card' ? 'mx_research_cards'
        : (rec.kind === 'persona' ? 'mx_persona_cards' : (rec.kind === 'quiz' ? 'mx_quiz_results' : 'mx_notes')));
      var coll = read(collKey, 'array');
      if (coll.status === 'corrupt') return { ok: false, error: '主集合损坏，已中止恢复以保留原值', code: 'corrupt' };
      if (coll.status === 'unavailable') return { ok: false, error: coll.error, code: 'unavailable' };
      var cur = coll.value || [];
      var exists = cur.some(function (x) { return x && x.id === rec.id; });
      var target = exists ? cur : cur.concat([rec.payload]);

      var w1 = write(collKey, target);
      if (!w1.ok) return { ok: false, error: '恢复写入失败，回收站条目保留: ' + w1.error, code: 'coll_write_failed' };

      var newTrash = list.slice(0, idx).concat(list.slice(idx + 1));
      var w2 = write(trashKey, newTrash);
      if (!w2.ok) {
        var rb = write(collKey, cur);              // 回滚主集合，避免"回收站还留着 + 主集合也有"
        return { ok: false, error: '回收站清理失败，已回滚: ' + w2.error, code: 'trash_write_failed', rollback: rb.ok };
      }
      return { ok: true, record: rec };
    }

    /** 全量快照（迁移/导入前），写入失败即中止 */
    function snapshot(keys, key) {
      var data = {}, bad = [];
      (keys || []).forEach(function (k) {
        var g = rawGet(k);
        if (!g.ok) { bad.push({ key: k, error: g.error }); return; }
        if (g.value !== null) data[k] = g.value;
      });
      if (bad.length) return { ok: false, error: '快照读取失败，未写入备份', bad: bad };
      var w = rawSet(key, JSON.stringify({ schema: 'mx-snapshot@1', at: Date.now(), data: data }));
      return w.ok ? { ok: true, count: Object.keys(data).length } : { ok: false, error: w.error };
    }

    return {
      read: read, write: write, remove: remove, update: update, health: health,
      deleteWithTrash: deleteWithTrash, restoreFromTrash: restoreFromTrash, snapshot: snapshot,
      _raw: { get: rawGet, set: rawSet, remove: rawRemove },
    };
  }

  var impl = make(typeof localStorage !== 'undefined' ? localStorage : null);
  impl.make = make;                 /* 供 Node 沙箱注入故障后端 */
  root.MXStore = impl;
})(typeof window !== 'undefined' ? window : globalThis);
