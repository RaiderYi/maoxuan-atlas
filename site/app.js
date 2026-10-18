/* MaoXuan Viz - app.js v4: hash router + mobile tabbar + reader suite + lazy graph + tiered search (ASCII only) */
(function(){
"use strict";

/* ---------- A05: HTML escape helper (all dynamic text goes through this) ---------- */
function esc(s){
  return String(s==null?"":s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function safeDecode(s){
  try{ return decodeURIComponent(s); }catch(e){ return s; }
}

/* ===== theme (night mode) ===== */
var themeDark = false;
function applyTheme(dark, save){
  themeDark = dark;
  var root = document.documentElement;
  if(dark) root.classList.add("dark"); else root.classList.remove("dark");
  var m = document.getElementById("metaTheme");
  if(m) m.setAttribute("content", dark ? "#1b1916" : "#f5efe0");
  var b = document.getElementById("themeBtn");
  if(b) b.textContent = dark ? "\u2600" : "\u263E";
  if(save) try{ localStorage.setItem("mx_theme", dark ? "dark" : "light"); }catch(e){}
  updateGraphTheme();
}
(function initTheme(){
  var saved = null;
  try{ saved = localStorage.getItem("mx_theme"); }catch(e){}
  var prefers = false;
  try{ prefers = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches; }catch(e){}
  applyTheme(saved ? saved === "dark" : prefers, false);
})();
function toggleTheme(){ applyTheme(!themeDark, true); }
document.addEventListener("keydown", function(e){
  if((e.key === "d" || e.key === "D") && !typingInField() && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey){
    toggleTheme();
  }
});

function updateGraphTheme(){
  if(typeof graphChartRef !== "undefined" && graphChartRef){
    try{
      graphChartRef.setOption({series:[{label:{color:themeDark ? "#b3a689" : "#5a4f45"}}]});
    }catch(e){}
  }
}
var graphChartRef = null;

var ERAS = [
  {name:"大革命时期", from:1925, to:1927, color:"#8a6d3b"},
  {name:"土地革命战争时期", from:1927, to:1937, color:"#a8842c"},
  {name:"抗日战争时期", from:1937, to:1945, color:"#b03a2e"},
  {name:"解放战争时期", from:1945, to:1949, color:"#8e2f26"},
  {name:"社会主义革命和建设时期", from:1949, to:1958, color:"#6b2b23"}
];
var VOLCOLOR = ["#b03a2e","#c08457","#a8842c","#7d6a3f","#5d4a33"];
var VOLNAME = ["卷一","卷二","卷三","卷四","卷五"];

/* Chinese place-name labels: [name, lat, lng, level]  level 0=革命圣地(朱砂), 1=大城, 2=中, 3=小 */
var CN_LABELS = [
 ["北京",39.90,116.40,1],["上海",31.23,121.47,1],["天津",39.12,117.10,2],["重庆",29.56,106.55,1],
 ["广州",23.13,113.26,1],["武汉",30.59,114.31,1],["南京",32.06,118.80,1],["西安",34.34,108.94,1],
 ["沈阳",41.80,123.43,1],["哈尔滨",45.80,126.53,2],["成都",30.57,104.07,1],["长沙",28.23,112.94,1],
 ["南昌",28.68,115.86,1],["杭州",30.27,120.16,2],["福州",26.07,119.30,2],["合肥",31.82,117.23,2],
 ["郑州",34.75,113.63,2],["济南",36.65,117.00,2],["太原",37.87,112.55,2],["兰州",36.06,103.83,2],
 ["贵阳",26.65,106.63,2],["昆明",25.04,102.71,2],["南宁",22.82,108.37,3],["乌鲁木齐",43.83,87.62,2],
 ["拉萨",29.65,91.14,2],["呼和浩特",40.84,111.75,2],["银川",38.49,106.23,3],["西宁",36.62,101.78,3],
 ["海口",20.04,110.20,3],["石家庄",38.04,114.41,3],["长春",43.88,125.32,3],
 ["延安",36.60,109.49,0],["西柏坡",38.35,113.85,0],["井冈山",26.75,114.28,0],
 ["瑞金",25.88,116.03,0],["遵义",27.70,106.93,1],["古田",25.22,116.82,1],
 ["瓦窑堡",37.14,109.67,2],["志丹·保安",36.82,108.77,3],["韶山",27.91,112.53,3]
];
/* 足迹路线: [name, year(起), lat, lng] */
var ROUTE = [
 ["广州",1925.0,23.13,113.26],
 ["长沙",1927.0,28.23,112.94],
 ["武汉",1927.4,30.59,114.31],
 ["井冈山",1928.0,26.75,114.28],
 ["瑞金",1931.0,25.88,116.03],
 ["瓦窑堡",1935.9,37.14,109.67],
 ["保安",1936.6,36.82,108.77],
 ["延安",1937.0,36.60,109.49],
 ["西柏坡",1948.4,38.35,113.95],
 ["北平",1949.6,39.90,116.40]
];

var state = {view:"map", eraFilter:null, selPlace:null, curArt:null, tlFit:false, histYear:null, tlYear:null};
var $ = function(s){return document.querySelector(s)};

/* ---------- toast ---------- */
var toastTimer = null;
function toast(msg){
  var t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("on");
  if(toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove("on"); }, 1800);
}

/* ---------- hash router ---------- */
/* routes: #/view/map #/art/v1n01 #/year/1949 #/search/xx #/place/广州 */
var lastRoute = "__none__";
function setHash(h){
  if(location.hash !== h){
    history.pushState(null, "", h);
    applyRoute();
  }
}
function routeFromHash(){
  var h = location.hash.replace(/^#\/?/, "");
  if(!h) return {v:"home"};
  var p = h.split("/");
  if(p[0]==="art" && p[1]) return {v:"art", id:p[1], para: p[2]||null};
  if(p[0]==="year" && p[1]) return {v:"year", y:parseInt(p[1])};
  if(p[0]==="search" && p[1]) return {v:"search", q:safeDecode(p[1])};
  if(p[0]==="place" && p[1]) return {v:"place", p:safeDecode(p[1])};
  if(p[0]==="view" && p[1]) return {v:p[1]};
  return {v:"home"};
}
function applyRoute(){
  var h = location.hash || "#";
  if(h === lastRoute) return;
  lastRoute = h;
  var r = routeFromHash();
  if(r.v==="art"){ openArticle(r.id, true, r.para); return; }
  if(r.v==="year"){ show("tl"); selectYear(r.y); return; }
  if(r.v==="search"){ document.getElementById("q").value = r.q; doSearch(r.q); return; }
  if(r.v==="place"){ show("map"); selectPlace(r.p); return; }
  show(r.v==="map"||r.v==="tl"||r.v==="graph"||r.v==="stats"||r.v==="read"||r.v==="cats"||r.v==="home"||r.v==="topic"||r.v==="study" ? r.v : "home");
  if(r.v==="map"||!r.v) document.title = "毛选时空研读";
}
window.addEventListener("popstate", applyRoute);
window.addEventListener("hashchange", applyRoute);

function renderCatalog(){
  var v = document.getElementById("view-cats");
  var q = (document.getElementById("catFilter")&&document.getElementById("catFilter").value.trim())||"";
  var vol = state.catVol || 0;
  var list = ARTS.filter(function(a){
    if(vol && a.vol!==vol) return false;
    if(q && a.title.indexOf(q)<0) return false;
    return true;
  });
  var groups = {};
  list.forEach(function(a){ (groups[a.vol] = groups[a.vol]||[]).push(a); });
  var h = "<div class='catWrap'><h2 class='catTitle'>全站目录 <span class='catCnt'>共 "+list.length+" 篇"+(vol?" · 仅卷"+["一","二","三","四","五"][vol-1]:"")+"</span></h2>";
  h += "<div class='catBar'><input id='catFilter' placeholder='检索标题…' value='"+esc(q)+"'>";
  h += "<button data-vol='0' class='"+(vol===0?"on":"")+"'>全部</button>";
  for(var i=1;i<=5;i++) h += "<button data-vol='"+i+"' class='"+(vol===i?"on":"")+"'>卷"+["一","二","三","四","五"][i-1]+"</button>";
  h += "</div>";
  if(!list.length){
    h += "<div class='hint'>没有匹配「"+esc(q)+"」的篇目。</div>";
  }else{
    Object.keys(groups).sort(function(a,b){return a-b;}).forEach(function(volN){
      var arr = groups[volN];
      h += "<div class='catVol'><h3>第"+["一","二","三","四","五"][volN-1]+"卷 <span>"+arr.length+" 篇</span></h3><ul>";
      arr.forEach(function(a){
        h += "<li data-id='"+esc(a.id)+"'>"+(getBookmark(a.id)?"<i class='bm'>★</i>":"")+
          "<span class='ct'>"+esc(a.title)+"</span>"+
          "<span class='cd'>"+esc(a.dateRaw.replace(/[（）()]/g,""))+"</span></li>";
      });
      h += "</ul></div>";
    });
  }
  h += "<div class='catNote'>共收录 217 篇 · 数据为本站语料统计 · 收藏标记仅保存在当前浏览器</div></div>";
  v.innerHTML = h;
  v.querySelectorAll("li[data-id]").forEach(function(li){
    li.addEventListener("click", function(){
      setOrigin({ type:"cats" });
      setHash("#/art/"+li.getAttribute("data-id"));
    });
  });
  v.querySelectorAll(".catBar button[data-vol]").forEach(function(b){
    b.addEventListener("click", function(){
      state.catVol = parseInt(b.getAttribute("data-vol"),10)||0;
      renderCatalog();
    });
  });
  var fi = v.querySelector("#catFilter");
  if(fi){
    fi.addEventListener("input", function(){ renderCatalog(); fi.focus(); });
  }
  track("page_view", {pageType:"catalog"});
}
/* ---------- P04: 专题（配置化四步导读 · 进度分开记录 · 末步成果任务） ---------- */
var TOPIC_CFG = null;
var TOPIC_CFG_URL = "data/topic-jgs.json";
var PROG_KEY = "mx_topic_progress";
var CONCL_KEY = "mx_topic_conclusions";

function loadProg(){
  try{ var x = JSON.parse(localStorage.getItem(PROG_KEY) || "{}"); return (x && typeof x === "object") ? x : {}; }
  catch(e){ return {}; }
}
function saveProg(p){
  try{ localStorage.setItem(PROG_KEY, JSON.stringify(p)); return true; }
  catch(e){ toast("进度保存失败：本地存储不可用"); return false; }
}
function topicProg(tid){
  var p = loadProg()[tid] || {};
  if(!p.steps) p.steps = {};
  return p;
}
/* P04.3: "打开过"与"完成"分开记录，从不按阅读行为推断完成 */
function stepState(tid, stepId){
  var st = (topicProg(tid).steps || {})[stepId] || {};
  if(st.doneAt) return "done";
  if(st.openedAt) return "opened";
  return "todo";
}
function setStepOpen(tid, stepId){
  var all = loadProg(); var t = all[tid] || { steps:{} }; if(!t.steps) t.steps = {};
  var st = t.steps[stepId] || {};
  if(!st.openedAt) st.openedAt = Date.now();
  t.steps[stepId] = st; all[tid] = t; saveProg(all);
}
function setStepDone(tid, stepId, done){
  var all = loadProg(); var t = all[tid] || { steps:{} }; if(!t.steps) t.steps = {};
  var st = t.steps[stepId] || {};
  if(done){ st.doneAt = Date.now(); }
  else { delete st.doneAt; if(!st.openedAt) st.openedAt = Date.now(); }
  t.steps[stepId] = st; all[tid] = t; saveProg(all);
}
function loadConcl(){
  try{ var x = JSON.parse(localStorage.getItem(CONCL_KEY) || "{}"); return (x && typeof x === "object") ? x : {}; }
  catch(e){ return {}; }
}
function saveConcl(o){
  try{ localStorage.setItem(CONCL_KEY, JSON.stringify(o)); return true; }
  catch(e){ toast("结论保存失败：本地存储不可用"); return false; }
}
function citationsForTopic(cfg){
  var ids = (cfg.corpus && cfg.corpus.articles) || [];
  return loadNotes().filter(function(n){ return ids.indexOf(n.articleId) >= 0 && n.quote; });
}
function topicStatus(cfg){
  var tid = cfg.topicId, steps = cfg.steps || [];
  var done = steps.filter(function(s){ return stepState(tid, s.stepId) === "done"; }).length;
  var concl = loadConcl()[tid];
  var next = steps.filter(function(s){ return stepState(tid, s.stepId) !== "done"; })[0] || null;
  return { tid: tid, total: steps.length, done: done, hasConclusion: !!concl,
           complete: done === steps.length && !!concl, nextStep: next };
}
function loadTopicCfg(cb){
  if(TOPIC_CFG){ if(cb) cb(TOPIC_CFG); return; }
  fetch(TOPIC_CFG_URL).then(function(r){ return r.json(); }).then(function(j){
    if(!j || !j.steps || !j.steps.length) throw new Error("empty");
    TOPIC_CFG = j;
    if(cb) cb(j);
    if(state.view === "topic") renderTopic();
    if(state.view === "home") renderHome();
  }).catch(function(){
    if(cb) cb(null);
    var v = document.getElementById("view-topic");
    if(v && state.view === "topic"){
      v.innerHTML = "<div class='statePanel'><h2>专题数据暂时无法载入</h2>" +
        "<p>导读配置（data/topic-jgs.json）没有取到，原文阅读不受影响。</p>" +
        "<div class='acts'><a href='#/view/cats'>先浏览全部篇目</a>" +
        "<button class='ghost' id='tpRetry'>重试</button></div></div>";
      var rb = document.getElementById("tpRetry");
      if(rb) rb.addEventListener("click", function(){ loadTopicCfg(function(){ renderTopic(); }); });
    }
  });
}
var STEP_BADGE = { todo: "未开始", opened: "已打开 · 未标完成", done: "已完成" };

function topicHtml(cfg){
  var st = topicStatus(cfg);
  var pct = Math.round(st.done / Math.max(1, st.total) * 100);
  var h = "<div class='topicWrap'>";
  h += "<div class='topicHero'><h2>" + esc(cfg.title) + "<span class='badge'>首版专题 · v" + esc(cfg.version || "1") + "</span></h2>";
  h += "<p class='q'>核心问题：" + esc(cfg.question) + "</p>";
  var labels = (cfg.corpus && cfg.corpus.articles) || [];
  h += "<p class='meta'>" + esc(cfg.summary || "") + "<br>" +
       labels.map(function(id){ return esc((cfg.corpus.labels && cfg.corpus.labels[id]) || id); }).join("　·　") +
       "<br>" + esc((cfg.corpus && cfg.corpus.note) || "") + "</p>";
  h += "<div class='topicProg'><div class='tpBar'><span style='width:" + pct + "%'></span></div>" +
       "<div class='tpTxt'>已完成 " + st.done + "/" + st.total + " 步 · " + (st.hasConclusion ? "已写结论" : "结论未保存") +
       (st.complete ? " · <b>专题已完成</b>" : (st.nextStep ? " · 下一步：" + esc(st.nextStep.title) : "")) + "</div></div>";
  if(!st.complete && st.nextStep){
    h += "<div class='topicActs'><button class='tpGo' data-jump='" + esc(st.nextStep.stepId) + "'>继续第 " +
         st.nextStep.seq + " 步 · " + esc(st.nextStep.title) + "</button></div>";
  }
  h += "</div>";

  (cfg.steps || []).forEach(function(s){
    var ss = stepState(cfg.topicId, s.stepId);
    h += "<div class='stepItem' id='step-" + esc(s.stepId) + "' data-state='" + ss + "'>";
    h += "<div class='stRow'><span class='st'>第 " + s.seq + " 步</span>" +
         "<span class='stBadge " + ss + "'>" + STEP_BADGE[ss] + "</span></div>";
    h += "<div class='tt'>" + esc(s.title) + "</div>";
    if(s.intro) h += "<div class='ds'>" + esc(s.intro) + "</div>";
    if(s.quote && s.quote.text){
      h += "<blockquote class='tpQuote'><p>" + esc(s.quote.text) + "</p>" +
           "<cite><a href='#/art/" + esc(s.quote.articleId) + "/" + esc(s.quote.fromId) + "' data-step='" + esc(s.stepId) + "'>" +
           "定位到原文 · " + esc(s.quote.fromId) + "</a></cite></blockquote>";
    }
    if(s.questions && s.questions.length){
      h += "<div class='tpQs'><div class='tpQh'>读的时候想这两件事</div><ul>" +
           s.questions.map(function(q){ return "<li>" + esc(q) + "</li>"; }).join("") + "</ul></div>";
    }
    if(s.reads && s.reads.length){
      h += "<div class='tpReads'>";
      s.reads.forEach(function(r){
        var a = ARTS.filter(function(x){ return x.id === r.articleId; })[0];
        var label = r.label || (a ? a.title : r.articleId);
        h += "<a class='go' href='#/art/" + esc(r.articleId) + (r.paragraphId ? "/" + esc(r.paragraphId) : "") +
             "' data-step='" + esc(s.stepId) + "'>读原文 · " + esc(label) + " →</a>";
      });
      h += "</div>";
    }
    if(s.requirement) h += "<div class='tpReq'>要求：" + esc(s.requirement) + "</div>";
    if(s.task && s.task.type === "conclusion"){
      var concl = loadConcl()[cfg.topicId] || {};
      var cits = citationsForTopic(cfg);
      h += "<div class='tpTask'><div class='tpTh'>成果任务 · 写下你的结论</div>";
      h += "<textarea id='tpConcl' rows='6' placeholder='用你自己的话回答核心问题（不少于 " + (s.task.minChars || 80) + " 字）…'>" +
           esc(concl.text || "") + "</textarea>";
      h += "<div class='tpCit'><div class='tpCh'>自动附加的依据（来自你的摘录，共 " + cits.length + " 条）</div>";
      if(cits.length){
        h += "<ul>" + cits.slice(0, 6).map(function(n){
          var src = n.source || {};
          var dt = src.dateRaw ? "（" + String(src.dateRaw).replace(/[（）()]/g, "") + "）" : "";
          return "<li><b>" + esc(n.paraId || "") + "</b> <span class='q'>" + esc((n.quote || "").slice(0, 60)) + "</span>" +
                 "<i>" + esc(src.title || "") + esc(dt) + "</i></li>";
        }).join("") + "</ul>" + (cits.length > 6 ? "<div class='tpMore'>另有 " + (cits.length - 6) + " 条未展开</div>" : "");
      } else {
        h += "<div class='tpMissing'>还没有摘录。回上面的步骤，在原文里选中一段文字即可摘录；没有依据的结论不会被当成完成。</div>";
      }
      h += "</div><div class='tpActs2'><button id='tpSave'>保存结论</button>" +
           "<span id='tpMsg' class='tpMsg'></span></div>";
      if(concl.text){
        h += "<div class='tpSaved'>上次保存：" + esc(new Date(concl.updatedAt || concl.createdAt).toLocaleString()) +
             (concl.pendingSteps && concl.pendingSteps.length ? " · 当时还有 " + concl.pendingSteps.length + " 步未完成" : "") + "</div>";
      }
      h += "</div>";
    }
    h += "<div class='tpStepActs'>" + (ss === "done"
      ? "<button class='tpUndo' data-undone='" + esc(s.stepId) + "'>撤销完成</button>"
      : "<button class='tpDone' data-done='" + esc(s.stepId) + "'>我读完了本步</button>") + "</div>";
    h += "</div>";
  });
  h += "<div class='homeNote'>步骤与引文来自两篇原文；比对与结论由你自己完成，本站不提供未经审校的背景补充，也不要求照抄标准答案。进度与结论只保存在这台设备。</div>";
  h += "</div>";
  return h;
}

function bindTopic(v, cfg){
  v.querySelectorAll("a[data-step]").forEach(function(a){
    a.addEventListener("click", function(){
      var sid = a.getAttribute("data-step");
      setStepOpen(cfg.topicId, sid);
      track("topic_read_open", { topicId: cfg.topicId, stepId: sid });
      setOrigin({ type: "topic" });
    });
  });
  v.querySelectorAll("[data-done]").forEach(function(b){
    b.addEventListener("click", function(){
      var sid = b.getAttribute("data-done");
      setStepDone(cfg.topicId, sid, true);
      track("topic_step_done", { topicId: cfg.topicId, stepId: sid, state: "done" });
      renderTopic(); renderHome();
      toast("已标记完成（可撤销）");
    });
  });
  v.querySelectorAll("[data-undone]").forEach(function(b){
    b.addEventListener("click", function(){
      var sid = b.getAttribute("data-undone");
      setStepDone(cfg.topicId, sid, false);
      track("topic_step_done", { topicId: cfg.topicId, stepId: sid, state: "undone" });
      renderTopic(); renderHome();
    });
  });
  v.querySelectorAll("[data-jump]").forEach(function(b){
    b.addEventListener("click", function(){
      var el = document.getElementById("step-" + b.getAttribute("data-jump"));
      if(el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  });
  var saveBtn = v.querySelector("#tpSave");
  if(saveBtn){
    saveBtn.addEventListener("click", function(){
      var ta = v.querySelector("#tpConcl");
      var msg = v.querySelector("#tpMsg");
      var text = ((ta && ta.value) || "").trim();
      var task = null;
      (cfg.steps || []).forEach(function(s){ if(s.task && s.task.type === "conclusion") task = s.task; });
      var minC = (task && task.minChars) || 80;
      var minQ = (task && task.minCitations) || 1;
      var cits = citationsForTopic(cfg);
      var gaps = [];
      if(text.length < minC) gaps.push("结论还差 " + (minC - text.length) + " 字（需至少 " + minC + " 字，现 " + text.length + " 字）");
      if(cits.length < minQ) gaps.push("还没有摘录原文段落（需至少 " + minQ + " 条依据）");
      var notDone = (cfg.steps || []).filter(function(s){ return stepState(cfg.topicId, s.stepId) !== "done"; });
      if(gaps.length){
        if(msg) msg.textContent = "还不能保存：" + gaps.join("；");
        track("topic_conclusion_blocked", { topicId: cfg.topicId, gapCount: gaps.length });
        toast("结论未保存：" + gaps[0]);
        return;
      }
      var all = loadConcl();
      var prev = all[cfg.topicId] || {};
      all[cfg.topicId] = {
        topicId: cfg.topicId,
        text: text,
        citations: cits.map(function(n){
          return { paraId: n.paraId, quote: n.quote, articleId: n.articleId, source: n.source || {}, noteId: n.id };
        }),
        pendingSteps: notDone.map(function(s){ return s.stepId; }),
        createdAt: prev.createdAt || Date.now(),
        updatedAt: Date.now(),
        topicVersion: cfg.version || "1"
      };
      if(saveConcl(all)){
        track("topic_conclusion_save", { topicId: cfg.topicId, chars: text.length, citations: cits.length });
        renderTopic(); renderHome();
        toast("结论已保存，已附带 " + cits.length + " 条摘录依据");
        if(notDone.length) toast("提示：还有 " + notDone.length + " 步未标记完成，专题尚未算完成");
      }
    });
  }
}

function renderTopic(){
  var v = document.getElementById("view-topic");
  if(!v) return;
  track("page_view", {pageType:"topic"});
  if(!TOPIC_CFG){
    v.innerHTML = "<div class='statePanel'><h2>正在载入专题…</h2><p>导读配置读取中。</p></div>";
    loadTopicCfg();
    return;
  }
  v.innerHTML = topicHtml(TOPIC_CFG);
  bindTopic(v, TOPIC_CFG);
}

/* ---------- P06: 我的书房（游客本地成果：聚合 · 分离 · 损坏保护 · 查找 · 备份） ----------
   原则：
   - 读取失败 ≠ 空库：任一 key 解析失败即标记 corrupt，界面明确提示，绝不覆盖原数据
   - 原始 AI 回答与人工改写分开存：cards[].answerRaw 只写一次，人工改写写 editedAnswer
   - 导入只做数据合并，不执行任何内容；渲染一律 textContent（不解析 HTML）
   - 删除先进回收站（mx_trash），可恢复 */
var LIB_SCHEMA = "mx-library@2";
var LIB_KEYS = ["mx_notes", "mx_research_cards", "mx_marks", "mx_read", "mx_recent",
                "mx_topic_progress", "mx_topic_conclusions", "mx_trash"];

function libGet(key, dflt) {
  try {
    var raw = localStorage.getItem(key);
    if (raw === null) return { ok: true, value: dflt, missing: true };
    return { ok: true, value: JSON.parse(raw), raw: raw };
  } catch (e) {
    var raw2 = null;
    try { raw2 = localStorage.getItem(key); } catch (e2) {}
    return { ok: false, corrupt: true, raw: raw2, error: String(e && e.message || e) };
  }
}
function libSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { toast("保存失败：本地存储不可用或空间不足（" + (e && e.name || e) + "）"); return false; }
}
/* P06.1: 首次进入书房先做一次快照，再做结构归一（不删任何旧字段） */
function libMigrate() {
  var ver = null;
  try { ver = localStorage.getItem("mx_schema"); } catch (e) { return { ok: false, error: "storage_blocked" }; }
  if (ver === LIB_SCHEMA) return { ok: true, migrated: false };
  var snapshot = { schema: "mx-library@1-snapshot", at: Date.now(), data: {} };
  LIB_KEYS.forEach(function (k) {
    try { var raw = localStorage.getItem(k); if (raw !== null) snapshot.data[k] = raw; } catch (e) {}
  });
  try { localStorage.setItem("mx_backup_p06", JSON.stringify(snapshot)); } catch (e) {}
  /* 研究卡补 answerRaw（原始 AI 回答），人工改写另存 editedAnswer */
  var cards = libGet("mx_research_cards", []);
  if (cards.ok && Array.isArray(cards.value) && cards.value.length) {
    var changed = false;
    cards.value.forEach(function (c) {
      if (c && typeof c === "object" && c.answerRaw === undefined) {
        c.answerRaw = (c.answerOriginal !== undefined ? c.answerOriginal : (c.answer || ""));
        changed = true;
      }
      if (c && typeof c === "object" && c.editedAnswer === undefined) c.editedAnswer = null;
    });
    if (changed) libSet("mx_research_cards", cards.value);
  }
  try { localStorage.setItem("mx_schema", LIB_SCHEMA); } catch (e) { return { ok: false, error: "storage_blocked" }; }
  return { ok: true, migrated: true };
}
function libCollection() {
  var notes = libGet("mx_notes", []);
  var cards = libGet("mx_research_cards", []);
  var marks = libGet("mx_marks", {});
  var reads = libGet("mx_read", {});
  var recent = libGet("mx_recent", {});
  var prog = libGet("mx_topic_progress", {});
  var concl = libGet("mx_topic_conclusions", {});
  var trash = libGet("mx_trash", []);
  var health = [];
  [["mx_notes", notes], ["mx_research_cards", cards], ["mx_marks", marks], ["mx_read", reads],
   ["mx_recent", recent], ["mx_topic_progress", prog], ["mx_topic_conclusions", concl], ["mx_trash", trash]]
    .forEach(function (pair) { if (!pair[1].ok) health.push({ key: pair[0], error: pair[1].error, raw: pair[1].raw }); });
  return {
    notes: notes.ok && Array.isArray(notes.value) ? notes.value : [],
    cards: cards.ok && Array.isArray(cards.value) ? cards.value : [],
    marks: marks.ok && marks.value && typeof marks.value === "object" ? marks.value : {},
    reads: reads.ok && reads.value && typeof reads.value === "object" ? reads.value : {},
    recent: recent.ok && recent.value && typeof recent.value === "object" ? recent.value : {},
    progress: prog.ok && prog.value && typeof prog.value === "object" ? prog.value : {},
    concl: concl.ok && concl.value && typeof concl.value === "object" ? concl.value : {},
    trash: trash.ok && Array.isArray(trash.value) ? trash.value : [],
    health: health,
  };
}
function libItemTitle(id) {
  var a = ARTS.filter(function (x) { return x.id === id; })[0];
  return a ? a.title : id;
}
/* 汇总成统一条目列表（P06.1 聚合 + P06.2 类型分离） */
function libItems(c) {
  var items = [];
  c.notes.forEach(function (n) {
    if (!n || !n.id) return;
    items.push({
      kind: n.kind === "quote" ? "quote" : "note",
      kindLabel: n.kind === "quote" ? "摘录" : "笔记",
      id: n.id, articleId: n.articleId, paraId: n.paraId || null,
      title: libItemTitle(n.articleId),
      text: n.kind === "quote" ? (n.quote || "") : (n.note || ""),
      quote: n.quote || "", source: n.source || null, ts: n.createdAt || 0,
    });
  });
  c.cards.forEach(function (card) {
    if (!card || !card.id) return;
    items.push({
      kind: "card", kindLabel: "研究卡",
      id: card.id, articleId: (card.citations && card.citations[0] && card.citations[0].articleId) || null,
      paraId: (card.citations && card.citations[0] && card.citations[0].id) || null,
      title: card.question || "（未命名研究卡）",
      text: card.editedAnswer || card.answer || "",
      hasRaw: !!card.answerRaw, edited: !!card.editedAnswer,
      citations: card.citations || [], source: null, ts: card.createdAt || 0,
    });
  });
  return items.sort(function (a, b) { return b.ts - a.ts; });
}
function libExportJSON() {
  var c = libCollection();
  var doc = {
    schema: LIB_SCHEMA, exportedAt: new Date().toISOString(), app: "aibigplayer",
    stats: { notes: c.notes.length, cards: c.cards.length, marks: Object.keys(c.marks).length,
             reads: Object.keys(c.reads).length, topics: Object.keys(c.progress).length },
    data: { mx_notes: c.notes, mx_research_cards: c.cards, mx_marks: c.marks, mx_read: c.reads,
            mx_recent: c.recent, mx_topic_progress: c.progress, mx_topic_conclusions: c.concl },
  };
  var blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "aibigplayer-书房备份-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  toast("已导出备份（含 " + (c.notes.length + c.cards.length) + " 条成果）");
}
function libExportMarkdown() {
  var c = libCollection();
  var lines = ["# 我的书房 · 导出", "", "导出时间：" + new Date().toLocaleString(), ""];
  if (c.notes.length) {
    lines.push("## 摘录与笔记（" + c.notes.length + "）", "");
    c.notes.forEach(function (n) {
      lines.push("### " + (n.kind === "quote" ? "摘录" : "笔记") + " · " + libItemTitle(n.articleId) + (n.paraId ? " · " + n.paraId : ""));
      if (n.quote) lines.push("> " + String(n.quote).replace(/\n/g, " "));
      if (n.note) lines.push("", n.note);
      var s = n.source || {};
      lines.push("", "_来源：" + (s.title || "") + (s.dateRaw ? "（" + String(s.dateRaw).replace(/[（）()]/g, "") + "）" : "") + "_", "");
    });
  }
  if (c.cards.length) {
    lines.push("## 研究卡（" + c.cards.length + "）", "");
    c.cards.forEach(function (card) {
      lines.push("### " + (card.question || "研究卡"));
      if (card.editedAnswer) lines.push("", "**我的改写**：" + card.editedAnswer, "", "**AI 原始回答**：" + (card.answerRaw || card.answer || ""));
      else lines.push("", card.answer || card.answerRaw || "");
      (card.citations || []).forEach(function (ct) {
        lines.push("- 引用 `" + (ct.id || "") + "`" + (ct.quote ? "：" + ct.quote : ""));
      });
      lines.push("");
    });
  }
  var conclKeys = Object.keys(c.concl || {});
  if (conclKeys.length) {
    lines.push("## 专题结论", "");
    conclKeys.forEach(function (k) {
      var cc = c.concl[k] || {};
      lines.push("### 专题 " + k, "", cc.text || "", "");
      (cc.citations || []).forEach(function (ct) {
        lines.push("- 依据 `" + (ct.paraId || "") + "`：" + (ct.quote || "") + "　（" + ((ct.source && ct.source.title) || "") + "）");
      });
      lines.push("");
    });
  }
  if (lines.length <= 4) lines.push("（还没有可导出的成果）");
  var blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "aibigplayer-书房-" + new Date().toISOString().slice(0, 10) + ".md";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  toast("已导出 Markdown");
}
/* P06.5: 导入 — 只合并不覆盖，冲突有规则，内容不执行 */
function libImportJSON(text) {
  var doc;
  try { doc = JSON.parse(text); } catch (e) { return { ok: false, error: "不是合法 JSON：" + (e && e.message) }; }
  if (!doc || typeof doc !== "object" || !doc.data || typeof doc.data !== "object") {
    return { ok: false, error: "结构不符：缺少 data 字段（需要本应用导出的备份文件）" };
  }
  if (doc.schema && String(doc.schema).indexOf("mx-library@") !== 0) {
    return { ok: false, error: "版本不识别：" + doc.schema };
  }
  var report = { added: 0, skippedSame: 0, replacedNewer: 0, keptLocalNewer: 0, badItems: 0 };
  ["mx_notes", "mx_research_cards"].forEach(function (key) {
    var incoming = doc.data[key];
    if (!Array.isArray(incoming)) return;
    var cur = libGet(key, []);
    if (!cur.ok) return { ok: false, error: "本地 " + key + " 已损坏，已中止导入以免覆盖" };
    var list = Array.isArray(cur.value) ? cur.value.slice() : [];
    var byId = {};
    list.forEach(function (x, i) { if (x && x.id) byId[x.id] = i; });
    incoming.forEach(function (x) {
      if (!x || typeof x !== "object" || !x.id) { report.badItems++; return; }
      var clean = JSON.parse(JSON.stringify(x));   // 只保留数据，不保留任何可执行内容
      var idx = byId[clean.id];
      if (idx === undefined) { list.push(clean); byId[clean.id] = list.length - 1; report.added++; return; }
      var old = list[idx] || {};
      var oldT = old.updatedAt || old.createdAt || 0;
      var newT = clean.updatedAt || clean.createdAt || 0;
      if (JSON.stringify(old) === JSON.stringify(clean)) { report.skippedSame++; return; }
      if (newT > oldT) { list[idx] = clean; report.replacedNewer++; }
      else { report.keptLocalNewer++; }
    });
    libSet(key, list);
  });
  /* 进度/结论: 只补缺, 不覆盖已有更晚记录 */
  ["mx_topic_progress", "mx_topic_conclusions"].forEach(function (key) {
    var incoming = doc.data[key];
    if (!incoming || typeof incoming !== "object") return;
    var cur = libGet(key, {});
    if (!cur.ok) return;
    var mine = (cur.value && typeof cur.value === "object") ? cur.value : {};
    Object.keys(incoming).forEach(function (tid) {
      if (!mine[tid]) { mine[tid] = incoming[tid]; report.added++; }
    });
    libSet(key, mine);
  });
  return { ok: true, report: report };
}
function libTrash(kind, id, payload) {
  var t = libGet("mx_trash", []);
  var list = t.ok && Array.isArray(t.value) ? t.value : [];
  list.unshift({ kind: kind, id: id, payload: payload, at: Date.now() });
  if (list.length > 200) list = list.slice(0, 200);
  libSet("mx_trash", list);
}
function libDeleteItem(it) {
  if (!confirm("删除这条" + it.kindLabel + "？删除后可在下方「回收站」恢复。")) return false;
  if (it.kind === "card") {
    var cards = libGet("mx_research_cards", []);
    var list = cards.ok && Array.isArray(cards.value) ? cards.value : [];
    var target = list.filter(function (x) { return x && x.id === it.id; })[0];
    if (target) libTrash("card", it.id, target);
    libSet("mx_research_cards", list.filter(function (x) { return !(x && x.id === it.id); }));
  } else {
    var notes = libGet("mx_notes", []);
    var nl = notes.ok && Array.isArray(notes.value) ? notes.value : [];
    var t2 = nl.filter(function (x) { return x && x.id === it.id; })[0];
    if (t2) libTrash("note", it.id, t2);
    libSet("mx_notes", nl.filter(function (x) { return !(x && x.id === it.id); }));
  }
  return true;
}
function libRestore(index) {
  var t = libGet("mx_trash", []);
  var list = t.ok && Array.isArray(t.value) ? t.value : [];
  var rec = list[index];
  if (!rec) return false;
  var key = rec.kind === "card" ? "mx_research_cards" : "mx_notes";
  var cur = libGet(key, []);
  var arr = cur.ok && Array.isArray(cur.value) ? cur.value : [];
  if (!arr.some(function (x) { return x && x.id === rec.id; })) arr.push(rec.payload);
  libSet(key, arr);
  list.splice(index, 1);
  libSet("mx_trash", list);
  return true;
}

/* ---------- 书房界面 ---------- */
var studyState = { q: "", kind: "all", art: "all" };
function renderStudy() {
  var v = document.getElementById("view-study");
  if (!v) return;
  libMigrate();
  var c = libCollection();
  var items = libItems(c);
  var q = studyState.q.trim();
  var filtered = items.filter(function (it) {
    if (studyState.kind !== "all" && it.kind !== studyState.kind) return false;
    if (studyState.art !== "all" && it.articleId !== studyState.art) return false;
    if (!q) return true;
    var hay = [it.title, it.text, it.quote, it.paraId || "", (it.citations || []).map(function (x) { return x.id + " " + (x.quote || ""); }).join(" ")].join(" ");
    return hay.indexOf(q) >= 0;
  });
  var ts = TOPIC_CFG ? topicStatus(TOPIC_CFG) : null;
  var concl = TOPIC_CFG ? (c.concl[TOPIC_CFG.topicId] || null) : null;

  var h = "<div class='topicWrap'>";
  h += "<div class='topicHero'><h2>我的书房</h2><p class='meta'>这里汇总本机保存的阅读记录、收藏、摘录笔记、研究卡与专题结论。数据只存在这台设备，不上传；没有记录就显示 0，不预填。</p></div>";

  /* P06.3: 存储健康状态 */
  if (c.health.length) {
    h += "<div class='libWarn'><b>有 " + c.health.length + " 处本地数据读取失败</b>（读取失败不等于数据为空，本站没有覆盖它们）。" +
         "建议先复制原始内容再决定是否清理：<div class='libRaw' id='libRaw'>" +
         esc(c.health.map(function (x) { return x.key + "：" + (x.raw || "").slice(0, 400); }).join("\n---\n")) + "</div>" +
         "<button id='libCopyRaw'>复制原始内容</button></div>";
  }

  h += "<div class='libBar'>";
  h += "<input id='libQ' placeholder='查找：标题 / 摘录 / 笔记 / 段落号…' value='" + esc(studyState.q) + "'>";
  h += "<span class='libFilters'>";
  [["all", "全部"], ["quote", "摘录"], ["note", "笔记"], ["card", "研究卡"]].forEach(function (p) {
    h += "<button data-lk='" + p[0] + "' class='" + (studyState.kind === p[0] ? "on" : "") + "'>" + p[1] + "</button>";
  });
  h += "</span>";
  h += "</div>";

  h += "<div class='studyGrid'>";
  h += "<div class='studyCard'><div class='num'>" + Object.keys(c.reads).length + "</div><div class='lb'>已读篇目</div><a class='lk' href='#/view/cats'>去经典研读</a></div>";
  h += "<div class='studyCard'><div class='num'>" + Object.keys(c.marks).length + "</div><div class='lb'>收藏篇目</div><a class='lk' href='#/view/cats'>目录中带 ★ 的篇目</a></div>";
  h += "<div class='studyCard'><div class='num'>" + c.notes.length + "</div><div class='lb'>摘录与笔记</div><a class='lk' href='#/view/cats'>在原文中选中文字即可摘录</a></div>";
  h += "<div class='studyCard'><div class='num'>" + c.cards.length + "</div><div class='lb'>研究卡</div><a class='lk' href='research.html'>去 AI 研究室</a></div>";
  if (ts) {
    h += "<div class='studyCard'><div class='num'>" + ts.done + "/" + ts.total + "</div><div class='lb'>专题步骤" + (ts.complete ? " · 已完成" : "") + "</div>" +
         "<a class='lk' href='#/view/topic'>" + (ts.nextStep ? "继续第 " + ts.nextStep.seq + " 步" : "查看专题") + "</a></div>";
  }
  h += "</div>";

  /* 专题结论 */
  if (concl && concl.text) {
    h += "<div class='libConcl'><div class='libCh'>我的专题结论" + (ts && ts.complete ? " · 已完成" : " · 尚未完成全部步骤") + "</div>";
    h += "<div class='libCt'>" + esc(concl.text) + "</div>";
    if (concl.citations && concl.citations.length) {
      h += "<div class='libCits'>依据：" + concl.citations.slice(0, 8).map(function (ct) {
        return "<a href='#/art/" + esc(ct.articleId || "") + "/" + esc(ct.paraId || "") + "'>" + esc(ct.paraId || "") + "</a>";
      }).join("、") + (concl.citations.length > 8 ? " 等 " + concl.citations.length + " 条" : "") + "</div>";
    }
    h += "<div class='libActs'><a class='lk' href='#/view/topic'>回到专题</a></div></div>";
  }

  /* 成果列表 */
  h += "<div class='libListHead'>成果 <span>" + filtered.length + " 条" +
       (q || studyState.kind !== "all" ? "（已筛选）" : "") + "</span></div>";
  if (!items.length) {
    h += "<div class='statePanel' style='margin:18px auto'><h2>书房还是空的</h2>" +
         "<p>阅读过的文章会自动记录；在原文中选中文字可以摘录或写笔记；在 AI 研究室可以把回答保存为研究卡；专题完成后会保存结论。</p>" +
         "<div class='acts'><a href='#/view/topic'>从一份专题开始</a><a class='ghost' href='#/view/cats'>浏览全部篇目</a></div></div>";
  } else if (!filtered.length) {
    h += "<div class='statePanel' style='margin:18px auto'><h2>没有匹配的成果</h2><p>换个关键词，或切回「全部」类型。</p>" +
         "<div class='acts'><button class='ghost' id='libReset'>清除筛选</button></div></div>";
  } else {
    h += "<ul class='libList'>";
    filtered.forEach(function (it, idx) {
      h += "<li class='libItem' data-idx='" + idx + "'>";
      h += "<div class='liTop'><span class='liKind " + it.kind + "'>" + it.kindLabel + "</span>" +
           "<span class='liTime'>" + (it.ts ? new Date(it.ts).toLocaleString() : "") + "</span></div>";
      h += "<div class='liTitle'>" + esc(it.title) + (it.articleId ? " · <span class='liArt'>" + esc(it.articleId) + "</span>" : "") + "</div>";
      if (it.kind === "quote" && it.quote) h += "<div class='liQuote'>「" + esc(it.quote.slice(0, 160)) + "」</div>";
      if (it.text && it.kind !== "quote") h += "<div class='liText'>" + esc(it.text.slice(0, 220)) + (it.text.length > 220 ? "…" : "") + "</div>";
      if (it.kind === "card" && it.edited) h += "<div class='liTag'>含人工改写（原始 AI 回答另存）</div>";
      if (it.source && it.source.title) {
        h += "<div class='liSrc'>来源：" + esc(it.source.title) + (it.source.dateRaw ? "（" + esc(String(it.source.dateRaw).replace(/[（）()]/g, "")) + "）" : "") + "</div>";
      }
      h += "<div class='liActs'>";
      if (it.articleId) h += "<a class='lk' href='#/art/" + esc(it.articleId) + (it.paraId ? "/" + esc(it.paraId) : "") + "'>回到原段</a>";
      if (it.kind === "card") h += "<a class='lk' href='research.html'>在研究室查看</a>";
      h += "<button class='liDel' data-del='" + esc(it.id) + "'>删除</button>";
      h += "</div></li>";
    });
    h += "</ul>";
  }

  /* 回收站 */
  if (c.trash.length) {
    h += "<div class='libTrash'><div class='libCh'>回收站（" + c.trash.length + "）</div><ul>";
    c.trash.slice(0, 10).forEach(function (t2, i) {
      h += "<li>" + esc(t2.kind === "card" ? "研究卡" : "笔记") + " · " + esc(String(t2.id).slice(0, 14)) +
           " · " + esc(new Date(t2.at).toLocaleString()) + " <button data-restore='" + i + "'>恢复</button></li>";
    });
    h += "</ul></div>";
  }

  /* 备份与导出 */
  h += "<div class='libTools'>";
  h += "<button id='libExportJson'>导出 JSON 备份</button>";
  h += "<button id='libExportMd'>导出 Markdown</button>";
  h += "<label class='libImport'>导入备份<input type='file' id='libImportFile' accept='.json,application/json' style='display:none'></label>";
  h += "<span class='libHint'>导入只合并、不覆盖；同一条目保留较新版本。备份文件不包含密码或账号。</span>";
  h += "</div>";
  if (c.health.length === 0) {
    h += "<div class='homeNote'>你的成果全部保存在本机浏览器。换设备或清理浏览器数据前，请先导出备份。</div>";
  }
  h += "</div>";
  v.innerHTML = h;
  bindStudy(v, filtered, c);
  track("page_view", { pageType: "study" });
}
function bindStudy(v, filtered, c) {
  var qi = v.querySelector("#libQ");
  if (qi) {
    qi.addEventListener("input", function () {
      studyState.q = qi.value;
      var pos = qi.selectionStart;
      renderStudy();
      var q2 = document.getElementById("libQ");
      if (q2) { q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (e) {} }
    });
  }
  v.querySelectorAll("[data-lk]").forEach(function (b) {
    b.addEventListener("click", function () { studyState.kind = b.getAttribute("data-lk"); renderStudy(); });
  });
  var reset = v.querySelector("#libReset");
  if (reset) reset.addEventListener("click", function () { studyState = { q: "", kind: "all", art: "all" }; renderStudy(); });

  v.querySelectorAll("[data-del]").forEach(function (b) {
    b.addEventListener("click", function () {
      var id = b.getAttribute("data-del");
      var it = filtered.filter(function (x) { return x.id === id; })[0];
      if (!it) return;
      if (libDeleteItem(it)) { toast("已移到回收站，可恢复"); renderStudy(); }
    });
  });
  v.querySelectorAll("[data-restore]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (libRestore(parseInt(b.getAttribute("data-restore"), 10))) { toast("已恢复"); renderStudy(); }
    });
  });
  var ej = v.querySelector("#libExportJson");
  if (ej) ej.addEventListener("click", libExportJSON);
  var em = v.querySelector("#libExportMd");
  if (em) em.addEventListener("click", libExportMarkdown);
  var fi = v.querySelector("#libImportFile");
  if (fi) {
    fi.addEventListener("change", function () {
      var f = fi.files && fi.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var out = libImportJSON(String(rd.result || ""));
        if (!out.ok) { alert("导入失败：" + out.error); return; }
        var r = out.report;
        alert("导入完成：新增 " + r.added + " 条，跳过相同 " + r.skippedSame + " 条，更新较新 " + r.replacedNewer +
              " 条，保留本地较新 " + r.keptLocalNewer + " 条" + (r.badItems ? "，忽略无效 " + r.badItems + " 条" : "") + "。");
        renderStudy();
      };
      rd.readAsText(f);
    });
  }
  var cr = v.querySelector("#libCopyRaw");
  if (cr) {
    cr.addEventListener("click", function () {
      var el = v.querySelector("#libRaw");
      var t = el ? el.textContent : "";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(function () { toast("原始内容已复制"); }, function () { toast("复制失败，请手动选择文本"); });
      } else { toast("请手动选择文本复制"); }
    });
  }
}

function renderHome(){
  var v = document.getElementById("view-home");
  var last = lastReadArticle();
  var marks = [], readCnt = 0, cardCnt = 0;
  try{ marks = Object.keys(JSON.parse(localStorage.getItem("mx_marks")||"{}")); }catch(e){}
  try{ readCnt = Object.keys(JSON.parse(localStorage.getItem("mx_read")||"{}")).length; }catch(e){}
  try{ var cc = JSON.parse(localStorage.getItem("mx_research_cards")||"[]"); cardCnt = Array.isArray(cc) ? cc.length : 0; }catch(e){}
  var h = "<div class='homeWrap'>";
  h += "<div class='hero'><h1>毛选时空研读</h1><p class='sub'>从一个问题开始：找到原文、读懂上下文、核查引用，再写下自己的理解。</p>";
  h += "<div class='heroBtns'><a class='btnMain' href='#/view/topic'>开始一份专题</a>" +
       "<a class='btnCont' href='#/view/cats'>浏览全部篇目</a></div>";
  /* P02.2: 继续阅读 — 只用真实记录，无记录时给明确开始动作，不生成假进度 */
  if(last){
    var t = "";
    try{ t = new Date(JSON.parse(localStorage.getItem("mx_recent")||"{}")[last.id]).toLocaleDateString(); }catch(e){}
    h += "<p class='heroNote'>继续上次 ·《<a href='#/art/"+esc(last.id)+"' style='color:var(--cinnabar);text-decoration:none;border-bottom:1px dashed var(--cinnabar)'>"+esc(last.title)+"</a>》"+(t?" · "+t:"")+"</p>";
  }else{
    h += "<p class='heroNote'>还没有阅读记录。点上面任一入口开始，读到哪会自动记住，下次接着读。</p>";
  }
  if(readCnt || marks.length || cardCnt){
    h += "<p class='heroNote'>本机记录：已读 "+readCnt+" 篇 · 收藏 "+marks.length+" 篇 · 研究卡 "+cardCnt+" 张 · <a href='#/view/study' style='color:var(--cinnabar)'>进入我的书房</a></p>";
  }
  /* P04.5: 首页显示专题真实完成状态（只读本地记录，不推断） */
  if(TOPIC_CFG){
    var ts = topicStatus(TOPIC_CFG);
    h += "<p class='heroNote'>专题《" + esc(TOPIC_CFG.title) + "》 · " +
      (ts.complete ? "<b style='color:var(--cinnabar)'>已完成</b>"
        : (ts.done + "/" + ts.total + " 步" + (ts.nextStep ? " · 下一步：" + esc(ts.nextStep.title) : " · 全部标完成") +
           (ts.hasConclusion ? " · 结论已保存" : " · 结论未保存"))) +
      " · <a href='#/view/topic' style='color:var(--cinnabar)'>" + (ts.complete ? "回看专题" : "继续专题") + "</a></p>";
  }
  h += "</div>";
  /* P02.2/P02.3: 主任务入口（研读/专题/研究室/书房） */
  h += "<div class='homeGrid'>";
  h += "<a class='homeCard' href='#/view/topic'><i>题</i><b>从一份专题开始</b><span>围绕一个问题串读两篇原文，带着任务读完</span></a>";
  h += "<a class='homeCard' href='#/view/cats'><i>典</i><b>经典研读</b><span>按卷浏览 217 篇，读到哪记到哪</span></a>";
  h += "<a class='homeCard' href='research.html'><i>问</i><b>AI 研究室</b><span>答案必须引用原文段落，可逐条核对</span></a>";
  h += "<a class='homeCard' href='#/view/study'><i>房</i><b>我的书房</b><span>收藏、阅读记录与研究卡汇总</span></a>";
  h += "</div>";
  /* 探索工具（降为辅助） */
  h += "<div class='homeGrid'>";
  h += "<a class='homeCard' href='#/view/map'><i>舆</i><b>探索 · 舆图</b><span>从写作地点找文章</span></a>";
  h += "<a class='homeCard' href='#/view/tl'><i>谱</i><b>探索 · 年谱</b><span>1925—1957 按年看脉络</span></a>";
  h += "<a class='homeCard' href='#/view/graph'><i>图</i><b>探索 · 图谱</b><span>按关系延伸阅读</span></a>";
  h += "<a class='homeCard' href='#/view/stats'><i>数</i><b>探索 · 语料统计</b><span>篇幅与地点分布</span></a>";
  h += "</div>";
  /* 可问语料说明 */
  h += "<div class='homeNote'>AI 研究室的回答范围：目前只覆盖《中国的红色政权为什么能够存在？》《井冈山的斗争》两篇原文；其他篇目可以阅读、收藏、记笔记，但不会被 AI 引用。语料不足时会直接说明「资料不足」，不编造。</div>";
  h += "<div class='homeNote'>资料来源：《毛泽东选集》第一至五卷（人民出版社）· 本站仅作个人学习研读之用 · 收藏与阅读位置仅保存在当前浏览器</div>";
  h += "</div>";
  v.innerHTML = h;
  track("page_view", {pageType:"home"});
}
function show(v){
  state.view = v;
  ["map","tl","graph","read","search","stats","cats","home","topic","study"].forEach(function(k){
    var el = document.getElementById("view-"+k);
    if(el) el.classList.toggle("on", k===v);
  });
  if(v==="cats") renderCatalog();
  if(v==="home") renderHome();
  if(v==="topic") renderTopic();
  if(v==="study") renderStudy();
  document.querySelectorAll("nav button, #tabbar button").forEach(function(b){
    b.classList.toggle("on", b.getAttribute("data-v")===v);
  });
  if(v==="map" && mapObj) setTimeout(function(){ mapObj.invalidateSize(); }, 60);
  if(v==="graph"){ ensureGraph(function(){ graphChart && graphChart.resize(); }); }
  if(v==="tl" && tlFirstShow){
    tlFirstShow = false;
    var cnt = {};
    ARTS.forEach(function(a){ cnt[a.y]=(cnt[a.y]||0)+1; });
    var best = Object.keys(cnt).sort(function(a,b){return cnt[b]-cnt[a];})[0];
    selectYear(parseInt(best));
  }
}
document.querySelectorAll("nav button, #tabbar button").forEach(function(b){
  b.addEventListener("click", function(){
    var v = b.getAttribute("data-v");
    if(!v) return;                                  /* P02.1: 探索 menu trigger has no data-v */
    if(v==="read"){ if(state.curArt) setHash("#/art/"+state.curArt.id); return; }
    var m = document.getElementById("navMenu");
    if(m) m.classList.remove("open");
    setHash("#/view/"+v);
  });
});
/* P02.1: 探索 dropdown (舆图/年谱/图谱/统计 降为辅助入口) */
(function(){
  var g = document.getElementById("navGroup");
  var btn = document.getElementById("navExplore");
  var menu = document.getElementById("navMenu");
  if(!g || !btn || !menu) return;
  btn.addEventListener("click", function(e){
    e.stopPropagation();
    var open = menu.classList.toggle("open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  document.addEventListener("click", function(e){
    if(!g.contains(e.target)){ menu.classList.remove("open"); btn.setAttribute("aria-expanded","false"); }
  });
})();

/* P03.3: 从专题/书房/首页卡片进入文章时记录来源，供文章页显示对应返回按钮 */
document.addEventListener("click", function(e){
  var a = e.target && e.target.closest ? e.target.closest("a[href^='#/art/']") : null;
  if(!a) return;
  var v = state && state.view;
  if(v === "topic") setOrigin({ type:"topic" });
  else if(v === "study") setOrigin({ type:"study" });
  else if(v === "cats") setOrigin({ type:"cats" });
});
/* P03.2: 预取样本段落数据，保证深链锚点可同步解析 */
(function(){
  if(typeof fetch !== "function") return;
  fetch("data/sample-topic.json").then(function(r){ return r.json(); }).then(function(j){
    __sampleTopicCache = j;
  }).catch(function(){});
})();
/* P04: 预取专题配置，首页/书房可显示真实专题状态 */
(function(){ if(typeof loadTopicCfg === "function") loadTopicCfg(); })();

/* ---------- data prep ---------- */
var ARTS = DATA;
ARTS.forEach(function(a){ a.ts = a.y + (a.m?a.m:1)/12; });
function eraOfYear(y){
  for(var i=0;i<ERAS.length;i++){ if(y>=ERAS[i].from && y<=ERAS[i].to) return ERAS[i]; }
  return ERAS[ERAS.length-1];
}
ARTS.forEach(function(a){ if(!a.era) a.era = eraOfYear(a.y).name; });
var byId = {}; ARTS.forEach(function(a){ byId[a.id]=a; });
var titleIndex = {}; ARTS.forEach(function(a){ titleIndex[a.title]=a; });

var places = {};
var PLACE_CANON = {                    /* N04: canonical grouping - variant names of the same place */
  "延安市":"延安",
  "山西兴县蔡家崖（晋绥解放区首府）":"山西兴县蔡家崖（晋绥解放区）",
  "河北西柏坡（平山县西柏坡村）":"河北西柏坡"
};
ARTS.forEach(function(a){
  if(a.lat && a.lng && a.lat>17 && a.lat<55 && a.lng>72 && a.lng<136){
    var k = PLACE_CANON[a.place] || a.place;
    if(!places[k]) places[k] = {name:k, lat:a.lat, lng:a.lng, arts:[]};
    places[k].arts.push(a);
  }
});
var placeList = Object.keys(places).map(function(k){return places[k];});
placeList.forEach(function(p){
  p.lat = p.arts.reduce(function(s,x){return s+x.lat;},0)/p.arts.length;
  p.lng = p.arts.reduce(function(s,x){return s+x.lng;},0)/p.arts.length;
  p.bg = (typeof PLACE_BG!=="undefined" && PLACE_BG[p.name]) || "";
});

/* ---------- MAP ---------- */
var mapObj = null, markers = [], labelLayer = null, routeLayer = null;
function visibleArts(){
  return ARTS.filter(function(a){
    if(state.eraFilter && a.era!==state.eraFilter) return false;
    if(state.histYear!=null && a.y > state.histYear) return false;
    return true;
  });
}
function initMap(){
  mapObj = L.map("mapChart", {
    center:[33.5, 106.5], zoom:4, minZoom:4, maxZoom:6,
    attributionControl:false, zoomControl:true, worldCopyJump:false,
    maxBounds:[[6,58],[66,152]], maxBoundsViscosity:.8
  });
  mapObj.createPane("routePane"); mapObj.getPane("routePane").style.zIndex = 640;
  mapObj.createPane("labelPane"); mapObj.getPane("labelPane").style.zIndex = 660;
  L.tileLayer("assets/tiles/{z}/{x}/{y}.jpg", {maxZoom:6, errorTileUrl:""}).addTo(mapObj);
  labelLayer = L.layerGroup().addTo(mapObj);
  routeLayer = L.layerGroup().addTo(mapObj);
  mapObj.on("zoomend", renderLabels);
  renderLabels();
  updateMarkers();
  window.addEventListener("resize", function(){ mapObj && mapObj.invalidateSize(); });
}
function renderLabels(){
  if(!mapObj) return;
  labelLayer.clearLayers();
  var z = mapObj.getZoom();
  var maxLv = z<=4 ? 1 : (z===5 ? 2 : 3);
  CN_LABELS.forEach(function(c){
    if(c[3] > maxLv && c[3]!==0) return;
    var cls = c[3]===0 ? "cnlab hl" : ("cnlab lv"+c[3]);
    var ic = L.divIcon({className:"", iconSize:null,
      html:"<div class='"+cls+"'>"+c[0]+"</div>"});
    L.marker([c[1],c[2]], {icon:ic, interactive:false, keyboard:false, pane:"labelPane"}).addTo(labelLayer);
  });
}
function updateMarkers(){
  if(!mapObj) return;                          /* N06: guard degraded mode */
  markers.forEach(function(m){ mapObj.removeLayer(m); });
  markers = [];
  var vis = visibleArts();
  var visIds = {}; vis.forEach(function(a){visIds[a.id]=1;});
  placeList.forEach(function(p){
    var sub = p.arts.filter(function(a){return visIds[a.id];});
    if(!sub.length) return;
    var n = sub.length;
    var sz = Math.min(18 + Math.sqrt(n)*6, 56);
    var icon = L.divIcon({
      className:"", iconSize:[sz,sz], iconAnchor:[sz/2, sz/2],
      html:"<div class='mk' style='width:"+sz+"px;height:"+sz+"px'>"+(n>1?n:"")+"</div>"
    });
    var m = L.marker([p.lat, p.lng], {icon:icon}).addTo(mapObj);
    m.on("click", function(){ setHash("#/place/"+encodeURIComponent(p.name)); });
    m.bindTooltip(p.name+" · "+n+"篇", {direction:"top", offset:[0,-sz/2-4]});
    markers.push(m);
  });
  drawRoute();
}
function drawRoute(){
  if(!mapObj || !routeLayer) return;           /* N06: guard degraded mode */
  routeLayer.clearLayers();
  var upto = state.histYear==null ? 9999 : state.histYear;
  var pts = [], stops = [];
  ROUTE.forEach(function(r){
    if(r[1] <= upto){ pts.push([r[2], r[3]]); stops.push(r); }
  });
  if(pts.length < 1) return;
  if(pts.length >= 2){
    L.polyline(pts, {color:"#fff8ea", weight:7, opacity:.92, pane:"routePane", interactive:false, className:"routeHalo"}).addTo(routeLayer);
    L.polyline(pts, {color:"#b03a2e", weight:3.5, opacity:.95, pane:"routePane", interactive:false, className:"routeMain"}).addTo(routeLayer);
  }
  var CN_NUMS = ["①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩"];
  stops.forEach(function(r, i){
    var last = (i === stops.length-1);
    var ic = L.divIcon({className:"", iconSize:last?[14,14]:[8,8], iconAnchor:last?[7,7]:[4,4],
      html:"<div class='rstop"+(last?" cur":"")+"'></div>"});
    var mk = L.marker([r[2], r[3]], {icon:ic, interactive:false, pane:"labelPane"}).addTo(routeLayer);
    if(last || state.histYear==null){
      var lab = L.divIcon({className:"", iconSize:null,
        html:"<div class='rlab"+(last?" cur":"")+"'>"+CN_NUMS[i]+" "+r[0]+"</div>"});
      L.marker([r[2], r[3]], {icon:lab, interactive:false, pane:"labelPane"}).addTo(routeLayer);
    }
  });
}

/* place card with history background */
function selectPlace(pid){
  var p = places[pid];
  if(!p) return;
  state.selPlace = pid;
  var card = document.getElementById("placeCard");
  var visIds = {}; visibleArts().forEach(function(a){visIds[a.id]=1;});
  var sub = p.arts.filter(function(a){return visIds[a.id];});
  sub.sort(function(a,b){return a.ts-b.ts;});
  var yrs = sub.length ? (sub[0].y+" — "+sub[sub.length-1].y) : "";
  var eraChips = {};
  sub.forEach(function(a){ eraChips[a.era]=1; });
  var h = "<h3>"+p.name+" <span class='cnt'>"+sub.length+" 篇</span></h3>"+
    "<div class='meta'>"+yrs+"</div>";
  if(p.bg){
    h += "<div class='pbg'><h4>历史背景</h4><p>"+p.bg+"</p>"+
      "<div class='erachips'>"+Object.keys(eraChips).map(function(e){return "<span>"+e+"</span>";}).join("")+"</div></div>";
  }
  h += "<ul class='artlist'>";
  sub.forEach(function(a){
    h += "<li data-id='"+a.id+"'><div class='t'>"+a.title+"</div>"+
      "<div class='d'>"+a.dateRaw.replace(/[（）()]/g,"")+" · <b>"+a.event+"</b></div></li>";
  });
  h += "</ul>";
  card.innerHTML = h;
  card.querySelectorAll("li").forEach(function(li){
    li.addEventListener("click", function(){ setHash("#/art/"+li.getAttribute("data-id")); });
  });
}

/* era filter */
(function(){
  var box = document.getElementById("eraFilter");
  var h = "<button data-e='' class='on'>全部时期</button>";
  ERAS.forEach(function(e){
    var n = ARTS.filter(function(a){return a.era===e.name;}).length;
    if(n) h += "<button data-e='"+e.name+"'>"+e.name+" "+n+"</button>";
  });
  box.innerHTML = h;
  box.querySelectorAll("button").forEach(function(b){
    b.addEventListener("click", function(){
      box.querySelectorAll("button").forEach(function(x){x.classList.remove("on");});
      b.classList.add("on");
      state.eraFilter = b.getAttribute("data-e") || null;
      updateMarkers();
      if(state.selPlace) selectPlace(state.selPlace);
    });
  });
})();

/* history progression controls */
var playTimer = null;
function setHistYear(y){
  state.histYear = y;
  var lab = document.getElementById("histYearLab");
  var eraLab = document.getElementById("histEraLab");
  if(y==null){
    lab.textContent = "全部";
    eraLab.textContent = "";
  }else{
    lab.textContent = y + " 年";
    var e = eraOfYear(y);
    eraLab.textContent = e.name;
    eraLab.style.color = e.color;
  }
  document.getElementById("histSlider").value = y==null ? 1958 : y;
  updateMarkers();
  if(state.selPlace) selectPlace(state.selPlace);
}
document.getElementById("histSlider").addEventListener("input", function(){
  stopPlay();
  var v = parseInt(this.value);
  setHistYear(v>=1958 ? null : v);
});
document.getElementById("histReset").addEventListener("click", function(){
  stopPlay(); setHistYear(null);
});
document.getElementById("histPlay").addEventListener("click", function(){
  if(playTimer){ stopPlay(); return; }
  var y = state.histYear==null ? 1925 : state.histYear;
  if(y>=1957) y = 1925;
  this.textContent = "⏸ 停";
  playTimer = setInterval(function(){
    y++;
    if(y>1957){ stopPlay(); return; }
    setHistYear(y);
  }, 850);
});
function stopPlay(){
  if(playTimer){ clearInterval(playTimer); playTimer=null; }
  document.getElementById("histPlay").textContent = "▶ 播放";
}

/* ---------- TIMELINE ---------- */
var Y0 = 1925, Y1 = 1958;
function pxPerYear(){
  if(!state.tlFit) return 46;
  var wrap = document.querySelector(".tlwrap");
  return Math.max(16, (wrap.clientWidth - 20) / (Y1 - Y0 + 1));
}
function renderTimeline(){
  var inner = document.getElementById("tlInner");
  var PX = pxPerYear();
  var W = Math.round((Y1 - Y0 + 1) * PX) + 20;
  var HIST_H = 54, BAND_H = 42;
  var h = "";
  ERAS.forEach(function(e){
    var x0 = Math.round((e.from-Y0)*PX)+10, x1 = Math.round((e.to+1-Y0)*PX)+10;
    var bw = x1 - x0 - 2;
    var label = e.name;
    var fs = "13px", ls = "2px";
    var y2 = function(v){ return (v%100<10?"0":"") + (v%100); };
    if(bw >= 170) label = e.name + " " + e.from + "—" + Math.min(e.to,1957);
    else if(bw >= 100) label = e.name + " " + y2(e.from) + "—" + y2(Math.min(e.to,1957));
    if(bw < 150){ fs = "11px"; ls = "0"; }
    if(PX < 30){ label = e.from + ""; }
    h += "<div class='eraBand' data-x='"+x0+"' style='left:"+x0+"px;width:"+bw+"px;background:"+e.color+";opacity:.92;font-size:"+fs+";letter-spacing:"+ls+"'>"+label+"</div>";
  });
  var byYear = {};
  ARTS.forEach(function(a){ (byYear[a.y] = byYear[a.y]||[]).push(a); });
  var colsPerYear = Math.max(1, Math.min(4, Math.floor((PX-8)/14)));
  var maxRows = 0, maxCnt = 0;
  var yearMeta = {};
  Object.keys(byYear).forEach(function(y){
    var arr = byYear[y].slice().sort(function(a,b){return a.ts-b.ts;});
    var rows = Math.ceil(arr.length/colsPerYear);
    maxRows = Math.max(maxRows, rows);
    maxCnt = Math.max(maxCnt, arr.length);
    yearMeta[y] = {count:arr.length, rows:rows, arr:arr};
  });
  var H = BAND_H + HIST_H + 24 + maxRows*16 + 34;
  inner.style.width = W+"px";
  inner.style.height = H+"px";
  for(var y=Y0;y<=Y1;y++){
    var x = Math.round((y-Y0)*PX)+10;
    var ym = yearMeta[y];
    var cntHtml = (ym && PX>24) ? "<br><i style='font-style:normal;font-size:10px;color:#a8842c'>"+ym.count+"篇</i>" : "";
    h += "<div class='yearRow' style='left:"+x+"px;top:"+(BAND_H+HIST_H)+"px'><span>"+y+cntHtml+"</span></div>";
    if(ym){
      var bh = Math.max(6, Math.round(ym.count/maxCnt*(HIST_H-14)));
      var eraC = eraOfYear(y).color;
      h += "<div class='hbar' data-y='"+y+"' title='"+y+"年 "+ym.count+"篇' style='left:"+(x+3)+"px;width:"+(Math.max(8,PX-8))+"px;height:"+bh+"px;top:"+(BAND_H+HIST_H-6-bh)+"px;background:"+eraC+"'></div>";
    }
  }
  Object.keys(yearMeta).forEach(function(y){
    var ym = yearMeta[y];
    var baseX = Math.round((y-Y0)*PX)+10;
    var cols = Math.max(1, Math.min(4, Math.floor((PX-8)/14)));
    ym.arr.forEach(function(a, i){
      var col = i % cols, row = Math.floor(i/cols);
      var x = baseX + 3 + col*14;
      var top = BAND_H + HIST_H + 24 + row*16;
      h += "<div class='adot' data-id='"+a.id+"' data-y='"+y+"' style='left:"+x+"px;top:"+top+"px;background:"+VOLCOLOR[a.vol-1]+";box-shadow:0 0 0 1.5px "+VOLCOLOR[a.vol-1]+", 0 2px 5px var(--shadow)'></div>";
    });
  });
  inner.innerHTML = h;
  var tip = document.getElementById("tlTip");
  inner.querySelectorAll(".adot").forEach(function(d){
    var a = byId[d.getAttribute("data-id")];
    d.addEventListener("mousemove", function(ev){
      var wrap = document.querySelector(".tlwrap").getBoundingClientRect();
      tip.style.display="block";
      tip.innerHTML = "<div class='tt'>"+a.title+"</div><div class='td'>"+a.dateRaw.replace(/[（）()]/g,"")+" · "+a.place+" · "+a.event+"</div><div class='td' style='color:#e8c17a'>"+(a.why||"").slice(0,60)+"…</div>";
      tip.style.left = Math.min(ev.clientX-wrap.left+14, wrap.width-300)+"px";
      tip.style.top = Math.max(10, ev.clientY-wrap.top-20)+"px";
    });
    d.addEventListener("mouseleave", function(){ tip.style.display="none"; });
    d.addEventListener("click", function(){
      inner.querySelectorAll(".adot").forEach(function(x){x.classList.remove("sel");});
      d.classList.add("sel");
      setHash("#/art/"+a.id);
    });
  });
  inner.querySelectorAll(".hbar").forEach(function(b){
    b.addEventListener("click", function(){ setHash("#/year/"+b.getAttribute("data-y")); });
  });
  inner.querySelectorAll(".yearRow span").forEach(function(sp){
    sp.parentElement.style.pointerEvents = "auto";
    sp.style.cursor = "pointer";
    sp.addEventListener("click", function(){
      var y = parseInt(sp.textContent);
      setHash("#/year/"+y);
    });
  });
  inner.querySelectorAll(".eraBand").forEach(function(b){
    b.addEventListener("click", function(){
      var x0 = parseFloat(b.getAttribute("data-x"));
      document.getElementById("tlScroll").scrollTo({left:Math.max(0,x0-30), behavior:"smooth"});
    });
  });
  if(state.tlYear) renderYearPanel();
}
/* year detail panel */
var tlFirstShow = true;
function selectYear(y){
  state.tlYear = y;
  renderYearPanel();
}
function renderYearPanel(){
  var y = state.tlYear;
  var panel = document.getElementById("yearPanel");
  var arr = ARTS.filter(function(a){return a.y===y;}).sort(function(a,b){return a.ts-b.ts;});
  if(!arr.length){
    panel.innerHTML = "<div class='ypHead'><b>"+y+" 年</b><span class='ypCnt'>此年无收录篇目</span><a class='ypClose' id='ypClose'>收起 ×</a></div>";
  }else{
    var e = eraOfYear(y);
    var h = "<div class='ypHead'><b>"+y+" 年</b><span class='ypCnt'>"+arr.length+" 篇 · <i style='color:"+e.color+";font-style:normal'>"+esc(e.name)+"</i></span><a class='ypClose' id='ypClose'>收起 ×</a></div><div class='ypList'>";
    arr.forEach(function(a){
      h += "<div class='ypItem' data-id='"+esc(a.id)+"'>"+
        "<div class='ypT'>"+esc(a.title)+"</div>"+
        "<div class='ypD'>"+esc(a.dateRaw.replace(/[（）()]/g,"")+" · "+a.place)+"</div>"+
        "<div class='ypW'>"+esc((a.why||"").slice(0,52))+"…</div></div>";
    });
    h += "</div>";
    panel.innerHTML = h;
  }
  panel.classList.add("on");
  document.getElementById("ypClose").addEventListener("click", function(){
    panel.classList.remove("on"); state.tlYear = null;
    if(location.hash.indexOf("#/year/")===0) setHash("#/view/tl");
  });
  panel.querySelectorAll(".ypItem").forEach(function(it){
    it.addEventListener("click", function(){ setHash("#/art/"+it.getAttribute("data-id")); });
  });
}
document.getElementById("tlFit").addEventListener("click", function(){
  state.tlFit = true;
  this.classList.add("on");
  document.getElementById("tlScrollBtn").classList.remove("on");
  renderTimeline();
});
document.getElementById("tlScrollBtn").addEventListener("click", function(){
  state.tlFit = false;
  this.classList.add("on");
  document.getElementById("tlFit").classList.remove("on");
  renderTimeline();
});
window.addEventListener("resize", function(){ if(state.tlFit && state.view==="tl") renderTimeline(); });

/* ---------- GRAPH (lazy echarts) ---------- */
var graphChart = null, echartsReady = false, echartsLoading = false;
var graphVolFilter = {1:true,2:true,3:true,4:true,5:true};
var graphZoomTier = 0; /* 0=events+top nodes only, 1=medium, 2=all labels */
function ensureGraph(cb){
  if(echartsReady){ cb && cb(); return; }
  if(!echartsLoading){
    echartsLoading = true;
    var s = document.createElement("script");
    s.src = "assets/echarts.min.js";
    s.onload = function(){ echartsReady = true; initGraph(); cb && cb(); };
    s.onerror = function(){ echartsLoading = false; toast("图谱组件加载失败，可重试"); };
    document.head.appendChild(s);
  }
  /* poll until ready for concurrent callers */
  var waited = 0;
  var iv = setInterval(function(){
    if(echartsReady){ clearInterval(iv); cb && cb(); }
    else if(waited++ > 100){ clearInterval(iv); }
  }, 200);
}
function graphNodes(){
  var nodes = [], links = [];
  var minSize = graphZoomTier===0 ? 16 : (graphZoomTier===1 ? 11 : 6);
  ARTS.forEach(function(a){
    if(!graphVolFilter[a.vol]) return;
    nodes.push({id:a.id, name:a.title, symbolSize:Math.max(8, Math.min(26, 6+Math.sqrt(a.nChars)/3)),
      category:a.vol-1, value:a.nChars, aid:a.id, showLab: (6+Math.sqrt(a.nChars)/3) >= minSize,
      itemStyle:{color:VOLCOLOR[a.vol-1], borderColor:"rgba(245,239,224,.9)", borderWidth:1}});
  });
  var evCount = {};
  ARTS.forEach(function(a){ if(graphVolFilter[a.vol] && a.event && a.event!=="—" && a.event!=="-") evCount[a.event]=(evCount[a.event]||0)+1; });
  Object.keys(evCount).sort(function(a,b){return evCount[b]-evCount[a];}).forEach(function(ev){
    nodes.push({id:"ev:"+ev, name:ev, symbolSize:Math.max(10, Math.min(34, 8+evCount[ev]*3)), category:5,
      itemStyle:{color:"#a8842c", borderColor:"rgba(245,239,224,.9)", borderWidth:1.5}, isEvent:true, showLab:true});
  });
  var nodeIds = {}; nodes.forEach(function(n){ nodeIds[n.id]=1; });
  var edgeSeen = {};                            /* A06 */
  ARTS.forEach(function(a){
    if(!graphVolFilter[a.vol]) return;
    if(a.event && a.event!=="—" && a.event!=="-" && nodeIds["ev:"+a.event])
      links.push({source:a.id, target:"ev:"+a.event,
        lineStyle:{color:"rgba(168,132,44,.35)", width:1, curveness:.15}});
    (a.links||[]).forEach(function(t){
      var o = titleIndex[t];
      if(!o || o.id===a.id) return;
      var lo = a.id < o.id ? a.id : o.id, hi = a.id < o.id ? o.id : a.id;
      var k = lo + "|" + hi;
      if(edgeSeen[k]) return;                   /* A06: sorted-pair dedup, both directions */
      if(!nodeIds[lo] || !nodeIds[hi]) return;
      edgeSeen[k] = 1;
      links.push({source:a.id, target:o.id,
        lineStyle:{color:"rgba(176,58,46,.3)", width:1.2, curveness:.1}});
    });
  });
  return {nodes:nodes, links:links};
}
function initGraph(){
  graphChart = (graphChartRef = echarts.init(document.getElementById("graphChart")));
  var evCount = {};
  ARTS.forEach(function(a){ if(a.event && a.event!=="—" && a.event!=="-") evCount[a.event]=(evCount[a.event]||0)+1; });
  var g = graphNodes();
  graphChart.setOption({
    backgroundColor:"transparent",
    tooltip:{backgroundColor:"rgba(43,36,32,.92)", borderWidth:0,
      textStyle:{color:"#f5efe0",fontSize:13}, formatter:function(p){
        if(p.data.isEvent) return "<b style='color:#e8c17a'>"+p.name+"</b><br>相关文章 "+evCount[p.name]+" 篇";
        var a = byId[p.data.aid];
        return "<b style='color:#e8c17a'>"+a.title+"</b><br>"+a.dateRaw.replace(/[（）()]/g,"")+" · "+a.place;
      }},
    legend:{show:false},
    series:[{
      type:"graph", layout:"force", roam:true, draggable:true,
      force:{repulsion:130, edgeLength:[28,70], gravity:.08, friction:.25},
      label:{show:true, color:themeDark ? "#b3a689" : "#5a4f45", fontSize:10, fontFamily:"inherit",
        formatter:function(p){ return p.data.showLab ? (p.name.length>9 ? p.name.slice(0,9)+"…" : p.name) : ""; }},
      emphasis:{focus:"adjacency", label:{fontSize:12, color:"#b03a2e"}},
      lineStyle:{opacity:.5}, data:g.nodes, links:g.links,
      categories:[{name:"卷一"},{name:"卷二"},{name:"卷三"},{name:"卷四"},{name:"卷五"},{name:"事件"}]
    }]
  });
  graphChart.on("click", function(p){
    if(p.dataType==="node" && !p.data.isEvent) setHash("#/art/"+p.data.aid);
  });
  graphChart.on("dblclick", function(p){
    if(p.dataType==="node"){
      graphChart.dispatchAction({type:"highlight", dataIndex:p.dataIndex});
      toast("已高亮「"+(p.name.length>10?p.name.slice(0,10)+"…":p.name)+"」的邻域");
    }
  });
  graphChart.getZr().on("graphroam", function(){
    /* deepen label tier as user zooms in */
    var opt = graphChart.getOption();
    var zr = graphChart.getZr();
    var scale = (opt.series[0] && opt.series[0].zoom) || 1;
    var tier = scale > 1.8 ? 2 : (scale > 1.15 ? 1 : 0);
    if(tier !== graphZoomTier){
      graphZoomTier = tier;
      var g2 = graphNodes();
      graphChart.setOption({series:[{data:g2.nodes, links:g2.links}]});
    }
  });
  window.addEventListener("resize", function(){ graphChart && graphChart.resize(); });
  /* volume filter legend */
  document.querySelectorAll(".glegend .gv").forEach(function(el){
    el.addEventListener("click", function(){
      var v = parseInt(el.getAttribute("data-vol"));
      graphVolFilter[v] = !graphVolFilter[v];
      el.classList.toggle("off", !graphVolFilter[v]);
      var g2 = graphNodes();
      graphChart.setOption({series:[{data:g2.nodes, links:g2.links}]});
    });
  });
}

/* ---------- STATS view ---------- */
function renderStats(){
  var grid = document.getElementById("statsGrid");
  if(grid.dataset.done) return;
  grid.dataset.done = "1";
  /* top articles by length */
  var byLen = ARTS.slice().sort(function(a,b){return b.nChars-a.nChars;}).slice(0,15);
  var maxN = byLen[0].nChars;
  var h1 = "<div class='statCard'><h4>篇幅之最 · TOP 15</h4><div class='scSub'>正文字数（字）· 点条目直入全文</div>";
  byLen.forEach(function(a, i){
    var pct = Math.round(a.nChars/maxN*100);
    h1 += "<div class='srowBar' data-id='"+a.id+"'><span class='srb-rank'>"+(i+1)+"</span>"+
      "<div class='srb-track'><div class='srb-fill' style='width:"+pct+"%;background:"+VOLCOLOR[a.vol-1]+"'></div></div>"+
      "<span class='srb-t' title='"+a.title+"'>"+a.title+"</span>"+
      "<span class='srb-v'>"+a.nChars.toLocaleString()+" 字</span></div>";
  });
  h1 += "</div>";
  /* top places */
  var pc = {}; ARTS.forEach(function(a){ if(a.place) pc[a.place]=(pc[a.place]||0)+1; });
  var byPlace = Object.keys(pc).map(function(k){return [k,pc[k]];}).sort(function(a,b){return b[1]-a[1];}).slice(0,15);
  var maxP = byPlace[0][1];
  var h2 = "<div class='statCard'><h4>笔落之处 · 写作地点 TOP 15</h4><div class='scSub'>收录篇目数（篇）· 点条目看此地文章</div>";
  byPlace.forEach(function(x, i){
    var pct = Math.round(x[1]/maxP*100);
    h2 += "<div class='srowBar' data-place='"+x[0]+"'><span class='srb-rank'>"+(i+1)+"</span>"+
      "<div class='srb-track'><div class='srb-fill' style='width:"+pct+"%;background:var(--gold)'></div></div>"+
      "<span class='srb-t'>"+x[0]+"</span>"+
      "<span class='srb-v'>"+x[1]+" 篇</span></div>";
  });
  h2 += "</div>";
  /* top events */
  var ev = {}; ARTS.forEach(function(a){ if(a.event && a.event!=="—") ev[a.event]=(ev[a.event]||0)+1; });
  var byEv = Object.keys(ev).map(function(k){return [k,ev[k]];}).sort(function(a,b){return b[1]-a[1];}).slice(0,15);
  var maxE = byEv[0][1];
  var h3 = "<div class='statCard'><h4>风云际会 · 关联事件 TOP 15</h4><div class='scSub'>事件相关篇目数（篇）</div>";
  byEv.forEach(function(x, i){
    var pct = Math.round(x[1]/maxE*100);
    h3 += "<div class='srowBar'><span class='srb-rank'>"+(i+1)+"</span>"+
      "<div class='srb-track'><div class='srb-fill' style='width:"+pct+"%;background:var(--cinnabar)'></div></div>"+
      "<span class='srb-t' title='"+x[0]+"'>"+x[0]+"</span>"+
      "<span class='srb-v'>"+x[1]+" 篇</span></div>";
  });
  h3 += "</div>";
  /* volume overview */
  var vc = [0,0,0,0,0], vch = [0,0,0,0,0];
  ARTS.forEach(function(a){ vc[a.vol-1]++; vch[a.vol-1]+=a.nChars; });
  var maxV = Math.max.apply(null, vc);
  var h4 = "<div class='statCard'><h4>五卷纵览</h4><div class='scSub'>各卷收录篇数与总字数</div>";
  for(var i=0;i<5;i++){
    var pct = Math.round(vc[i]/maxV*100);
    h4 += "<div class='srowBar'><span class='srb-rank'>"+VOLNAME[i]+"</span>"+
      "<div class='srb-track'><div class='srb-fill' style='width:"+pct+"%;background:"+VOLCOLOR[i]+"'></div></div>"+
      "<span class='srb-v'>"+vc[i]+" 篇</span><span class='srb-v' style='min-width:80px'>"+(vch[i]/10000).toFixed(1)+" 万字</span></div>";
  }
  h4 += "</div>";
  grid.innerHTML = h1 + h2 + h3 + h4;
  grid.querySelectorAll("[data-id]").forEach(function(el){
    el.addEventListener("click", function(){ setHash("#/art/"+el.getAttribute("data-id")); });
  });
  grid.querySelectorAll("[data-place]").forEach(function(el){
    el.addEventListener("click", function(){ setHash("#/place/"+encodeURIComponent(el.getAttribute("data-place"))); });
  });
}

/* ---------- READER ---------- */
var FONT_SIZES = [17,19,21];
/* P03.1/P04.1: 校正显示结构 —— 语料是每行约 30 字的硬换行，直接按行渲染会碎成几百个短段。
   改为：连续行合并成自然段；小节标题单独成行；注释行归入注释块。
   同时**逐行保留锚点**（span id=pa-<artId>-<NNN>），旧切片 id 可直接换算，编号不变。 */
function fmtText(raw, artId){
  var lines = raw.split(/\n+/);
  var out = [], buf = [], head = 2, pi = 0;
  function pad(n){ return ("000" + n).slice(-3); }
  function anchor(inner){
    pi++;
    var id = artId ? "pa-" + artId + "-" + pad(pi) : "";
    var t = esc(inner);
    if(!id) return t;
    return "<span class='pa' id='" + id + "' data-pi='" + pi + "'>" + t + "</span>";
  }
  function flushPara(){
    if(!buf.length) return;
    out.push("<p>" + buf.join("") + "</p>");
    buf = [];
  }
  for(var i=0;i<lines.length;i++){
    var t = lines[i].trim();
    if(!t) continue;
    /* 卷首标题/成文日期 */
    if(head>0 && (t.indexOf("一九")===0 || /^[（(].*[）)]$/.test(t) || t.length <= 20)){
      flushPara();
      out.push("<p class='note artFirst' style='text-align:center;text-indent:0'>" + anchor(t) + "</p>");
      head--;
      continue;
    }
    /* 小节标题：一　二　三… / （一） / 1. */
    if(/^[一二三四五六七八九十]+[、．\s　]/.test(t) && t.length <= 30){
      flushPara();
      out.push("<h3 class='artH'>" + anchor(t) + "</h3>");
      continue;
    }
    /* 注释行 */
    if(/^(\*|〔\d+〕|注[:：])/.test(t) && out.length > 3){
      flushPara();
      out.push("<p class='note artNote'>" + anchor(t) + "</p>");
      continue;
    }
    buf.push(anchor(t));            /* 合并进行中段落：不加分隔符（中文直接连写） */
  }
  flushPara();
  return out.join("");
}
function loadReadMem(){
  try{ return JSON.parse(localStorage.getItem("mx_read")||"{}"); }catch(e){ return {}; }
}
function storeReadMem(mem){
  try{ localStorage.setItem("mx_read", JSON.stringify(mem)); return true; }
  catch(e){ toast("本地保存失败：浏览器存储不可用或已满"); return false; }
}
function restoreScroll(id){
  var v = loadReadMem()[id];
  if(Object.prototype.toString.call(v) === "[object Array]") return v[0] || 0;  /* new [top, ts] */
  if(typeof v === "number") return v;                                            /* legacy plain number */
  return 0;
}
function saveScroll(id, top){
  var mem = loadReadMem();
  mem[id] = [top, Date.now()];                 /* A04: evict by access time, not depth */
  var ks = Object.keys(mem);
  if(ks.length > 60){
    ks.sort(function(a,b){ return (mem[a][1]||0) - (mem[b][1]||0); });
    for(var i=0;i<ks.length-60;i++) delete mem[ks[i]];
  }
  storeReadMem(mem);
}
function buildToc(){
  var toc = [];
  var v = document.getElementById("view-read");
  v.querySelectorAll(".artText h3.artH").forEach(function(h, i){
    var t = h.textContent.trim();
    var a = h.querySelector(".pa");
    var id = a && a.id ? a.id : ("para-"+i);
    if(!a || !a.id){ if(h.id) id = h.id; }
    toc.push({id:id, text:t.slice(0,26)});
  });
  return toc;
}
/* ---------- D01: local bookmarks & recent reads (this browser only) ---------- */
function getBookmark(id){
  try{ return !!JSON.parse(localStorage.getItem("mx_marks")||"{}")[id]; }catch(e){ return false; }
}
function toggleBookmark(id){
  var m = {};
  try{ m = JSON.parse(localStorage.getItem("mx_marks")||"{}"); }catch(e){}
  if(m[id]) delete m[id]; else m[id] = Date.now();
  try{
    localStorage.setItem("mx_marks", JSON.stringify(m));
    return !!m[id];
  }catch(e){
    toast("收藏保存失败：本地存储不可用");
    return !!JSON.parse(localStorage.getItem("mx_marks")||"{}")[id];
  }
}
function markRecent(id){
  try{
    var r = JSON.parse(localStorage.getItem("mx_recent")||"{}");
    r[id] = Date.now();
    var ks = Object.keys(r).sort(function(a,b){ return r[a]-r[b]; });
    while(ks.length > 30) delete r[ks.shift()];
    localStorage.setItem("mx_recent", JSON.stringify(r));
  }catch(e){}
}
function lastReadArticle(){
  /* last SUCCESSFULLY opened, preferring mx_recent recency */
  var best = null, bestTs = -1;
  try{
    var r = JSON.parse(localStorage.getItem("mx_recent")||"{}");
    Object.keys(r).forEach(function(k){ if(r[k]>bestTs && byId[k]){ bestTs=r[k]; best=byId[k]; } });
  }catch(e){}
  return best;
}

var articleSeq = 0;
var lastOpenedId = null;          /* D01: last SUCCESSFULLY rendered article */
/* ---------- P03.1/P03.2: 段落锚点定位 ----------
   新锚点 pa-<artId>-<NNN> 由渲染时生成，直接按 id 定位（稳定、不依赖文本）。
   旧样本切片 id p<artId>-<NNN>（如 pv1n03-033）保留原编号，通过 1:1 索引映射到
   渲染自然段（已对账：v1n03 234/234、v1n04 645/645，字符数逐字一致）。
   若某篇段落数与样本不一致 → 退回"唯一文本包含"匹配；仍不唯一则明确提示，不猜选。 */
var __sampleTopicCache = null;
function _domParas(view){
  return Array.prototype.slice.call(view.querySelectorAll(".artText > p"));
}
function _highlightPara(view, elP){
  if(!elP) return;
  elP.style.transition = "background .8s";
  elP.style.background = "rgba(176,58,46,.18)";
  elP.style.borderRadius = "2px";
  setTimeout(function(){ elP.style.background = ""; }, 2500);
  try{ elP.scrollIntoView({ block: "center", behavior: "smooth" }); }
  catch(e){ view.scrollTo({ top: elP.offsetTop - 70, behavior: "smooth" }); }
}
/* P03.2: 旧切片 id pv1n03-033 ↔ 新锚点 pa-v1n03-033（编号一致，直接换算） */
function _paIdOf(paraId){
  var m = /^p(v\d+n\d+)-(\d+)$/.exec(paraId);
  if(!m) return null;
  return "pa-" + m[1] + "-" + ("000" + parseInt(m[2], 10)).slice(-3);
}
function scrollToPara(view, paraId){
  var targetId = /^pa-v\d+n\d+-\d+$/.test(paraId) ? paraId : _paIdOf(paraId);
  if(!targetId){ toast("段落链接格式无法识别"); return false; }
  var el = document.getElementById(targetId);
  if(el){ _highlightPara(view, el); return true; }
  /* 兜底：按样本文本唯一匹配（不猜选） */
  var m = /^p(v\d+n\d+)-(\d+)$/.exec(paraId);
  if(!m){ toast("页面上不存在该段落锚点：" + paraId); return false; }
  var artId = m[1], seq = parseInt(m[2], 10);
  var norm = function(s){ return (s || "").replace(/\s+/g, ""); };
  var applyText = function(paras){
    var p = (paras || []).filter(function(x){ return x.id === paraId; })[0];
    if(!p || !p.text){ toast("样本数据中未找到该段落"); return false; }
    var key = norm(p.text);
    var spans = Array.prototype.slice.call(view.querySelectorAll(".artText .pa"));
    var hit = spans.filter(function(s){ return norm(s.textContent) === key; });
    if(hit.length === 1){ _highlightPara(view, hit[0]); return true; }
    if(hit.length > 1){ toast("该段文本在正文中出现 " + hit.length + " 处，无法唯一定位，请按第 " + seq + " 段查找。"); return false; }
    toast("正文与该段数据不一致，已按第 " + seq + " 段换算仍未命中，请按编号查找。");
    return false;
  };
  if(__sampleTopicCache){
    var a2 = __sampleTopicCache.articles && __sampleTopicCache.articles[artId];
    return applyText(a2 && a2.paragraphs);
  }
  fetch("data/sample-topic.json").then(function(r){ return r.json(); }).then(function(j){
    __sampleTopicCache = j;
    var a3 = j.articles && j.articles[artId];
    applyText(a3 && a3.paragraphs);
  }).catch(function(){ toast("段落定位失败：样本数据不可用"); });
  return null;
}
function openArticle(id, fromRoute, anchorPara){
  var a = byId[id];
  if(!a){ toast("未找到该篇文章"); setHash("#/view/cats"); return; }
  /* save previous article scroll before switching (A04) */
  if(state.curArt){
    var vPrev = document.getElementById("view-read");
    if(vPrev) saveScroll(state.curArt.id, vPrev.scrollTop);
  }
  state.curArt = a;
  document.getElementById("navRead").style.display="";
  var v = document.getElementById("view-read");
  var seq = ++articleSeq;
  v.innerHTML = "<div class='readLoad'>正在载入《"+esc(a.title)+"》…</div>";
  v.scrollTop = 0;
  show("read");
  document.title = a.title + " · 毛泽东选集";
  if(!fromRoute) setHash("#/art/"+id);
  fetch("data/texts/"+id+".txt").then(function(r){
    if(!r.ok) throw new Error("HTTP "+r.status);
    return r.text();
  }).then(function(txt){
    if(seq !== articleSeq) return;              /* stale response: drop */
    if(state.curArt !== a) return;
    lastOpenedId = a.id;                        /* only on success */
    markRecent(a.id);
    var idx = txt.indexOf("\n\n");
    var body = idx>0 ? txt.slice(idx+2) : txt;
    var links = (a.links||[]).filter(function(t){return titleIndex[t];});
    var fs = parseInt(String(localStorage.getItem("mx_font")||"0"), 10);
    if(!(fs===0||fs===1||fs===2)) fs = 0;      /* A04: sanitize */
    var isMarked = !!getBookmark(a.id);
    var h = "<div id='readProg'></div><div class='readTools'><span class='rtTitle'>"+esc(a.title)+"</span>"+
      "<span class='fsGrp'><button data-fs='0' class='"+(fs===0?"on":"")+"'>小</button><button data-fs='1' class='"+(fs===1?"on":"")+"'>中</button><button data-fs='2' class='"+(fs===2?"on":"")+"'>大</button></span>"+
      "<button id='rtMark' class='"+(isMarked?"on":"")+"'>"+(isMarked?"★ 已收藏":"☆ 收藏")+"</button>"+
      "<button id='rtToc'>目录</button><button id='rtShare'>复制链接</button>"+
      "<button id='rtNotes'>笔记"+(notesFor(a.id).length?" ("+notesFor(a.id).length+")":"")+"</button>"+
      ((function(){ var ob = originBack() || (anchorPara ? { label:"← 返回专题", hash:"#/view/topic" } : null);
        return ob ? "<button id='rtBackOrigin' class='rtBack'>"+ob.label+"</button>" : ""; })())+
      "</div>"+
      "<div id='notePanel' class='notePanel' style='display:none'></div>"+
      "<div id='selBar' class='selBar' style='display:none'>"+
        "<span class='sbTxt' id='sbTxt'></span>"+
        "<button data-sa='quote'>摘录</button>"+
        "<button data-sa='note'>写笔记</button>"+
        "<button data-sa='link'>复制段链接</button>"+
        "<button data-sa='ask'>解释此段</button>"+
      "</div>"+
      "<div class='readWrap'><div class='readHead'><div class='vol'>《毛泽东选集》第"+["一","二","三","四","五"][a.vol-1]+"卷</div>"+
      "<h2>"+esc(a.title)+"</h2><div class='date'>"+esc(a.dateRaw.replace(/[（）()]/g,""))+"</div></div>"+
      "<div class='ctxCard'><h4>写作背景 · 本站整理</h4><p>"+esc(a.why||"（待考）")+"</p>"+
      "<div class='ctxMeta'>"+
      "<span>地点 <b>"+esc(a.place)+"</b></span>"+
      "<span>时期 <b>"+esc(a.era)+"</b></span>"+
      "<span>关联事件 <b>"+esc(a.event)+"</b></span>"+
      "<span>篇幅 <b>"+a.nChars+" 字</b></span>"+
      "</div></div>"+
      (links.length? "<div class='linkArts'><h4>关联文章 · 本站推荐</h4><div class='lks'>"+
        links.map(function(t){return "<a data-id='"+esc(titleIndex[t].id)+"'>"+esc(t)+"</a>";}).join("")+
        "</div></div>":"")+
      "<div class='artText' style='font-size:"+FONT_SIZES[fs]+"px'>"+fmtText(body, a.id)+"</div>";
    var prev = ARTS[ARTS.indexOf(a)-1], next = ARTS[ARTS.indexOf(a)+1];
    h += "<div class='readNav'>"+
      (prev? "<a data-id='"+esc(prev.id)+"'>← 前篇 · "+esc(prev.title)+"</a>":"<span></span>")+
      (next? "<a data-id='"+esc(next.id)+"'>后篇 · "+esc(next.title)+" →</a>":"")+
      "</div></div>";
    v.innerHTML = h;
    v.querySelectorAll("[data-id]").forEach(function(el){
      el.addEventListener("click", function(){ setHash("#/art/"+el.getAttribute("data-id")); });
    });
    /* font size controls */
    v.querySelectorAll("[data-fs]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var f = parseInt(btn.getAttribute("data-fs"));
        try{ localStorage.setItem("mx_font", ""+f); }catch(e){}
        v.querySelectorAll("[data-fs]").forEach(function(x){x.classList.remove("on");});
        btn.classList.add("on");
        var at = v.querySelector(".artText");
        if(at) at.style.fontSize = FONT_SIZES[f]+"px";
      });
    });
    /* toc drawer */
    var toc = buildToc();
    var tocEl = document.getElementById("readToc");
    var tl = document.getElementById("tocList");
    if(toc.length){
      tl.innerHTML = toc.map(function(t){ return "<li data-t='"+t.id+"'>"+esc(t.text)+"</li>"; }).join("");
    }else{
      tl.innerHTML = "<li style='color:var(--ink2);cursor:default'>本篇为短文，无小节目录</li>";
    }
    tl.querySelectorAll("[data-t]").forEach(function(li){
      li.addEventListener("click", function(){
        var p = document.getElementById(li.getAttribute("data-t"));
        if(p){
          v.scrollTo({top: p.offsetTop - 70, behavior:"smooth"});
          tocEl.classList.remove("on");
          document.getElementById("tocMask").classList.remove("on");
        }
      });
    });
    var rtToc = document.getElementById("rtToc");
    if(rtToc) rtToc.addEventListener("click", function(){
      tocEl.classList.add("on");
      document.getElementById("tocMask").classList.add("on");
    });
    /* share */
    var rtShare = document.getElementById("rtShare");
    if(rtShare) rtShare.addEventListener("click", function(){
      var url = location.origin + location.pathname + "#/art/" + a.id;
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(url).then(function(){ toast("链接已复制：" + a.title); },
          function(){ toast(url); });
      }else{
        toast(url);
      }
    });
    /* P03.3: 统一来源感知返回（检索/专题/书房/目录/研究室），无来源则不显示按钮 */
    var rtOrig = document.getElementById("rtBackOrigin");
    if(rtOrig) rtOrig.addEventListener("click", function(){
      var ob = originBack();
      if(!ob) return;
      if(ob.href) location.href = ob.href;
      else if(ob.hash) setHash(ob.hash);
    });
    /* P03.4: 摘录 / 写笔记 / 复制段链接 / 解释此段（全部不需要 AI 也能完成） */
    initNoteTools(v, a, anchorPara);
    /* restore reading position */
    var saved = restoreScroll(id);
    v.scrollTop = saved;
    if(saved > 40) toast("已回到上次阅读位置");
    /* WP06: paragraph anchor (#/art/<id>/<paraId>) — fetch sample-topic.json once, locate by text */
    if(anchorPara){
      scrollToPara(v, anchorPara);
    }
    /* A04: also persist on page hide so the last meaningful position survives reload */
    window.addEventListener("pagehide", onPageHide);
    track("article_open", {articleId:a.id});
    var rtMark = document.getElementById("rtMark");
    if(rtMark) rtMark.addEventListener("click", function(){
      var now = toggleBookmark(a.id);
      rtMark.classList.toggle("on", now);
      rtMark.textContent = now ? "★ 已收藏" : "☆ 收藏";
      track("bookmark_toggle", {articleId:a.id, newState:now});
      toast(now ? "已收藏《"+a.title+"》" : "已取消收藏");
    });
  }).catch(function(err){
    if(seq !== articleSeq) return;              /* stale failure: drop */
    if(state.curArt !== a) return;
    v.innerHTML = "<div class='readErr'><h3>《"+esc(a.title)+"》加载失败</h3>"+
      "<p>"+esc(String(err && err.message || err))+"</p>"+
      "<button class='retryBtn' id='retryArt'>重试</button> "+
      "<a href='#/view/cats'>返回目录</a></div>";
    var rb = document.getElementById("retryArt");
    if(rb) rb.addEventListener("click", function(){ openArticle(id, true); });
    track("article_error", {articleId:id, code:String(err&&err.message||err).slice(0,60)});
  });
}
/* reading progress bar + scroll memory (A04: lookup prog each event; DOM is rebuilt per article) */
function onPageHide(){
  var v = document.getElementById("view-read");
  if(state.curArt && v && state.view==="read") saveScroll(state.curArt.id, v.scrollTop);
}
(function(){
  var v = document.getElementById("view-read");
  var lastSave = 0;
  v.addEventListener("scroll", function(){
    var prog = document.getElementById("readProg");
    if(!prog) return;
    var max = v.scrollHeight - v.clientHeight;
    if(max <= 0){ prog.style.width = "100%"; return; }
    prog.style.width = Math.round(v.scrollTop/max*100) + "%";
    var now = Date.now();
    if(state.curArt && now - lastSave > 1200){
      lastSave = now;
      saveScroll(state.curArt.id, v.scrollTop);
    }
  });
})();
/* keyboard: arrows for prev/next article, esc to close toc */
function typingInField(){
  var el = document.activeElement;
  if(!el) return false;
  var tag = el.tagName;
  return tag==="INPUT" || tag==="TEXTAREA" || tag==="SELECT" || el.isContentEditable;
}
document.addEventListener("keydown", function(e){
  if(typingInField()) return;                   /* A08 */
  if(state.view!=="read" || !state.curArt) {
    if(e.key==="Escape"){
      document.getElementById("readToc").classList.remove("on");
      document.getElementById("tocMask").classList.remove("on");
    }
    return;
  }
  if(e.key==="ArrowLeft" || e.key==="ArrowRight"){
    var i = ARTS.indexOf(state.curArt);
    var j = e.key==="ArrowLeft" ? i-1 : i+1;
    if(j>=0 && j<ARTS.length) setHash("#/art/"+ARTS[j].id);
  }
  if(e.key==="Escape"){
    document.getElementById("readToc").classList.remove("on");
    document.getElementById("tocMask").classList.remove("on");
  }
});
/* toc close handlers */
document.querySelector("#readToc .tocClose").addEventListener("click", function(){
  document.getElementById("readToc").classList.remove("on");
  document.getElementById("tocMask").classList.remove("on");
});
document.getElementById("tocMask").addEventListener("click", function(){
  document.getElementById("readToc").classList.remove("on");
  document.getElementById("tocMask").classList.remove("on");
});

