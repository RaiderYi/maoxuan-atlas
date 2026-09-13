/* MaoXuan Viz - app.js v3: CN labels + history progression + redesigned timeline (ASCII only) */
(function(){
"use strict";

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

function show(v){
  state.view = v;
  ["map","tl","graph","read","search"].forEach(function(k){
    var el = document.getElementById("view-"+k);
    if(el) el.classList.toggle("on", k===v);
  });
  document.querySelectorAll("nav button").forEach(function(b){
    b.classList.toggle("on", b.getAttribute("data-v")===v);
  });
  if(v==="map" && mapObj) setTimeout(function(){ mapObj.invalidateSize(); }, 60);
  if(v==="graph" && graphChart) setTimeout(function(){ graphChart.resize(); }, 60);
  if(v==="tl" && tlFirstShow){
    tlFirstShow = false;
    /* auto-open busiest year so the bottom panel demonstrates itself */
    var cnt = {};
    ARTS.forEach(function(a){ cnt[a.y]=(cnt[a.y]||0)+1; });
    var best = Object.keys(cnt).sort(function(a,b){return cnt[b]-cnt[a];})[0];
    selectYear(parseInt(best));
  }
}
document.querySelectorAll("nav button").forEach(function(b){
  b.addEventListener("click", function(){ show(b.getAttribute("data-v")); });
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
ARTS.forEach(function(a){
  if(a.lat && a.lng && a.lat>17 && a.lat<55 && a.lng>72 && a.lng<136){
    var k = a.place;
    if(!places[k]) places[k] = {name:a.place, lat:a.lat, lng:a.lng, arts:[]};
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
    if(c[3] > maxLv && c[3]!==0) return;  /* 圣地始终显示 */
    var cls = c[3]===0 ? "cnlab hl" : ("cnlab lv"+c[3]);
    var ic = L.divIcon({className:"", iconSize:null,
      html:"<div class='"+cls+"'>"+c[0]+"</div>"});
    L.marker([c[1],c[2]], {icon:ic, interactive:false, keyboard:false, pane:"labelPane"}).addTo(labelLayer);
  });
}
function updateMarkers(){
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
    m.on("click", function(){ selectPlace(p.name); });
    m.bindTooltip(p.name+" · "+n+"篇", {direction:"top", offset:[0,-sz/2-4]});
    markers.push(m);
  });
  drawRoute();
}
function drawRoute(){
  routeLayer.clearLayers();
  var upto = state.histYear==null ? 9999 : state.histYear;
  var pts = [], stops = [];
  ROUTE.forEach(function(r){
    if(r[1] <= upto){ pts.push([r[2], r[3]]); stops.push(r); }
  });
  if(pts.length < 1) return;
  if(pts.length >= 2){
    /* casing + solid core: route as visual protagonist */
    L.polyline(pts, {color:"#fff8ea", weight:7, opacity:.92, pane:"routePane", interactive:false}).addTo(routeLayer);
    L.polyline(pts, {color:"#b03a2e", weight:3.5, opacity:.95, pane:"routePane", interactive:false}).addTo(routeLayer);
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
  state.selPlace = pid;
  var p = places[pid];
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
    li.addEventListener("click", function(){ openArticle(li.getAttribute("data-id")); });
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
  /* era bands with year ranges */
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
  /* year rows + histogram bars */
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
  /* dots colored by volume */
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
      openArticle(a.id);
    });
  });
  inner.querySelectorAll(".hbar").forEach(function(b){
    b.addEventListener("click", function(){ selectYear(parseInt(b.getAttribute("data-y"))); });
  });
  inner.querySelectorAll(".yearRow span").forEach(function(sp){
    sp.parentElement.style.pointerEvents = "auto";
    sp.style.cursor = "pointer";
    sp.addEventListener("click", function(){
      var y = parseInt(sp.textContent);
      selectYear(y);
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
    var h = "<div class='ypHead'><b>"+y+" 年</b><span class='ypCnt'>"+arr.length+" 篇 · <i style='color:"+e.color+";font-style:normal'>"+e.name+"</i></span><a class='ypClose' id='ypClose'>收起 ×</a></div><div class='ypList'>";
    arr.forEach(function(a){
      h += "<div class='ypItem' data-id='"+a.id+"'>"+
        "<div class='ypT'>"+a.title+"</div>"+
        "<div class='ypD'>"+a.dateRaw.replace(/[（）()]/g,"")+" · "+a.place+"</div>"+
        "<div class='ypW'>"+(a.why||"").slice(0,52)+"…</div></div>";
    });
    h += "</div>";
    panel.innerHTML = h;
  }
  panel.classList.add("on");
  document.getElementById("ypClose").addEventListener("click", function(){
    panel.classList.remove("on"); state.tlYear = null;
  });
  panel.querySelectorAll(".ypItem").forEach(function(it){
    it.addEventListener("click", function(){ openArticle(it.getAttribute("data-id")); });
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

/* ---------- GRAPH ---------- */
var graphChart = null;
function initGraph(){
  graphChart = echarts.init(document.getElementById("graphChart"));
  var nodes = [], links = [];
  ARTS.forEach(function(a){
    nodes.push({id:a.id, name:a.title, symbolSize:Math.max(8, Math.min(26, 6+Math.sqrt(a.nChars)/3)),
      category:a.vol-1, value:a.nChars, aid:a.id,
      itemStyle:{color:VOLCOLOR[a.vol-1], borderColor:"rgba(245,239,224,.9)", borderWidth:1}});
  });
  var evCount = {};
  ARTS.forEach(function(a){ if(a.event && a.event!=="—" && a.event!=="-") evCount[a.event]=(evCount[a.event]||0)+1; });
  Object.keys(evCount).sort(function(a,b){return evCount[b]-evCount[a];}).forEach(function(ev){
    nodes.push({id:"ev:"+ev, name:ev, symbolSize:Math.max(10, Math.min(34, 8+evCount[ev]*3)), category:5,
      itemStyle:{color:"#a8842c", borderColor:"rgba(245,239,224,.9)", borderWidth:1.5}, isEvent:true});
  });
  ARTS.forEach(function(a){
    if(a.event && a.event!=="—" && a.event!=="-") links.push({source:a.id, target:"ev:"+a.event,
      lineStyle:{color:"rgba(168,132,44,.35)", width:1, curveness:.15}});
    (a.links||[]).forEach(function(t){
      var o = titleIndex[t];
      if(o && a.id < o.id) links.push({source:a.id, target:o.id,
        lineStyle:{color:"rgba(176,58,46,.3)", width:1.2, curveness:.1}});
    });
  });
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
      label:{show:true, color:"#5a4f45", fontSize:10, fontFamily:"inherit",
        formatter:function(p){ return p.name.length>9 ? p.name.slice(0,9)+"…" : p.name; }},
      emphasis:{focus:"adjacency", label:{fontSize:12, color:"#b03a2e"}},
      lineStyle:{opacity:.5}, data:nodes, links:links,
      categories:[{name:"卷一"},{name:"卷二"},{name:"卷三"},{name:"卷四"},{name:"卷五"},{name:"事件"}]
    }]
  });
  graphChart.on("click", function(p){
    if(p.dataType==="node" && !p.data.isEvent) openArticle(p.data.aid);
  });
  window.addEventListener("resize", function(){ graphChart && graphChart.resize(); });
}

/* ---------- READER ---------- */
function fmtText(raw){
  var paras = raw.split(/\n+/);
  var out = [], head = 2;
  for(var i=0;i<paras.length;i++){
    var t = paras[i].trim();
    if(!t) continue;
    if(head>0 && (t.indexOf("一九")===0 || /^[（(].*[）)]$/.test(t))){ out.push("<p class='note' style='text-align:center;text-indent:0'>"+t+"</p>"); head--; continue; }
    if((/^\*/.test(t) || /^〔\d+〕/.test(t) || /^注[:：]/.test(t)) && out.length>10){ out.push("<p class='note'>"+t+"</p>"); continue; }
    out.push("<p>"+t+"</p>");
  }
  return out.join("");
}
function openArticle(id){
  var a = byId[id];
  if(!a) return;
  state.curArt = a;
  document.getElementById("navRead").style.display="";
  var v = document.getElementById("view-read");
  fetch("data/texts/"+id+".txt").then(function(r){return r.text();}).then(function(txt){
    var idx = txt.indexOf("\n\n");
    var body = idx>0 ? txt.slice(idx+2) : txt;
    var links = (a.links||[]).filter(function(t){return titleIndex[t];});
    var h = "<div class='readWrap'><div class='readHead'><div class='vol'>《毛泽东选集》第"+["一","二","三","四","五"][a.vol-1]+"卷</div>"+
      "<h2>"+a.title+"</h2><div class='date'>"+a.dateRaw.replace(/[（）()]/g,"")+"</div></div>"+
      "<div class='ctxCard'><h4>写作背景</h4><p>"+(a.why||"（待考）")+"</p>"+
      "<div class='ctxMeta'>"+
      "<span>地点 <b>"+a.place+"</b></span>"+
      "<span>时期 <b>"+a.era+"</b></span>"+
      "<span>关联事件 <b>"+a.event+"</b></span>"+
      "<span>篇幅 <b>"+a.nChars+" 字</b></span>"+
      "</div></div>"+
      (links.length? "<div class='linkArts'><h4>关联文章</h4><div class='lks'>"+
        links.map(function(t){return "<a data-id='"+titleIndex[t].id+"'>"+t+"</a>";}).join("")+
        "</div></div>":"")+
      "<div class='artText'>"+fmtText(body)+"</div>";
    var prev = ARTS[ARTS.indexOf(a)-1], next = ARTS[ARTS.indexOf(a)+1];
    h += "<div class='readNav'>"+
      (prev? "<a data-id='"+prev.id+"'>← 前篇 · "+prev.title+"</a>":"<span></span>")+
      (next? "<a data-id='"+next.id+"'>后篇 · "+next.title+" →</a>":"")+
      "</div></div>";
    v.innerHTML = h;
    v.querySelectorAll("[data-id]").forEach(function(el){
      el.addEventListener("click", function(){ openArticle(el.getAttribute("data-id")); });
    });
    v.scrollTop = 0;
    show("read");
    document.title = a.title + " · 毛泽东选集";
  });
}

/* ---------- SEARCH ---------- */
var textCache = {};
function doSearch(q){
  if(!q || q.length<2){ show("map"); return; }
  var res = document.getElementById("view-search");
  var hitsMeta = ARTS.filter(function(a){
    return a.title.indexOf(q)>=0 || (a.why||"").indexOf(q)>=0 || (a.event||"").indexOf(q)>=0 || a.place.indexOf(q)>=0;
  });
  var h = "<ul class='sres'>";
  hitsMeta.forEach(function(a){
    h += srow(a, hl(a.title, q), a.dateRaw.replace(/[（）()]/g,"")+" · "+a.place+" · "+a.event, "", q);
  });
  var promises = ARTS.map(function(a){
    if(textCache[a.id]) return Promise.resolve([a, textCache[a.id]]);
    return fetch("data/texts/"+a.id+".txt").then(function(r){return r.text();}).then(function(t){
      textCache[a.id]=t; return [a,t];
    }).catch(function(){return null;});
  });
  Promise.all(promises).then(function(arr){
    var seenIds = {}; hitsMeta.forEach(function(a){seenIds[a.id]=1;});
    var extra = "";
    arr.forEach(function(p){
      if(!p) return;
      var a=p[0], t=p[1];
      if(seenIds[a.id]) return;
      var i = t.indexOf(q);
      if(i<0) return;
      var s = Math.max(0, i-40);
      var frag = t.slice(s, i+70).replace(/\n/g," ");
      extra += srow(a, a.title, a.dateRaw.replace(/[（）()]/g,"")+" · "+a.place, frag, q);
    });
    if(extra) h += extra;
    h += "</ul>";
    if(!hitsMeta.length && !extra) h = "<div class='hint' style='padding:40px 10px;max-width:900px;margin:0 auto'>未检出「"+q+"」相关篇章。</div>";
    res.innerHTML = h;
    res.querySelectorAll("li[data-id]").forEach(function(li){
      li.addEventListener("click", function(){ openArticle(li.getAttribute("data-id")); });
    });
    show("search");
  });
}
function srow(a, t, d, frag, q){
  return "<li data-id='"+a.id+"'><div class='t'>"+t+"</div><div class='d'>"+d+"</div>"+
    (frag? "<div class='frag'>"+hl(frag,q)+"</div>":"")+"</li>";
}
function hl(s, q){
  if(!q) return s;
  return s.split(q).join("<em>"+q+"</em>");
}
document.getElementById("q").addEventListener("keydown", function(e){
  if(e.key==="Enter") doSearch(this.value.trim());
});

/* ---------- boot ---------- */
document.getElementById("volLegend").innerHTML =
  VOLCOLOR.map(function(c,i){ return "<span><i style='background:"+c+"'></i>"+VOLNAME[i]+"</span>"; }).join("");
initMap();
renderTimeline();
initGraph();
show("map");
})();
