// Service worker визитки.
//
// Две задачи:
//   1) без зарегистрированного SW Chrome на Android вообще не предлагает
//      «Установить приложение» — то есть без этого файла иконки на экране не будет;
//   2) визитка должна открываться офлайн: человек поставил её на экран в ресторане,
//      а нажал уже в метро без связи.
//
// Стратегия для своих файлов — «кэш-первым»: карточка статическая, весит копейки,
// а обновление прилетает при следующем онлайн-заходе (см. revalidate ниже).
// При смене версии в CACHE старый кэш удаляется целиком.
const CACHE = 'card-v4'
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './img/photo.jpg',
  './img/logo.png',
  './img/qr.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // addAll падает целиком, если хоть один файл отсутствует (например, ещё не
      // сгенерирован qr.png) — кладём поштучно, чтобы установка не срывалась.
      await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})))
      self.skipWaiting()
    })(),
  )
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

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (new URL(request.url).origin !== self.location.origin) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const cached = await cache.match(request, { ignoreSearch: true })
      // Фоновое обновление: отдаём кэш мгновенно, свежую копию кладём на следующий раз.
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone())
          return response
        })
        .catch(() => cached)
      return cached || network
    })(),
  )
})
