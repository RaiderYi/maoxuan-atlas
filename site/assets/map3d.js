/* MaoXuan 3D map module (M1) - lazy-loaded into #map3dChart, ASCII only.
   Semantics: solid line = visited up to histYear; dashed = schematic order only (not real march path).
   Fallback: any WebGL/style failure -> back to Leaflet 2D with toast. */
(function(){
"use strict";

var H = window.__MX3D__;                      /* hooks from app.js */
if(!H){ return; }

/* MAP06 (2026-10-17): AMap 3D primary (user key), MapLibre terrain fallback */
var AMAP_KEY = "c464417e4a77c8bd7a4c5ce6ba8c5a34";
var ENGINE = null;                            /* "amap" | "libre" */
function loadAMap(cb){
  if(window.AMap){ cb(true); return; }
  var s = document.createElement("script");
  s.src = "https://webapi.amap.com/maps?v=2.0&key=" + AMAP_KEY;
  s.onload = function(){ cb(!!window.AMap); };
  s.onerror = function(){ cb(false); };
  document.head.appendChild(s);
}

var DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
var BASE_URL = "https://basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png";
var LABEL_URL = "https://basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png";

var map = null, failed = false, loaded = false;
var player = {mode:"idle", idx:0, timer:null, speed:1};   /* idle|playing|paused|finished */

function log(msg){ var s = document.getElementById("mx3dStatus"); if(s) s.textContent = msg; }

function routeData(){
  var upto = H.state().histYear==null ? 9999 : H.state().histYear;
  var stops = H.route().filter(function(r){ return r[1] <= upto; });
  var visited = stops.map(function(r){ return [r[3], r[2]]; });       /* [lng,lat] */
  var future  = H.route().filter(function(r){ return r[1] > upto; }).map(function(r){ return [r[3], r[2]]; });
  return {stops:stops, visited:visited, future:future};
}

function artMarkers(){
  /* same grouping as 2D: by place, visible arts only */
  var vis = H.visibleArts();
  var visIds = {}; vis.forEach(function(a){ visIds[a.id]=1; });
  var feats = [];
  H.places().forEach(function(p){
    var n = p.arts.filter(function(a){ return visIds[a.id]; }).length;
    if(!n) return;
    feats.push({type:"Feature",
      properties:{name:p.name, n:n, pid:p.name},
      geometry:{type:"Point", coordinates:[p.lng, p.lat]}});
  });
  return {type:"FeatureCollection", features:feats};
}

function build(){
  if(loaded || failed) return;
  /* container may have just been un-hidden: wait one frame so layout settles */
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ buildNow(); }); });
}
var buildTries = 0;
function buildNow(){
  var el = document.getElementById("map3dChart");
  if(el && el.clientWidth < 50 && buildTries++ < 20){   /* layout not ready yet */
    setTimeout(buildNow, 150);
    return;
  }
  buildInit();
}
function buildInit(){
  loadAMap(function(amapOk){
    if(amapOk){
      try{ buildAMap(); return; }
      catch(e){ /* fall through to MapLibre terrain pipeline */ }
    }
    if(!window.maplibregl){ fail("3D组件未就绪（高德与MapLibre均不可用）"); return; }
    buildLibre();
  });
}

