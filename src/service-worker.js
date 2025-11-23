/**
 * Service Worker for Divvun Web Editor
 * Handles caching strategy and version updates
 */

const CACHE_NAME = "divvun-editor-v1";
const ASSETS_TO_CACHE = [
  "/",
  "/style.css",
  "/main.js",
  "/quill-bridge.js",
  "https://cdn.quilljs.com/1.3.7/quill.min.js",
  "https://cdn.quilljs.com/1.3.7/quill.snow.css",
];

// Install event - cache assets
self.addEventListener("install", (event) => {
  console.log("Service Worker: Installing...");
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log("Service Worker: Caching assets");
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        // Force activation immediately
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  console.log("Service Worker: Activating...");
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log("Service Worker: Clearing old cache:", cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        // Take control of all clients immediately
        return self.clients.claim();
      })
  );
});

// Fetch event - network first, then cache
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip service worker for API requests - always go directly to network
  if (
    url.hostname.includes("api.giellalt.org") ||
    url.hostname.includes("api-giellalt.uit.no")
  ) {
    return; // Don't intercept, let the request go through normally
  }

  // For HTML pages, always go network first to check for new versions
  if (event.request.mode === "navigate" || url.pathname === "/") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Only cache GET requests (Cache API doesn't support POST/PUT/DELETE)
          if (event.request.method === "GET") {
            // Clone the response before caching
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // If network fails, try cache
          return caches.match(event.request);
        })
    );
    return;
  }

  // For versioned assets (with ?v= parameter), cache first is fine
  // since new versions have different URLs
  if (url.search.includes("v=")) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((response) => {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return response;
        });
      })
    );
    return;
  }

  // For other assets, network first
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache GET requests (Cache API doesn't support POST/PUT/DELETE)
        if (event.request.method === "GET") {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// Listen for messages from the client
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
