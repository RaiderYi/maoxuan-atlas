/* R27: 证据工作区 — 引文定位、按真实顺序分组、原文上下文
 *
 * 设计原则（对应复审 F07 / R27）:
 *   1) 不信任"编号相同即同一段"——引文一律按【原文文本回查】定位，定位结果带 match 状态。
 *   2) 不把不相邻的片段拼成一段——只有重叠或相隔 ≤1 行才合并成一个证据块。
 *   3) 定位不到就如实说明（unlocated），不退化成"猜一个段落"，也不丢弃引文。
 *   4) 正文服务不可用时明确报原因（key_missing / pack_missing …），不显示空白冒充成功。
 *
 * 纯逻辑部分不依赖 DOM，可在 node 里直接测（tests/evidence.mjs）。
 * 浏览器里挂到 window.MXEvidence；node 里挂到 globalThis.MXEvidence。
 */
(function (g) {
  'use strict';

  /* 空白与标点都不参与匹配：不同版本的标点差异不应导致定位失败 */
  var PUNCT_RE = /[\s\u3000\u00a0·?、，。；：！？…—～~,.;:!?"'()（）《》〈〉「」『』“”‘’\[\]【】\-—－_\/\\|·]/g;

  function normWs(s) {
    return String(s == null ? '' : s).replace(/[\s\u3000\u00a0]+/g, '');
  }
  function normLoose(s) {
    return String(s == null ? '' : s).replace(PUNCT_RE, '');
  }

  /* 正文按行切分；空行不参与定位（行号仍按去掉空行后的顺序计数，
     与 app.js 渲染段落 span 的规则一致：一行 = 一段） */
  function splitLines(text) {
    var raw = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      if (raw[i].trim() !== '') out.push(raw[i]);
    }
    return out;
  }

  function buildIndex(lines) {
    var parts = [], offsets = [], acc = 0;
    for (var i = 0; i < lines.length; i++) {
      var ln = normLoose(lines[i]);
      offsets.push(acc);
      parts.push(ln);
      acc += ln.length;
    }
    return { flat: parts.join(''), offsets: offsets, lens: parts.map(function (p) { return p.length; }) };
  }

  /* 把一条引文定位到行区间（1-based）。返回 null 表示原文里确实找不到。 */
  function locateIn(lines, quote) {
    if (!lines || !lines.length || !quote) return null;
    var q = normLoose(quote);
    if (q.length < 2) return null;
    var idx = buildIndex(lines);
    var at = idx.flat.indexOf(q);
    if (at < 0) return null;
    var end = at + q.length - 1;
    var from = -1, to = -1;
    for (var i = 0; i < lines.length; i++) {
      var start = idx.offsets[i];
      var stop = start + idx.lens[i] - 1;
      if (idx.lens[i] === 0) continue;
      if (at >= start && at <= stop) from = i;
      if (end >= start && at <= stop) to = i;
    }
    if (from < 0) from = to;
    if (to < 0) to = from;
    if (from < 0) return null;
    var exact = normWs(lines.slice(from, to + 1).join('')).indexOf(normWs(quote)) >= 0;
    return {
      zeroFrom: from, zeroTo: to,
      lineFrom: from + 1, lineTo: to + 1,
      match: exact ? 'exact' : 'loose'
    };
  }

  function articleIdOf(c) {
    if (!c) return '';
    if (c.articleId) return c.articleId;
    var m = /^p(v\d+n\d+)-/.exec(String(c.id || ''));
    return m ? m[1] : '';
  }

  /* 按文章分组、按真实行号排序，只有相邻（重叠或相隔 ≤1 行）才合成一个块 */
  function groupCitations(citations, linesByArticle) {
    var byArt = {}, order = [];
    (citations || []).forEach(function (c) {
      var aid = articleIdOf(c);
      if (!aid) return;
      if (!byArt[aid]) { byArt[aid] = { articleId: aid, title: c.articleTitle || null, items: [] }; order.push(aid); }
      byArt[aid].items.push({ id: c.id, quote: c.quote || '', loc: null, articleId: aid, articleTitle: c.articleTitle || null });
    });

    return order.map(function (aid) {
      var grp = byArt[aid];
      var lines = (linesByArticle && linesByArticle[aid]) || null;
      grp.located = !!lines;
      grp.items.forEach(function (it) { it.loc = lines ? locateIn(lines, it.quote) : null; });

      grp.items.sort(function (a, b) {
        var al = a.loc ? a.loc.zeroFrom : Infinity;
        var bl = b.loc ? b.loc.zeroFrom : Infinity;
        if (al !== bl) return al - bl;
        return String(a.id).localeCompare(String(b.id));
      });

      var blocks = [];
      grp.items.forEach(function (it) {
        var last = blocks.length ? blocks[blocks.length - 1] : null;
        if (it.loc && last && last.located && it.loc.zeroFrom <= last.zeroTo + 2) {
          last.items.push(it);
          if (it.loc.zeroTo > last.zeroTo) last.zeroTo = it.loc.zeroTo;
          if (it.loc.zeroFrom < last.zeroFrom) last.zeroFrom = it.loc.zeroFrom;
        } else {
          blocks.push({
            located: !!it.loc,
            zeroFrom: it.loc ? it.loc.zeroFrom : null,
            zeroTo: it.loc ? it.loc.zeroTo : null,
            items: [it]
          });
        }
      });
      blocks.forEach(function (b) {
        b.lineFrom = b.located ? b.zeroFrom + 1 : null;
        b.lineTo = b.located ? b.zeroTo + 1 : null;
        b.merged = b.items.length > 1;
        b.match = b.items.some(function (it) { return it.loc && it.loc.match === 'loose'; }) ? 'loose' : 'exact';
      });
      grp.blocks = blocks;
      grp.unlocated = grp.items.filter(function (it) { return !it.loc; });
      return grp;
    });
  }

  /* 原文上下文：目标行 ±pad 行，越界自动收窄；hit 标记本次命中的行 */
  function context(lines, zeroFrom, zeroTo, pad) {
    if (!lines || !lines.length) return [];
    var p = (pad == null ? 1 : pad);
    var a = Math.max(0, (zeroFrom == null ? 0 : zeroFrom) - p);
    var b = Math.min(lines.length - 1, (zeroTo == null ? zeroFrom : zeroTo) + p);
    var out = [];
    for (var i = a; i <= b; i++) {
      out.push({ n: i + 1, text: lines[i], hit: i >= (zeroFrom == null ? -1 : zeroFrom) && i <= (zeroTo == null ? zeroFrom : zeroTo) });
    }
    return out;
  }

  function segLabel(b) {
    if (!b || !b.located) return '未定位';
    return b.lineFrom === b.lineTo ? ('第 ' + b.lineFrom + ' 段') : ('第 ' + b.lineFrom + '–' + b.lineTo + ' 段');
  }

  var FAIL_TEXT = {
    key_missing: '正文服务未配置密钥，暂时无法读取原文',
    pack_missing: '正文内容包未随部署发布，暂时无法读取原文',
    text_decrypt_failed: '正文解密失败（密钥与内容包不匹配）',
    text_unavailable: '正文服务暂时不可用',
    bad_request: '请求的篇目无效'
  };
  function describeFailure(code, msg) {
    return FAIL_TEXT[code] || msg || '正文服务暂时不可用';
  }

  /* 浏览器端：带缓存与并发合并的取文 */
  function createTextLoader(fetchImpl) {
    var cache = {};
    var f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    return function load(id) {
      if (cache[id]) return cache[id];
      if (!f) return Promise.resolve({ ok: false, code: 'no_fetch', message: '当前环境不支持取文' });
      cache[id] = f('api/text?id=' + encodeURIComponent(id), { headers: { accept: 'text/plain, application/json' } })
        .then(function (r) {
          var ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
          if (r.ok && ct.indexOf('application/json') < 0) {
            return r.text().then(function (t) { return { ok: true, text: t, lines: splitLines(t) }; });
          }
          return r.json().then(function (j) {
            var e = (j && j.error) || {};
            return { ok: false, code: e.code || 'http_' + r.status, message: describeFailure(e.code, e.message) };
          }).catch(function () {
            return { ok: false, code: 'http_' + r.status, message: describeFailure('http_' + r.status) };
          });
        })
        .catch(function (e) {
          return { ok: false, code: 'network', message: '网络不可用，无法读取原文（' + e + '）' };
        });
      return cache[id];
    };
  }

  g.MXEvidence = {
    normWs: normWs,
    normLoose: normLoose,
    splitLines: splitLines,
    locateIn: locateIn,
    articleIdOf: articleIdOf,
    groupCitations: groupCitations,
    context: context,
    segLabel: segLabel,
    describeFailure: describeFailure,
    createTextLoader: createTextLoader
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