/* ---------- SEARCH (tiered) ---------- */
var textCache = {}, textLoaded = false, textLoading = false;
var textCbs = [];
function preloadTexts(cb){
  if(cb) textCbs.push(cb);
  if(textLoaded){ flushTextCbs(); return; }
  if(textLoading) return;               /* later callers queued, never dropped */
  textLoading = true;
  var pending = ARTS.length;
  textLoadFail = 0;
  ARTS.forEach(function(a){
    if(textCache[a.id]){ pending--; if(!pending) finishTextLoad(); return; }
    fetch("data/texts/"+a.id+".txt").then(function(r){
      if(!r.ok) throw new Error("HTTP "+r.status);
      return r.text();
    }).then(function(t){
      textCache[a.id]=t;
    }).catch(function(){ textLoadFail++; }).then(function(){
      pending--;
      if(!pending) finishTextLoad();
    });
  });
}
var textLoadFail = 0;
function finishTextLoad(){
  textLoaded = true;
  textLoading = false;
  flushTextCbs();
}
function flushTextCbs(){
  var cbs = textCbs; textCbs = [];
  cbs.forEach(function(cb){ try{ cb(); }catch(e){} });
}
/* ---------- F01: unified analytics interface (NOT WIRED: no receiver configured) ----------
   Events: page_view{pageType}, article_open{articleId}, article_error{articleId,code},
           bookmark_toggle{articleId,newState}, search_result_open{resultType}
   Never sends note text, search query, article body or any personal field.
   Status: UNWIRED - set window.MX_ANALYTICS_ENDPOINT to enable. */