/* ---------- AMap 3D build ---------- */
function buildAMap(){
  ENGINE = "amap";
  map = new AMap.Map("map3dChart", {
    viewMode: "3D",
    zoom: 4.1, pitch: 38, rotation: -12,
    center: [109.8, 33.8],
    mapStyle: "amap://styles/normal",
    features: ["bg", "road", "building"]
  });
  window.__mx3dMap = map;
  map.on("complete", function(){
    loaded = true;
    log("三维就绪(高德) · 虚线为顺序示意，非行军道路");
    addLayersAMap();
    syncMarkers();
    map.on("dragstart", function(){ if(player.mode==="playing") pausePlayer(); });
  });
}
function addLayersAMap(){
  var rd = routeData();
  /* visited solid / future dashed as AMap polylines */
  if(rd.visited.length > 1){
    map.add(new AMap.Polyline({ path: rd.visited, strokeColor: "#8e2f26",
      strokeWeight: 4, strokeOpacity: 0.95, lineJoin: "round" }));
    map.add(new AMap.Polyline({ path: rd.visited, strokeColor: "#fff8ea",
      strokeWeight: 7, strokeOpacity: 0.6, zIndex: 40 }));
  }
  if(rd.future.length > 1){
    map.add(new AMap.Polyline({ path: rd.future, strokeColor: "#b03a2e",
      strokeWeight: 3, strokeOpacity: 0.75, strokeStyle: "dashed" }));
  }
  /* article aggregate circles via CircleMarker-ish: use Circle with small radius in meters */
  H.places().forEach(function(p){
    var n = 0;
    H.visibleArts().forEach(function(a){ if(a.place === p.name) n++; });
    var visIds = {}; H.visibleArts().forEach(function(a){ visIds[a.id]=1; });
    n = p.arts.filter(function(a){ return visIds[a.id]; }).length;
    if(!n) return;
    var r = 3000 + Math.min(n, 20) * 1800;
    var c = new AMap.Circle({ center: [p.lng, p.lat], radius: r,
      strokeColor: "#8e2f26", strokeWeight: 2, strokeOpacity: 0.9,
      fillColor: "#b03a2e", fillOpacity: 0.45 });
    c.on("click", function(){ H.selectPlace(p.name); });
    map.add(c);
  });
}
function buildLibre(){
  /* MAP01/MAP02: localize the failure stage; keep init non-fatal (no white screen) */
  var _el = document.getElementById("map3dChart");
  var _libVer = (window.maplibregl && maplibregl.version) || "unknown";
  var _box = _el ? (_el.clientWidth + "x" + _el.clientHeight) : "missing";
  var _webglOk = false, _webglMsg = "";
  try{
    var _c = document.createElement("canvas");
    var _gl = _c.getContext("webgl2") || _c.getContext("webgl");
    if(_gl){ _webglOk = true; }
    else { _webglMsg = "WebGL context unavailable"; }
  }catch(e){ _webglMsg = (e && e.name ? e.name + ": " : "") + (e && e.message ? e.message : String(e)); }
  if(!_webglOk){ fail("3D不可用：" + _webglMsg + " · lib=" + _libVer + " · 容器=" + _box); return; }
  try{
    map = new maplibregl.Map({
      container:"map3dChart",
      style:{
        version:8,
        sources:{
          base:{type:"raster", tiles:[BASE_URL], tileSize:256, maxzoom:10,
            attribution:"© OpenStreetMap contributors © CARTO · DEM: Mapzen/AWS"},
          labels:{type:"raster", tiles:[LABEL_URL], tileSize:256, maxzoom:10},
          dem:{type:"raster-dem", tiles:[DEM_URL], encoding:"terrarium", tileSize:256, maxzoom:13}
        },
        layers:[
          {id:"base", type:"raster", source:"base", paint:{"raster-opacity":0.94}},
          {id:"dem-shade", type:"hillshade", source:"dem", paint:{
            "hillshade-exaggeration":0.45, "hillshade-shadow-color":"#6b5d3f",
            "hillshade-highlight-color":"#fff8e8", "hillshade-accent-color":"#c9b98d"}},
          {id:"labels", type:"raster", source:"labels", paint:{"raster-opacity":0.85}}
        ]
      },
      center:[109.8, 33.8], zoom:4.1, pitch:38, bearing:-12,
      maxZoom:12, attributionControl:{compact:true}
    });
  }catch(e){
    var _m = (e && e.name ? e.name + ": " : "") + (e && e.message ? e.message : String(e));
    fail("3D初始化失败：" + _m + " · lib=" + _libVer + " · 容器=" + _box);
    return;
  }
  window.__mx3dMap = map;
  map.on("error", function(e){
    var msg = (e && e.error && e.error.message) || "";
    if(/WebGL|context|shader/i.test(msg)) fail("三维渲染不可用，已切回二维");
  });
  map.on("load", function(){
    loaded = true;
    map.resize();                                  /* container was display:none at init */
    map.setTerrain({source:"dem", exaggeration:1.0});
    setTimeout(function(){ map.resize(); }, 300);
    addLayers();
    syncMarkers();
    map.on("zoomend", syncMarkers);
    log("三维地形就绪 · 虚线为顺序示意，非行军道路");
    map.on("dragstart", function(){ if(player.mode==="playing") pausePlayer(); });
  });
}

