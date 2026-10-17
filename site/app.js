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

var state = {view:"map", eraFilter:null, selPlace:null, curArt:null, tlFit:false, histYear:null, tlYear:null,
  mapMode:(function(){ try{ return localStorage.getItem("mx_mapmode")||"2d"; }catch(e){ return "2d"; } })()};
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
  show(r.v==="map"||r.v==="tl"||r.v==="graph"||r.v==="stats"||r.v==="read"||r.v==="cats"||r.v==="home" ? r.v : "home");
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
    li.addEventListener("click", function(){ setHash("#/art/"+li.getAttribute("data-id")); });
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
function renderHome(){
  var v = document.getElementById("view-home");
  var last = lastReadArticle();
  var marks = [];
  try{ marks = Object.keys(JSON.parse(localStorage.getItem("mx_marks")||"{}")); }catch(e){}
  var h = "<div class='homeWrap'>";
  h += "<div class='hero'><h1>毛选时空研读</h1><p class='sub'>沿着时间、地点和文章之间的联系，开始一次有脉络的阅读。</p>";
  h += "<div class='heroBtns'><a class='btnMain' href='#/view/cats'>开始研读 · 浏览全部篇目</a>";
  if(last){
    var t = "";
    try{ t = new Date(JSON.parse(localStorage.getItem("mx_recent")||"{}")[last.id]).toLocaleDateString(); }catch(e){}
    h += "<a class='btnCont' href='#/art/"+esc(last.id)+"'>继续上次 ·《"+esc(last.title)+"》"+(t?"（"+t+"）":"")+"</a>";
  }
  h += "</div><p class='heroNote'>本站收录 217 篇；数量反映当前数据库。</p></div>";
  /* explore entries */
  h += "<div class='homeGrid'>";
  h += "<a class='homeCard' href='#/view/map'><i>舆</i><b>从地点找文章</b><span>文章写作之地落于真实地形</span></a>";
  h += "<a class='homeCard' href='#/view/tl'><i>谱</i><b>从年份看脉络</b><span>1925—1957 年谱纵览</span></a>";
  h += "<a class='homeCard' href='#/view/graph'><i>图</i><b>沿关系延伸阅读</b><span>文章与事件的关联图谱</span></a>";
  h += "<a class='homeCard' href='#/view/stats'><i>数</i><b>本站语料统计</b><span>篇幅与地点分布</span></a>";
  h += "</div>";
  h += "<div class='homeNote'>资料来源：《毛泽东选集》第一至五卷（人民出版社）· 本站仅作个人学习研读之用 · 收藏与阅读位置仅保存在当前浏览器</div>";
  h += "</div>";
  v.innerHTML = h;
  track("page_view", {pageType:"home"});
}
function show(v){
  state.view = v;
  ["map","tl","graph","read","search","stats","cats","home"].forEach(function(k){
    var el = document.getElementById("view-"+k);
    if(el) el.classList.toggle("on", k===v);
  });
  if(v==="cats") renderCatalog();
  if(v==="home") renderHome();
  document.querySelectorAll("nav button, #tabbar button").forEach(function(b){
    b.classList.toggle("on", b.getAttribute("data-v")===v);
  });
  if(v==="map" && mapObj) setTimeout(function(){ mapObj.invalidateSize(); }, 60);
  if(v!=="map" && window.__MX3D_MODULE__){ try{ window.__MX3D_MODULE__.pause(); }catch(e){} }
  if(v==="map" && state.mapMode==="3d") applyMapMode();
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
    if(v==="read"){ if(state.curArt) setHash("#/art/"+state.curArt.id); return; }
    setHash("#/view/"+v);
  });
});

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
/* ---------- 3D map bridge (M1): lazy load + hooks ---------- */
var mx3dLoading = false;
function ensureMap3d(){
  if(window.__MX3D_MODULE__) { window.__MX3D_MODULE__.build(); return; }
  if(mx3dLoading) return;
  mx3dLoading = true;
  if(!window.maplibregl){
    var css = document.createElement("link");
    css.rel = "stylesheet"; css.href = "assets/maplibre-gl.css";
    document.head.appendChild(css);
    var s = document.createElement("script");
    s.src = "assets/maplibre-gl.js";
    s.onload = function(){ loadMap3dModule(); };
    /* MAP06: maplibre is only the terrain FALLBACK now - AMap (loaded inside
       map3d.js) is primary. A failed maplibre download must not kill 3D. */
    s.onerror = function(){ loadMap3dModule(); };
    document.head.appendChild(s);
  } else { loadMap3dModule(); }
}
function loadMap3dModule(){
  var m = document.createElement("script");
  m.src = "assets/map3d.js";
  m.onload = function(){
    mx3dLoading = false;
    if(window.__MX3D_MODULE__ && !window.__MX3D_MODULE__.isReady()) window.__MX3D_MODULE__.build();
  };
  m.onerror = function(){ mx3dFail("三维模块加载失败"); };
  document.head.appendChild(m);
}
function mx3dFail(msg){
  mx3dLoading = false;
  state.mapMode = "2d";
  try{ localStorage.setItem("mx_mapmode","2d"); }catch(e){}
  applyMapMode();
  toast(msg || "三维不可用，已切回二维");
  track("map3d_fallback", {});
}
window.__MX3D__ = {
  state: function(){ return state; },
  route: function(){ return ROUTE; },
  places: function(){ return placeList; },
  visibleArts: function(){ return visibleArts(); },
  selectPlace: function(pid){ selectPlace(pid); },
  track: function(ev, p){ track(ev, p); },
  playBtnUI: function(mode){
    var b = document.getElementById("histPlay");
    if(b) b.textContent = mode==="playing" ? "❚❚ 暂停" : "▶ 播放";
  },
  fail: function(msg){ mx3dFail(msg); }
};
function applyMapMode(){
  var is3d = state.mapMode === "3d";
  var el2 = document.getElementById("mapChart");
  var el3 = document.getElementById("map3dChart");
  if(el2) el2.style.display = is3d ? "none" : "";
  if(el3) el3.style.display = is3d ? "block" : "none";
  document.querySelectorAll("#mapModeBtns button").forEach(function(b){
    b.classList.toggle("on", b.getAttribute("data-mm")===state.mapMode);
  });
  var st = document.getElementById("mx3dStatus");
  if(st) st.style.display = is3d ? "block" : "none";
  var fb = document.getElementById("mx3dFollow");
  if(fb) fb.style.display = is3d ? "block" : "none";
  if(!is3d && window.__MX3D_MODULE__){
    try{ window.__MX3D_MODULE__.pause(); }catch(e){}
  }
  if(is3d){
    if(window.__MX3D_MODULE__ && window.__MX3D_MODULE__.isReady()){
      window.__MX3D_MODULE__.refresh();
      if(window.__mx3dMap){
        setTimeout(function(){ window.__mx3dMap.resize(); }, 90);
        setTimeout(function(){ window.__mx3dMap.resize(); }, 600);
      }
    } else {
      ensureMap3d();
    }
  }
}
function setMapMode(mm){
  if(mm===state.mapMode) return;
  state.mapMode = mm;
  try{ localStorage.setItem("mx_mapmode", mm); }catch(e){}
  track("map3d_mode_switch", {mode:mm});
  applyMapMode();
}
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
  if(window.__MX3D_MODULE__ && window.__MX3D_MODULE__.isReady()) window.__MX3D_MODULE__.refresh();
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
  if(state.mapMode==="3d" && window.__MX3D_MODULE__ && window.__MX3D_MODULE__.isReady()){
    window.__MX3D_MODULE__.togglePlayer(); return;
  }
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
function fmtText(raw){
  var paras = raw.split(/\n+/);
  var out = [], head = 2;
  for(var i=0;i<paras.length;i++){
    var t = paras[i].trim();
    if(!t) continue;
    t = esc(t);                                /* N03: escape article body (defense in depth for future corpus edits) */
    if(head>0 && (t.indexOf("一九")===0 || /^[（(].*[）)]$/.test(t))){ out.push("<p class='note' style='text-align:center;text-indent:0'>"+t+"</p>"); head--; continue; }
    if((/^\*/.test(t) || /^〔\d+〕/.test(t) || /^注[:：]/.test(t)) && out.length>10){ out.push("<p class='note'>"+t+"</p>"); continue; }
    out.push("<p>"+t+"</p>");
  }
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
  v.querySelectorAll(".artText > p").forEach(function(p, i){
    var t = p.textContent.trim();
    if(t.length>=8 && t.length<=42 && /^(一|二|三|四|五|六|七|八|九|十|[0-9]+)[、.．]/.test(t) && !p.classList.contains("note")){
      p.id = "para-"+i;
      toc.push({id:"para-"+i, text:t.slice(0,26)});
    }
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
/* WP06: 段落锚点定位 — sample-topic.json 的段落 id (pv1n03-033 等) → 按 20 字前缀文本在渲染后的
   .artText 段落中定位 (对主站 txt 分段与数据包分段的差异鲁棒); 找到则滚过去高亮 2.5s */
var __sampleTopicCache = null;
function scrollToPara(view, paraId){
  var m = /^p(v\d+n\d+)-(\d+)$/.exec(paraId);
  if(!m){ toast("段落链接格式无法识别"); return; }
  var artId = m[1];
  var locate = function(paras){
    var p = (paras||[]).filter(function(x){ return x.id === paraId; })[0];
    if(!p || !p.text){ toast("样本数据中未找到该段落"); return; }
    var key = p.text.replace(/\s+/g,"");
    /* 段落定位: 优先"唯一包含"匹配, 无法唯一定位时明确提示, 不静默猜选
       (固定字宽切分的样本段落可能只占主站自然段的一部分, 或跨自然段) */
    var domParas = Array.prototype.slice.call(view.querySelectorAll(".artText p"));
    var norm = function(s){ return (s.textContent || "").replace(/\s+/g,""); };
    var exact = domParas.filter(function(el2){ return norm(el2) === key; });
    var containing = exact.length ? exact : domParas.filter(function(el2){ return norm(el2).indexOf(key) >= 0; });
    if(containing.length === 1){
      var elP = containing[0];
      elP.id = "anchor-" + paraId;
      elP.style.transition = "background .8s";
      elP.style.background = "rgba(176,58,46,.12)";
      setTimeout(function(){ elP.style.background = ""; }, 2500);
      view.scrollTo({ top: elP.offsetTop - 70, behavior: "smooth" });
    } else if(containing.length > 1){
      toast("该段落文本在正文中出现 " + containing.length + " 处，无法唯一定位，请按编号在原文中查找。");
    } else {
      toast("正文分段与样本数据不一致，未能唯一定位该段落。");
    }
  };
  if(__sampleTopicCache){
    var art = __sampleTopicCache.articles && __sampleTopicCache.articles[artId];
    locate(art && art.paragraphs); return;
  }
  fetch("data/sample-topic.json").then(function(r){ return r.json(); }).then(function(j){
    __sampleTopicCache = j;
    var art = j.articles && j.articles[artId];
    locate(art && art.paragraphs);
  }).catch(function(){ toast("段落定位失败：样本数据不可用"); });
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
      (anchorPara ? "<button id='rtBackScene' style='color:#b03a2e;border-color:#b03a2e'>← 返回剧场</button>" : "")+
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
      "<div class='artText' style='font-size:"+FONT_SIZES[fs]+"px'>"+fmtText(body)+"</div>";
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
    /* WP06: 返回剧场 — history.back() 保留 theatre 的幕次/相机/播放器状态;
       刷新兜底: theatre 每次切幕写 sessionStorage.jgs_scene, 返回剧场页据此恢复幕次 */
    var rtBack = document.getElementById("rtBackScene");
    if(rtBack) rtBack.addEventListener("click", function(){
      if(history.length > 1 && document.referrer.indexOf("theatre.html") >= 0){
        history.back();
      }else{
        var sc = null;
        try{ sc = sessionStorage.getItem("jgs_scene"); }catch(e){}
        location.href = "theatre.html" + (sc ? "?scene=" + encodeURIComponent(sc) : "");
      }
    });
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
  map3d_mode_switch:["mode"], map3d_place_open:["place"], map3d_stop_click:["stop"],
  map3d_tour_toggle:["mode"], map3d_tour_station:["stop","year"],
  map3d_follow_toggle:["on"], map3d_fallback:["reason"]};
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
function doSearch(q){
  if(!q || q.length<2){ show("map"); return; }
  var seq = ++searchSeq;                       /* A02: stale query can never overwrite */
  var res = document.getElementById("view-search");
  var hitsMeta = ARTS.filter(function(a){
    return a.title.indexOf(q)>=0 || (a.why||"").indexOf(q)>=0 || (a.event||"").indexOf(q)>=0 || a.place.indexOf(q)>=0;
  });
  /* container with .sres ALWAYS present so late appends cannot be lost (A02) */
  var h = "<div class='seStats' id='seStats'>命中 " + hitsMeta.length + " 篇（标题/背景/地点）· 全文检索中…</div>" +
          "<ul class='sres' id='sresList'></ul>";
  res.innerHTML = h;
  var ul = res.querySelector("#sresList");
  var rowsHtml = "";
  hitsMeta.forEach(function(a){
    rowsHtml += srow(a, hl(esc(a.title), q), esc(a.dateRaw.replace(/[（）()]/g,"")+" · "+a.place+" · "+a.event), "", q);
  });
  ul.innerHTML = rowsHtml;
  bindSearchRows(res);
  show("search");
  track("page_view", {pageType:"search"});
  /* async full-text pass */
  preloadTexts(function(){
    if(seq !== searchSeq) return;              /* a newer query started: discard */
    if(document.getElementById("q").value.trim() !== q) return;
    var seenIds = {}; hitsMeta.forEach(function(a){seenIds[a.id]=1;});
    var extra = "", fullHits = 0;
    ARTS.forEach(function(a){
      if(seenIds[a.id]) return;
      var t = textCache[a.id];
      if(!t) return;
      var i = t.indexOf(q);
      if(i<0) return;
      fullHits++;
      var s = Math.max(0, i-40);
      var frag = esc(t.slice(s, i+70).replace(/\n/g," "));
      extra += srow(a, esc(a.title), esc(a.dateRaw.replace(/[（）()]/g,"")+" · "+a.place), frag, q);
    });
    if(extra) ul.insertAdjacentHTML("beforeend", extra);
    var st = document.getElementById("seStats");
    var msg = "命中 " + hitsMeta.length + " 篇（标题/背景/地点）+ " + fullHits + " 篇（全文）";
    if(textLoadFail>0) msg += " · 有 " + textLoadFail + " 篇正文加载失败，结果可能不完整";
    if(st) st.textContent = msg;
    if(!hitsMeta.length && !fullHits)
      res.innerHTML = "<div class='hint' style='padding:40px 10px;max-width:900px;margin:0 auto'>未检出「"+esc(q)+"」相关篇章。</div>";
    bindSearchRows(res);
  });
}
function bindSearchRows(res){
  res.querySelectorAll("li[data-id]").forEach(function(li){
    li.onclick = function(){ track("search_result_open",{resultType:"search"}); setHash("#/art/"+li.getAttribute("data-id")); };
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
document.querySelectorAll("#mapModeBtns button").forEach(function(b){
  b.addEventListener("click", function(){ setMapMode(b.getAttribute("data-mm")); });
});
document.getElementById("mx3dFollow").addEventListener("click", function(){
  if(window.__MX3D_MODULE__ && window.__MX3D_MODULE__.isReady()) window.__MX3D_MODULE__.toggleFollow();
});
applyMapMode();          /* honor persisted 2d/3d choice */
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
