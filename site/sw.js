/* MaoXuan Viz sw.js v9: 修 cleanUrls 下 HTML 被判成 data(缓存优先) 导致旧页面常驻 */
var CACHE = "mx-v9";
var SHELL = [
  "./", "./index.html", "./app.js", "./manifest.webmanifest",
  "./assets/leaflet.js", "./assets/leaflet.css",
  "./data/data.js", "./assets/china.json.js",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/icon-32.png", "./icons/apple-touch-icon.png"
];
var MAX_TEXTS = 260;          /* runtime cache cap for article texts */
var MAX_TILES = 420;          /* runtime cache cap for map tiles */

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){
    return c.addAll(SHELL).catch(function(){ /* partial ok */ });
  }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== CACHE; })
      .map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

function trimCache(name, max){
  return caches.open(name).then(function(c){
    return c.keys().then(function(keys){
      if(keys.length <= max) return;
      return c.delete(keys[0]).then(function(){ return trimCache(name, max); });
    });
  });
}

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;
  var url = new URL(req.url);

  /* map tiles: cache-first, trimmed */
  if(url.pathname.indexOf("/tiles/") !== -1){
    e.respondWith(
      caches.open(CACHE).then(function(c){
        return c.match(req).then(function(hit){
          if(hit) return hit;
          return fetch(req).then(function(res){
            if(res.ok) c.put(req, res.clone()).then(function(){ trimCache(CACHE, MAX_TILES + SHELL.length + MAX_TEXTS); });
            return res;
          });
        });
      })
    );
    return;
  }

  /* P03/T48: app shell (HTML/JS/CSS/manifest) → network-first.
     部署后首次访问即拿到新版本；断网时回落到缓存（离线阅读仍可用）。 */
  /* v9 修复: Vercel cleanUrls 下 /research 这类无扩展 URL 之前落到 data 分支(缓存优先),
     部署后仍返回旧 HTML(实测旧版「保存为研究卡」按钮因此一直不可见)。
     navigation request 一律按 shell 处理 → network-first。 */
  var isNav = req.mode === "navigate" || req.destination === "document";
  var isShell = isNav || /\.(html|js|css|webmanifest)$/i.test(url.pathname) || url.pathname === "/" || url.pathname.slice(-1) === "/";
  if(url.origin === location.origin && isShell){
    e.respondWith(
      caches.open(CACHE).then(function(c){
        return fetch(req).then(function(res){
          if(res && res.ok) c.put(req, res.clone());
          return res;
        }).catch(function(){
          return c.match(req).then(function(hit){ return hit || Response.error(); });
        });
      })
    );
    return;
  }

  /* same-origin texts/data: cache-first, revalidate in background (rarely change) */
  if(url.origin === location.origin){
    e.respondWith(
      caches.open(CACHE).then(function(c){
        return c.match(req).then(function(hit){
          var net = fetch(req).then(function(res){
            if(res && res.ok){
              c.put(req, res.clone());
              if(url.pathname.indexOf("/data/texts/") !== -1) trimCache(CACHE, MAX_TILES + SHELL.length + MAX_TEXTS);
            }
            return res;
          }).catch(function(){
            return hit || Response.error();
          });
          return hit || net;
        });
      })
    );
    return;
  }
  /* cross-origin (echarts CDN etc.): plain network */
});