var MX_EVENTS = {page_view:["pageType"], article_open:["articleId"], article_error:["articleId","code"],
  bookmark_toggle:["articleId","newState"], search_result_open:["resultType"],
  /* P07.3: 有据研读与成果事件 (只上报 id 与长度, 不上报问题/笔记正文) */
  note_save:["kind","articleId","len"], topic_read_open:["topicId","stepId"],
  topic_step_done:["topicId","stepId","state"], topic_conclusion_save:["topicId","chars","citations"],
  topic_conclusion_blocked:["topicId","gapCount"]};
var trackSeq = {};
function track(ev, props){
  if(!MX_EVENTS[ev]) return;
  var p = {};
  (MX_EVENTS[ev]||[]).forEach(function(k){ if(props && props[k]!=null) p[k]=props[k]; });
  if(!window.MX_ANALYTICS_ENDPOINT){
    if(window.console && console.debug) console.debug("[track:unwired]", ev, p);
    return;
  }
  try{
    var key = ev + ":" + (p.articleId || p.pageType || "");
    var now = Date.now();
    if(trackSeq[key] && now - trackSeq[key] < 3000) return;  /* dedupe burst */
    trackSeq[key] = now;
    var body = JSON.stringify({event:ev, props:p, ts:now, ref:document.referrer || ""});
    if(navigator.sendBeacon) navigator.sendBeacon(window.MX_ANALYTICS_ENDPOINT, body);
    else fetch(window.MX_ANALYTICS_ENDPOINT, {method:"POST", body:body, keepalive:true}).catch(function(){});
  }catch(e){}
}