function addLayers(){
  var rd = routeData();
  /* visited: solid; remaining: dashed. Never join across the gap (M11/M14). */
  map.addSource("lineV", {type:"geojson", data:fc(rd.visited.length>1?rd.visited:null)});
  map.addSource("lineF", {type:"geojson", data:fc(rd.future.length>1?rd.future:null)});
  map.addLayer({id:"route-halo", type:"line", source:"lineV", filter:["has","ok"],
    paint:{"line-color":"#fff8ea","line-width":7,"line-opacity":.85}});
  map.addLayer({id:"route-visited", type:"line", source:"lineV",
    paint:{"line-color":"#8e2f26","line-width":3.4,"line-opacity":.95}});
  map.addLayer({id:"route-future", type:"line", source:"lineF",
    paint:{"line-color":"#b03a2e","line-width":2.6,"line-opacity":.75,"line-dasharray":[2.5,2]}});
  /* stops */
  map.addSource("stops", {type:"geojson", data:stopsFc(rd.stops)});
  map.addLayer({id:"stop-halo", type:"circle", source:"stops", paint:{
    "circle-radius":10, "circle-color":"rgba(176,58,46,.22)",
    "circle-stroke-width":2, "circle-stroke-color":"#8e2f26"}});
  map.addLayer({id:"stop-core", type:"circle", source:"stops", paint:{
    "circle-radius":4.5, "circle-color":"#f5efe0", "circle-stroke-width":2.4, "circle-stroke-color":"#8e2f26"}});
  /* stop labels as DOM markers: no glyph dependency */
  /* article markers */
  map.addSource("arts", {type:"geojson", data:artMarkers()});
  map.addLayer({id:"art-dot", type:"circle", source:"arts", paint:{
    "circle-radius":["interpolate",["linear"],["sqrt",["get","n"]],
      1,6, 3,10, 6,14, 10,18, 20,24],
    "circle-color":"rgba(176,58,46,.78)",
    "circle-stroke-width":2, "circle-stroke-color":"rgba(245,239,224,.9)"}, layout:{"circle-sort-key":["get","n"]}});
  /* art labels as DOM markers (zoom-gated in syncMarkers) */
  /* clicks */
  map.on("click","art-dot", function(e){
    var p = e.features[0].properties;
    H.selectPlace(p.pid);
    map.flyTo({center:e.features[0].geometry.coordinates, zoom:7.4, pitch:48, duration:1400});
    H.track("map3d_place_open",{place:p.name});
  });
  map.on("click","stop-core", function(e){
    var p = e.features[0].properties;
    player.idx = p.idx - 1;                     /* station index base 1 */
    focusStop(p.idx - 1, 1400);
    H.track("map3d_stop_click",{stop:p.name});
  });
}

