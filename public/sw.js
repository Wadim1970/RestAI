// Service worker гостя: установка PWA + аккуратный оффлайн-кэш.
//
// Раньше здесь сознательно не было кэша — старое приложение официанта словило
// баг с залипшим контентом из-за наивной стратегии «кэш-первым» на HTML.
// Здесь стратегия другая и от залипания защищена:
//   • навигация (index.html) и меню (/api/menu) — СЕТЬ-ПЕРВОЙ: при связи
//     всегда свежее, кэш служит лишь резервом на оффлайн;
//   • хэшированные ассеты /assets/* — кэш-первым, но их имена уникальны на
//     каждый билд, поэтому «застрять» на старой версии невозможно;
//   • при активации новой версии SW старый кэш удаляется (см. CACHE + activate).
// Бампни версию в CACHE при значимых изменениях этого файла.
const CACHE = 'restai-cache-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response && response.ok) cache.put(cacheKey, response.clone())
    return response
  } catch (err) {
    const cached = await cache.match(cacheKey)
    if (cached) return cached
    throw err
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response && response.ok) cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return // заказы/вызовы (POST) не трогаем

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // Supabase и сторонние — мимо

  // Навигация → оболочка приложения.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/'))
    return
  }
  // Меню — свежее при связи, последнее известное при оффлайне.
  if (url.pathname === '/api/menu') {
    event.respondWith(networkFirst(request, request.url))
    return
  }
  // Неизменяемые ассеты билда.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request))
    return
  }
  // Остальное — обычной дорогой в сеть.
})