var searchSeq = 0;
/* P02.3: 最近一次检索词（仅存在本机会话，用于"返回检索"） */
function lastQuery(){
  try{ return sessionStorage.getItem("mx_lastQuery") || ""; }catch(e){ return ""; }
}
/* P02.3: 结果按来源分区 —— 原文命中 / 标题命中 / 背景资料命中（非原文），并保留检索上下文 */
function doSearch(q){
  if(!q || q.length<2){ show("map"); return; }
  var seq = ++searchSeq;
  try{ sessionStorage.setItem("mx_lastQuery", q); }catch(e){}
  var res = document.getElementById("view-search");
  var byTitle = [], byEnrich = [];
  ARTS.forEach(function(a){
    if(a.title.indexOf(q)>=0){ byTitle.push(a); return; }
    if((a.why||"").indexOf(q)>=0 || (a.event||"").indexOf(q)>=0 || a.place.indexOf(q)>=0) byEnrich.push(a);
  });
  var h = "<div class='seStats' id='seStats'>标题命中 " + byTitle.length + " 篇 · 背景资料命中 " + byEnrich.length +
          " 篇（非原文）· 全文检索中…</div>" +
          "<div class='seSec'><h4>原文命中 <span id='seFullCnt'>检索中…</span></h4><ul class='sres' id='seFull'></ul></div>" +
          "<div class='seSec'><h4>标题命中 <span>" + byTitle.length + "</span></h4><ul class='sres' id='seTitle'></ul></div>";
  if(byEnrich.length){
    h += "<div class='seSec'><h4>背景资料命中（站点富化信息，非原文） <span>" + byEnrich.length + "</span></h4><ul class='sres' id='seEnrich'></ul></div>";
  }
  res.innerHTML = h;
  var tUl = document.getElementById("seTitle");
  var eUl = document.getElementById("seEnrich");
  if(tUl) tUl.innerHTML = byTitle.map(function(a){
    return srow(a, hl(esc(a.title), q), esc(a.dateRaw.replace(/[（）()]/g,"") + " · " + a.place + " · " + a.event), "", q);
  }).join("");
  if(eUl) eUl.innerHTML = byEnrich.map(function(a){
    return srow(a, esc(a.title), esc(a.dateRaw.replace(/[（）()]/g,"") + " · " + a.place), esc(a.why || a.event || ""), q);
  }).join("");
  bindSearchRows(res);
  show("search");
  track("page_view", {pageType:"search"});
  /* async full-text pass → 原文命中 分区 */
  preloadTexts(function(){
    if(seq !== searchSeq) return;              /* a newer query started: discard */
    if(document.getElementById("q").value.trim() !== q) return;
    var ul = document.getElementById("seFull");
    if(!ul) return;
    var seenIds = {}; byTitle.forEach(function(a){seenIds[a.id]=1;}); byEnrich.forEach(function(a){seenIds[a.id]=1;});
    var rows = "", fullHits = 0;
    ARTS.forEach(function(a){
      if(seenIds[a.id]) return;
      var t = textCache[a.id];
      if(!t) return;
      var i = t.indexOf(q);
      if(i<0) return;
      fullHits++;
      var s = Math.max(0, i-40);
      var frag = esc(t.slice(s, i+70).replace(/\n/g," "));
      rows += srow(a, esc(a.title), esc(a.dateRaw.replace(/[（）()]/g,"") + " · " + a.place), frag, q);
    });
    ul.innerHTML = rows;
    var cnt = document.getElementById("seFullCnt");
    if(cnt) cnt.textContent = fullHits + " 篇";
    var st = document.getElementById("seStats");
    var msg = "原文命中 " + fullHits + " 篇 · 标题命中 " + byTitle.length + " 篇 · 背景资料命中 " + byEnrich.length + " 篇（非原文）";
    if(textLoadFail>0) msg += " · 有 " + textLoadFail + " 篇正文加载失败，结果可能不完整";
    if(st) st.textContent = msg;
    if(!byTitle.length && !byEnrich.length && !fullHits){
      res.innerHTML = "<div class='statePanel'><h2>没有检出相关篇章</h2><p>「" + esc(q) + "」在标题、背景资料与全部正文中均未命中。</p>" +
        "<div class='acts'><a href='#/view/cats'>浏览全部篇目</a><a class='ghost' href='#/view/topic'>从一份专题开始</a></div>" +
        "<div class='note'>换个更短的关键词，或先按卷浏览目录。</div></div>";
      return;
    }
    bindSearchRows(res);
  });
}
/* ---------- P03.4: 本地摘录 / 笔记（不依赖 AI，全部本机存储） ---------- */
var NOTES_KEY = "mx_notes";
function loadNotes(){
  try{ var x = JSON.parse(localStorage.getItem(NOTES_KEY) || "[]"); return Array.isArray(x) ? x : []; }
  catch(e){ return []; }
}
function saveNotes(list){
  try{ localStorage.setItem(NOTES_KEY, JSON.stringify(list)); return true; }
  catch(e){ toast("笔记保存失败：本地存储不可用或空间不足"); return false; }
}
function notesFor(artId){
  return loadNotes().filter(function(n){ return n.articleId === artId; });
}
function addNote(rec){
  var list = loadNotes();
  rec.id = "n" + Date.now() + "_" + Math.floor(Math.random() * 1000);
  rec.createdAt = Date.now();
  list.push(rec);
  return saveNotes(list) ? rec : null;
}
function delNote(id){
  saveNotes(loadNotes().filter(function(n){ return n.id !== id; }));
}
function initNoteTools(view, a, anchorPara){
  var bar = document.getElementById("selBar");
  var panel = document.getElementById("notePanel");
  var rtNotes = document.getElementById("rtNotes");
  var cur = { text: "", paraId: "" };

  function paraOf(node){
    var el = node && node.nodeType === 1 ? node : (node && node.parentElement);
    while(el && el !== view){
      if(el.id && el.id.indexOf("pa-") === 0) return el;   /* P03.4: 锚点 span 即"段" */
      el = el.parentElement;
    }
    return null;
  }
  function hideBar(){ if(bar) bar.style.display = "none"; }
  function markPara(el){
    if(el) { el.classList.add("hasNote"); el.setAttribute("data-note", "1"); }
  }
  function copyText(t){
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(t).then(function(){ toast("已复制"); }, function(){ toast(t); });
    } else { toast(t); }
  }
  function askThisPara(){
    if(a.id === "v1n03" || a.id === "v1n04"){
      setOrigin({ type:"research", art:a.id });
      location.href = "research.html?art=" + encodeURIComponent(a.id) +
        (cur.paraId ? "&para=" + encodeURIComponent(cur.paraId) : "") + "&from=art:" + encodeURIComponent(a.id);
    } else {
      toast("该篇不在 AI 可问范围（目前仅两篇原文）；可先写下自己的笔记，不影响阅读。");
    }
  }
  function showEditor(quote){
    if(!panel) return;
    panel.style.display = "block";
    panel.textContent = "";
    var hd = document.createElement("div"); hd.className = "npHd"; hd.textContent = "写下自己的理解";
    panel.appendChild(hd);
    if(quote){
      var q = document.createElement("div"); q.className = "npQ"; q.textContent = "「" + quote + "」";
      panel.appendChild(q);
    }
    var ta = document.createElement("textarea");
    ta.rows = 4;
    ta.placeholder = "用你自己的话写：这段说了什么？依据是什么？哪些条件下才成立？";
    panel.appendChild(ta);
    var row = document.createElement("div"); row.className = "npRow";
    var ok = document.createElement("button"); ok.textContent = "保存笔记";
    var cancel = document.createElement("button"); cancel.className = "ghost"; cancel.textContent = "取消";
    row.appendChild(ok); row.appendChild(cancel);
    panel.appendChild(row);
    ok.addEventListener("click", function(){
      var v2 = ta.value.trim();
      if(!v2){ toast("笔记为空，未保存"); return; }
      var rec = addNote({
        kind: "note", articleId: a.id, paraId: cur.paraId, quote: quote || "",
        note: v2,
        source: { title: a.title, vol: a.vol, dateRaw: a.dateRaw, place: a.place }
      });
      if(rec){
        markPara(cur.paraId ? document.getElementById(cur.paraId) : null);
        panel.style.display = "none";
        renderPanel();
        updateCount();
        track("note_save", { kind: "note", articleId: a.id, len: v2.length });
      }
    });
    cancel.addEventListener("click", function(){ panel.style.display = "none"; });
    ta.focus();
  }
  function updateCount(){
    if(!rtNotes) return;
    var n = notesFor(a.id).length;
    rtNotes.textContent = "笔记" + (n ? " (" + n + ")" : "");
  }
  function renderPanel(){
    if(!panel) return;
    var list = notesFor(a.id);
    panel.textContent = "";
    panel.style.display = "block";
    if(!list.length){
      var d = document.createElement("div"); d.className = "npEmpty";
      d.textContent = "本篇还没有摘录或笔记。选中正文任意一段，即可摘录、写笔记或复制段链接。";
      panel.appendChild(d);
      return;
    }
    var hd = document.createElement("div"); hd.className = "npHd";
    hd.textContent = "本篇摘录与笔记（" + list.length + "）";
    panel.appendChild(hd);
    list.slice().reverse().forEach(function(n){
      var it = document.createElement("div"); it.className = "npItem";
      var top = document.createElement("div"); top.className = "npTop";
      var kind = document.createElement("span"); kind.className = "npKind";
      kind.textContent = n.kind === "quote" ? "摘录" : "笔记";
      var time = document.createElement("span"); time.className = "npTime";
      try{ time.textContent = new Date(n.createdAt).toLocaleString(); }catch(e){}
      top.appendChild(kind); top.appendChild(time);
      it.appendChild(top);
      if(n.quote){
        var q = document.createElement("div"); q.className = "npQ"; q.textContent = "「" + n.quote.slice(0, 160) + "」";
        it.appendChild(q);
      }
      if(n.note){
        var nt = document.createElement("div"); nt.className = "npNote"; nt.textContent = n.note;
        it.appendChild(nt);
      }
      var row = document.createElement("div"); row.className = "npRow";
      if(n.paraId){
        var jump = document.createElement("button"); jump.textContent = "定位到本段";
        jump.addEventListener("click", function(){
          var el = document.getElementById(n.paraId);
          if(el){ _highlightPara(view, el); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
          else { toast("该段落不在当前渲染范围内"); }
        });
        row.appendChild(jump);
      }
      var del = document.createElement("button"); del.className = "ghost"; del.textContent = "删除";
      del.addEventListener("click", function(){
        delNote(n.id);
        renderPanel();
        updateCount();
        toast("已删除");
      });
      row.appendChild(del);
      it.appendChild(row);
      panel.appendChild(it);
    });
  }

  /* 选中正文 → 浮动操作条 */
  function onSel(){
    var sel = window.getSelection();
    if(!sel || sel.isCollapsed){ hideBar(); return; }
    var txt = String(sel).trim();
    if(txt.length < 2){ hideBar(); return; }
    var p = paraOf(sel.anchorNode);
    if(!p){
      /* 兜底：按选区与实际锚点 span 的相交关系定位（浏览器锚点/焦点差异下更稳） */
      try{
        var rng0 = sel.getRangeAt(0);
        var hitSpan = Array.prototype.slice.call(view.querySelectorAll(".artText .pa")).filter(function(sp){
          try{ return rng0.intersectsNode(sp); }catch(e){ return false; }
        });
        p = hitSpan[0] || null;
      }catch(e){}
    }
    if(!p){ hideBar(); return; }
    cur.text = txt.slice(0, 600);
    cur.paraId = p.id || "";
    if(bar){
      var r = sel.getRangeAt(0).getBoundingClientRect();
      bar.style.display = "flex";
      bar.style.left = Math.max(8, Math.min(window.innerWidth - 320, r.left)) + "px";
      bar.style.top = Math.max(8, r.top - 46) + "px";
      var sb = document.getElementById("sbTxt");
      if(sb) sb.textContent = cur.text.slice(0, 20) + (cur.text.length > 20 ? "…" : "");
    }
  }
  view.addEventListener("mouseup", function(){ setTimeout(onSel, 10); });
  view.addEventListener("touchend", function(){ setTimeout(onSel, 10); });
  document.addEventListener("keydown", function(e){
    if(e.key === "Escape"){ hideBar(); if(panel) panel.style.display = "none"; }
  });

  if(bar){
    bar.addEventListener("click", function(e){
      var btn = e.target && e.target.getAttribute ? e.target : null;
      var act = btn && btn.getAttribute("data-sa");
      if(!act) return;
      if((act === "quote" || act === "note") && !cur.text){ toast("请先在正文中选中一段文字"); hideBar(); return; }
      var pEl = cur.paraId ? document.getElementById(cur.paraId) : null;
      if(act === "quote"){
        if(addNote({
          kind: "quote", articleId: a.id, paraId: cur.paraId, quote: cur.text,
          source: { title: a.title, vol: a.vol, dateRaw: a.dateRaw, place: a.place }
        })){
          markPara(pEl); updateCount(); renderPanel();
          track("note_save", { kind: "quote", articleId: a.id, len: cur.text.length });
        }
        hideBar(); try{ window.getSelection().removeAllRanges(); }catch(e2){}
      } else if(act === "note"){
        showEditor(cur.text);
        hideBar();
      } else if(act === "link"){
        copyText(location.origin + location.pathname + "#/art/" + a.id + (cur.paraId ? "/" + cur.paraId : ""));
        hideBar();
      } else if(act === "ask"){
        askThisPara();
        hideBar();
      }
    });
  }
  if(rtNotes){
    rtNotes.addEventListener("click", function(){
      if(panel && panel.style.display === "block"){ panel.style.display = "none"; }
      else { renderPanel(); }
    });
  }
  /* 已保存的段落加标记 */
  notesFor(a.id).forEach(function(n){
    if(n.paraId) markPara(document.getElementById(n.paraId));
  });
  if(anchorPara){
    var ap = document.getElementById(anchorPara);
    if(ap) markPara(ap);
  }
}

