const CACHE_NAME = "harbor-log-v1";
const APP_FILES = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest", "./assets/icon.svg"];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(APP_FILES); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) { return key !== CACHE_NAME; }).map(function (key) { return caches.delete(key); }));
  }));
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then(function (cached) { return cached || fetch(event.request); }));
});
