'use strict';

const CACHE_NAME = 'social-culture-study-shell-v18';
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

const OPTIONAL_ASSETS = [
  './assets/audio/2026_suneung_english_listening.mp3'
];

async function cachedRangeResponse(request, cachedResponse) {
  const range = request.headers.get('range');
  const size = Number(cachedResponse.headers.get('content-length'));
  const match = /^bytes=(\\d*)-(\\d*)$/.exec(range || '');
  if (!match || !Number.isFinite(size) || size <= 0) return cachedResponse;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!suffixLength) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start >= size || end < start) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }

  const headers = new Headers(cachedResponse.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
  headers.set('Content-Length', String(end - start + 1));

  if (!cachedResponse.body) {
    const buffer = await cachedResponse.arrayBuffer();
    return new Response(buffer.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers });
  }

  const reader = cachedResponse.body.getReader();
  let position = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        while (position <= end) {
          const part = await reader.read();
          if (part.done) {
            controller.close();
            return;
          }
          const chunkStart = position;
          const chunkEnd = position + part.value.byteLength - 1;
          position += part.value.byteLength;
          if (chunkEnd < start) continue;
          const from = Math.max(0, start - chunkStart);
          const to = Math.min(part.value.byteLength, end - chunkStart + 1);
          if (to > from) controller.enqueue(part.value.slice(from, to));
          if (chunkEnd >= end) {
            reader.cancel();
            controller.close();
            return;
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
  return new Response(stream, { status: 206, statusText: 'Partial Content', headers });
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => caches.open(CACHE_NAME))
      .then(cache => cache.addAll(OPTIONAL_ASSETS).catch(error => {
        /* 음원 저장 공간이 부족해도 앱 셸과 새 펜 입력 코드는 설치되어야 합니다. */
        console.warn('Optional offline audio cache was skipped:', error);
      }))
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
    if (request.headers.has('range')) {
      const fullRequest = new Request(request.url, { method: 'GET', credentials: request.credentials });
      const cachedFullAudio = await caches.match(fullRequest);
      if (cachedFullAudio) return cachedRangeResponse(request, cachedFullAudio);
      /* Range 응답(206)은 부분 데이터이므로 Cache API에 저장하지 않습니다. */
      return fetch(request);
    }

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