/* ---------- P03.3: 来源感知返回上下文 ---------- */
function setOrigin(o){
  try{ sessionStorage.setItem("mx_origin", JSON.stringify(o || {})); }catch(e){}
}
function getOrigin(){
  try{ return JSON.parse(sessionStorage.getItem("mx_origin") || "null"); }catch(e){ return null; }
}
function originBack(){
  var o = getOrigin();
  if(!o || !o.type) return null;
  if(o.type === "search"){
    var q = o.q || lastQuery();
    return q ? { label: "← 返回检索", hash: "#/search/" + encodeURIComponent(q) } : { label: "← 返回检索", hash: "#/view/cats" };
  }
  if(o.type === "topic") return { label: "← 返回专题", hash: "#/view/topic" };
  if(o.type === "study") return { label: "← 返回书房", hash: "#/view/study" };
  if(o.type === "cats") return { label: "← 返回目录", hash: "#/view/cats" };
  if(o.type === "research") return { label: "← 返回研究室", href: "research.html" + (o.art ? "?art=" + encodeURIComponent(o.art) : "") };
  return null;
}
function bindSearchRows(res){
  res.querySelectorAll("li[data-id]").forEach(function(li){
    li.onclick = function(){
      track("search_result_open",{resultType:"search"});
      setOrigin({ type:"search", q: lastQuery() });
      setHash("#/art/"+li.getAttribute("data-id"));
    };
  });
}
function srow(a, t, d, frag, q){
  return "<li data-id='"+esc(a.id)+"'><div class='t'>"+t+"</div><div class='d'>"+d+"</div>"+
    (frag? "<div class='frag'>"+hl(frag,q)+"</div>":"")+"</li>";
}
/* hl: input already escaped once by caller; highlight by splitting on escaped needle */
function hl(s, q){
  if(!q) return s;
  var needle = esc(q);
  return s.split(needle).join("<em>"+needle+"</em>");
}
document.getElementById("q").addEventListener("keydown", function(e){
  if(e.key==="Enter"){
    var q = this.value.trim();
    if(q.length>=2) setHash("#/search/"+encodeURIComponent(q));
  }
});
var qClear = document.getElementById("qClear");
document.getElementById("q").addEventListener("input", function(){
  qClear.style.display = this.value ? "block" : "none";
});
qClear.addEventListener("click", function(){
  document.getElementById("q").value = "";
  qClear.style.display = "none";
  setHash("#/view/map");
});

