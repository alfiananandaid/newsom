/**
 * =================================================================
 * SERVICE WORKER - PWA OFFLINE CACHE
 * =================================================================
 */

const CACHE_NAME = "so-mandiri-v2";

// Daftar file yang WAJIB disimpan ke memori HP agar bisa offline
const urlsToCache = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./manifest.json",
  // Library Eksternal (Barcode Scanner & Database Offline)
  "https://unpkg.com/html5-qrcode",
  "https://cdn.jsdelivr.net/npm/dexie@3.2.3/dist/dexie.js",
  "https://cdnjs.cloudflare.com/ajax/libs/quagga/0.12.1/quagga.min.js"
];

// 1. EVENT INSTALL: Download dan simpan semua file di atas ke Cache
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[Service Worker] Caching all assets");
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting();
});

// 2. EVENT ACTIVATE: Hapus cache versi lama jika ada update (misal jadi v2)
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log("[Service Worker] Clearing old cache");
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. EVENT FETCH: Strategi "Cache First, fallback to Network"
// Saat HP me-request file (html/css/js), cek dulu di cache HP.
// Jika ada, langsung tampilkan (cepat & bisa offline). Jika tidak, baru donwload.
self.addEventListener("fetch", (event) => {
  // Abaikan request API (Google Apps Script) agar tidak di-cache oleh Service Worker
  // (Karena urusan data SO / Master Data diurus terpisah oleh Dexie.js)
  if (event.request.url.includes("script.google.com")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      // Jika file ada di memori cache HP, kembalikan file tersebut
      if (response) {
        return response;
      }
      
      // Jika tidak ada di cache, paksa download dari internet
      return fetch(event.request).then((networkResponse) => {
        // Simpan file baru ini ke cache agar next time bisa offline (Dynamic Caching)
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        
        let responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        
        return networkResponse;
      }).catch(() => {
        // Jika offline total dan file tidak ada di cache, abaikan saja
        console.log("[Service Worker] Fetch failed, no internet and no cache.");
      });
    })
  );
});
