/*
 * عامل الخدمة (Service Worker) لتثبيت التطبيق على الهاتف وتشغيله بلا شبكة عند الحاجة.
 *
 * قواعد أمنية مقصودة:
 * - لا يُخزَّن أي طلب إلى /api/: بيانات الموردين والكشوفات مالية ولا يجوز بقاؤها
 *   في ذاكرة المتصفح بعد الخروج، حتى لو كانت الاستجابة لا تحمل أسراراً.
 * - واجهة التطبيق (HTML/JS/CSS/أيقونات) تُخزَّن لأنها عامة ولا تحتوي بيانات مستخدم.
 * - فتح أي صفحة يفضّل الشبكة دائماً (network-first) فلا تظهر نسخة قديمة بعد النشر،
 *   ولا يُستخدم المخزون إلا عند انقطاع الاتصال.
 */
const VERSION = 'v1';
const SHELL_CACHE = `mushabaka-shell-${VERSION}`;
const ASSET_CACHE = `mushabaka-assets-${VERSION}`;
const SHELL_URLS = ['/', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_URLS);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      for (const key of await caches.keys()) {
        if (!keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // لا تخزين لأي بيانات مالية

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          if (fresh.ok) {
            const cache = await caches.open(SHELL_CACHE);
            await cache.put('/', fresh.clone());
          }
          return fresh;
        } catch {
          const cached = await caches.match('/');
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || /\.(?:css|js|png|svg|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const fresh = await fetch(request);
        if (fresh.ok) {
          const cache = await caches.open(ASSET_CACHE);
          await cache.put(request, fresh.clone());
        }
        return fresh;
      })(),
    );
  }
});