/* ---------- global shortcuts ---------- */
document.addEventListener("keydown", function(e){
  if(typingInField() || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;  /* A08 */
  if(e.key==="/"){ e.preventDefault(); document.getElementById("q").focus(); return; }
  if(e.key==="1") setHash("#/view/map");
  if(e.key==="2") setHash("#/view/tl");
  if(e.key==="3") setHash("#/view/graph");
  if(e.key==="4") setHash("#/view/stats");
});

/* ---------- boot ---------- */
document.getElementById("volLegend").innerHTML =
  VOLCOLOR.map(function(c,i){ return "<span><i style='background:"+c+"'></i>"+VOLNAME[i]+"</span>"; }).join("");
try{
  initMap();
}catch(e){                                          /* N06: map init failure must not kill reading/search/timeline */
  var mc = document.getElementById("mapWrap3d") || document.getElementById("mapChart");
  if(mc) mc.innerHTML = "<div class='hint' style='padding:40px 16px'>地图组件初始化失败（"+esc(String(e&&e.message||e))+"），阅读、检索与年谱不受影响。<br><a href='#/view/cats'>前往目录</a></div>";
  mapObj = null;
}
renderTimeline();
renderStats();
/* P01.4: 清理废弃 3D 状态（仅此废弃 key；mx_marks/mx_read/mx_recent/mx_research_cards 一律不动） */
try{ localStorage.removeItem("mx_mapmode"); }catch(e){}
show("home");
applyRoute();
track("page_view", {pageType:"first"});

/* ===== PWA + theme button ===== */
(function(){
  var tb = document.getElementById("themeBtn");
  if(tb) tb.addEventListener("click", toggleTheme);
  if("serviceWorker" in navigator){
    var proto = location.protocol;
    if(proto === "https:" || proto === "http:"){
      window.addEventListener("load", function(){
        navigator.serviceWorker.register("sw.js").catch(function(){});
      });
    }
  }
})();
})();
