/* MaoXuan Viz sw.js v6: de3d (P01.4) — bump cache name to evict pre-de3d shell */ 
var CACHE = "mx-v6";
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

  /* same-origin app assets & texts: cache-first, revalidate in background */
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