/* ---------- DOM label markers (no glyph dependency) ---------- */
var stopMarkers = [], artMarkersArr = [];
function clearMarkers(){
  stopMarkers.forEach(function(mk){ mk.remove(); });
  artMarkersArr.forEach(function(mk){ mk.remove(); });
  stopMarkers = []; artMarkersArr = [];
}
function syncMarkers(){
  if(!loaded || failed || !map) return;
  clearMarkers();
  var rd = routeData();
  var CN = ["A.","B.","C.","D.","E.","F.","G.","H.","I.","J."];
  CN = ["\u2460","\u2461","\u2462","\u2463","\u2464","\u2465","\u2466","\u2467","\u2468","\u2469"];
  var amapMode = (ENGINE === "amap");
  rd.stops.forEach(function(r, i){
    var el = document.createElement("div");
    el.className = "mx3d-stoplab";
    el.textContent = (CN[i] || (i+1)) + " " + r[0];
    el.addEventListener("click", function(ev){
      ev.stopPropagation();
      player.idx = i;
      focusStop(i, 1400);
      H.track("map3d_stop_click", {stop:r[0]});
    });
    if(amapMode){
      stopMarkers.push(new AMap.Marker({ content: el, position: [r[3], r[2]],
        anchor: "top-center", offset: new AMap.Pixel(0, 10) }).addTo(map));
    } else {
      stopMarkers.push(new maplibregl.Marker({element:el, anchor:"top", offset:[0,10]})
        .setLngLat([r[3], r[2]]).addTo(map));
    }
  });
  var z = map.getZoom();
  var vis = H.visibleArts(); var visIds = {};
  vis.forEach(function(a){ visIds[a.id]=1; });
  H.places().forEach(function(p){
    var n = p.arts.filter(function(a){ return visIds[a.id]; }).length;
    if(!n || z < 5.2) return;
    var el = document.createElement("div");
    el.className = "mx3d-artlab";
    el.textContent = p.name + " " + n + "\u7bc7";
    if(amapMode){
      artMarkersArr.push(new AMap.Marker({ content: el, position: [p.lng, p.lat],
        anchor: "bottom-center", offset: new AMap.Pixel(0, -6) }).addTo(map));
    } else {
      artMarkersArr.push(new maplibregl.Marker({element:el, anchor:"bottom", offset:[0,-6]})
        .setLngLat([p.lng, p.lat]).addTo(map));
    }
  });
}

function fc(coords){
  if(!coords) return {type:"FeatureCollection", features:[]};
  return {type:"FeatureCollection", features:[
    {type:"Feature", properties:{ok:1}, geometry:{type:"LineString", coordinates:coords}}]};
}
function stopsFc(stops){
  var CN = ["①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩"];
  return {type:"FeatureCollection", features:stops.map(function(r,i){
    return {type:"Feature",
      properties:{name:r[0], idx:i+1, cn:CN[i]||"", year:Math.floor(r[1])},
      geometry:{type:"Point", coordinates:[r[3], r[2]]}};
  })};
}

/* ---------- M17: smooth camera ---------- */
var follow = true;                       /* camera follows tour; off = free look, narration continues */
var LAST_STOP = null;
function stopPadding(){
  /* keep target clear of the right side panel (desktop) */
  return {left:60, right: document.getElementById("mapSide") && window.innerWidth>1000 ? 300 : 40,
          top:70, bottom:110};
}
function flyStop(i, dur){
  var st = routeData().stops;
  if(!st.length) return;
  i = Math.max(0, Math.min(st.length-1, i));
  var r = st[i];
  if(ENGINE === "amap"){
    if(follow){ map.setZoomAndCenter(8.4, [r[3], r[2]]); map.setPitch(55); map.setRotation(-18); }
    LAST_STOP = [r[3], r[2]];
    return;
  }
  if(follow){
    var cam = {center:[r[3], r[2]], zoom:8.4, pitch:55, bearing:-18, duration:dur||2400,
               padding:stopPadding()};
    /* long hops ease out instead of hard dive: easeTo when already near, flyTo for big jumps */
    var dLng = LAST_STOP ? Math.abs(r[3]-LAST_STOP[0]) : 99;
    var dLat = LAST_STOP ? Math.abs(r[2]-LAST_STOP[1]) : 99;
    if(dLng < 3 && dLat < 3 && map.getZoom() > 6.5){
      map.easeTo(cam);
    } else {
      map.flyTo(cam);
    }
  }
  LAST_STOP = [r[3], r[2]];
}
function focusStop(i, dur){
  var st = routeData().stops;
  if(!st.length) return;
  i = Math.max(0, Math.min(st.length-1, i));
  player.idx = i;
  var r = st[i];
  flyStop(i, dur);
  H.selectPlace(r[0]);
  log("第 "+(i+1)+" 站 · "+r[0]+"（"+Math.floor(r[1])+"年·顺序示意）"+(follow?"":" · 跟随已关"));
}

