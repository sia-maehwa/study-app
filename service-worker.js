'use strict';

const CACHE_NAME = 'social-culture-study-shell-v17';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest?v=20261116-name-2',
  './assets/app-icon.svg',
  './assets/app-icon-192.png',
  './assets/app-icon-512.png',
  './css/style.css',
  './courses/social-culture/content.js',
  './courses/social-culture/assessments.js',
  './courses/english/assessments.js',
  './assets/exams/2026_suneung_english_odd/pages/page-01.jpg',
  './assets/exams/2026_suneung_english_odd/pages/page-02.jpg',
  './assets/exams/2026_suneung_english_odd/pages/page-03.jpg',
  './assets/exams/2026_suneung_english_odd/pages/page-04.jpg',
  './assets/exams/2026_suneung_english_odd/pages/page-05.jpg',
  './assets/exams/2026_suneung_english_odd/pages/page-06.jpg',
  './assets/exams/2026_suneung_english_odd/pages/page-07.jpg',
  './assets/exams/2026_suneung_english_odd/pages/page-08.jpg',
  './assets/audio/2026_suneung_english_listening.mp3',
  './js/data.js',
  './js/course-registry.js',
  './js/exams.js',
  './js/storage.js',
  './js/predict.js',
  './js/assessment-engine.js',
  './js/game.js',
  './js/pen-tools.js?v=20261117-ai-report-1',
  './js/exam-app.js?v=20261117-english-image-pen-fix-1',
  './js/analytics.js?v=20261117-learning-analytics-1',
  './js/app.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('social-culture-study-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin ||
      !requestUrl.href.startsWith(self.registration.scope)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(new URL('./index.html', self.registration.scope), response.clone());
        }
        return response;
      } catch {
        return (await caches.match(new URL('./index.html', self.registration.scope))) ||
          new Response('오프라인 상태입니다. 인터넷에 연결한 뒤 다시 열어 주세요.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    // Stable exam images are cache-first; app scripts and styles are network-first
    // so deployed updates become available without clearing the user's site data.
    if (request.destination === 'image') {
      const cachedImage = await caches.match(request);
      if (cachedImage) return cachedImage;
    }

    try {
      const response = await fetch(request);
      if (response && response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return (await caches.match(request)) ||
        new Response('', { status: 504, statusText: 'Offline resource unavailable' });
    }
  })());
});