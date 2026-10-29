/* MaoXuan Viz sw.js v11
 * v9: 修 cleanUrls 下 HTML 被判成 data(缓存优先) 导致旧页面常驻
 * v10 (R05): 正文改由 /api/text 提供 —— 浏览器的缓存策略随之调整：
 *   · 正文响应仍走"缓存优先 + 后台刷新"，断网可继续读已读篇目；
 *   · /api/text?check=1 这类运维自检不进缓存，避免把"当时没配密钥"的结果缓存一年；
 *   · CACHE 版本号提升，旧 worker 缓存整体作废，用户不需要手动清缓存。
 * v11 (R21): 全站设计令牌抽取为 lib/mx-tokens.css（页面壳不变，CSS 升版作废旧缓存）。 */
var CACHE = "mx-v11";
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

  /* 运维自检接口不进缓存 */
  if (url.pathname === "/api/text" && url.searchParams.get("check")) return;

  /* same-origin texts/data: cache-first, revalidate in background (rarely change) */
  if(url.origin === location.origin){
    e.respondWith(
      caches.open(CACHE).then(function(c){
        return c.match(req).then(function(hit){
          var net = fetch(req).then(function(res){
            if(res && res.ok){
              c.put(req, res.clone());
              /* R05: 正文现在来自 /api/text（旧地址 /data/texts/ 会被重写），两处都计入文本缓存配额 */
              if(url.pathname.indexOf("/data/texts/") !== -1 || url.pathname === "/api/text") {
                trimCache(CACHE, MAX_TILES + SHELL.length + MAX_TEXTS);
              }
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