/* ---------- player state machine (M15/M16/M18) ---------- */
function stationCount(){ return routeData().stops.length; }
function hopDur(a, b){
  /* stop pacing: long hops fly longer (cap 4.2s), short hops crisp (1.6s floor) */
  var d = Math.sqrt(Math.pow((b[3]-a[3])*0.87,2)+Math.pow(b[2]-a[2],2));
  return Math.max(1600, Math.min(4200, 900 + d*640)) / player.speed;
}
function holdDur(){
  /* narrative hold per stop */
  return 2200 / player.speed;
}
function playPlayer(){
  if(player.mode==="finished" || player.idx>=stationCount()) player.idx = 0;
  player.mode = "playing";
  stepStation();
}
function stepStation(){
  if(player.mode!=="playing") return;
  var n = stationCount();
  if(player.idx >= n){ player.mode="finished"; H.playBtnUI("idle"); log("导览结束 · 虚线为顺序示意"); return; }
  var st = routeData().stops;
  var prev = player.idx>0 ? st[player.idx-1] : null;
  var cur = st[player.idx];
  var fly = prev ? hopDur(prev, cur) : 2600/player.speed;
  focusStop(player.idx, fly);
  H.track("map3d_tour_station", {stop:cur[0], year:Math.floor(cur[1])});
  player.idx++;
  player.timer = setTimeout(stepStation, fly + holdDur());
}
function pausePlayer(){
  if(player.timer){ clearTimeout(player.timer); player.timer = null; }
  if(player.mode==="playing") player.mode = "paused";
  H.playBtnUI("paused");
}
function setFollow(on){
  follow = !!on;
  var b = document.getElementById("mx3dFollow");
  if(b){ b.classList.toggle("on", follow); b.textContent = follow ? "镜头跟随" : "自由视角"; }
  H.track("map3d_follow_toggle", {on:follow?1:0});
}
function toggleFollow(){ setFollow(!follow); }

function togglePlayer(){
  if(player.mode==="playing") pausePlayer();
  else { playPlayer(); H.playBtnUI("playing"); }
  H.track("map3d_tour_toggle",{mode:player.mode});
}
function destroyPlayer(){
  if(player.timer){ clearTimeout(player.timer); player.timer = null; }
  player.mode = "idle";
}

/* ---------- refresh on filter change (M14) ---------- */
function refresh(){
  if(!loaded || failed) return;
  var rd = routeData();
  if(ENGINE === "amap"){
    /* AMap: clear overlays and rebuild (simple, correct) */
    map.clearMap();
    addLayersAMap();
    syncMarkers();
    return;
  }
  map.getSource("lineV").setData(fc(rd.visited.length>1?rd.visited:null));
  map.getSource("lineF").setData(fc(rd.future.length>1?rd.future:null));
  map.getSource("stops").setData(stopsFc(rd.stops));
  map.getSource("arts").setData(artMarkers());
  syncMarkers();
}

/* ---------- failure / teardown (M21) ---------- */
function fail(msg){
  if(failed) return;
  failed = true;
  destroyPlayer();
  try{ clearMarkers(); }catch(e){}
  try{ if(map){ if(ENGINE === "amap" && map.destroy) map.destroy(); else if(map.remove) map.remove(); } }catch(e){}
  map = null;
  H.fail(msg || "三维地图初始化失败，已切回二维");
}

window.__MX3D_MODULE__ = {
  build:build, refresh:refresh, togglePlayer:togglePlayer, pause:pausePlayer,
  toggleFollow:toggleFollow, setFollow:setFollow,
  focusStop:focusStop, destroy:function(){ destroyPlayer(); try{ clearMarkers(); }catch(e){} try{ if(map){ if(ENGINE === "amap" && map.destroy) map.destroy(); else if(map.remove) map.remove(); } }catch(e){} map=null; loaded=false; },
  isReady:function(){ return loaded && !failed; }
};
})();
