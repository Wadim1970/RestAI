// Минимальный service worker — нужен только для установки PWA (Android
// проверяет его наличие при показе beforeinstallprompt). Никакого кэша
// сознательно не делаем: старое приложение официанта уже словило баг с
// залипшим содержимым из-за агрессивного SW-кэша — здесь просто
// прозрачно пропускаем сеть, ничего не сохраняем.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', () => {
  // Пусто: не перехватываем ответ, браузер идёт в сеть как обычно.
})
