// Видео блюда в окне подробного описания (вертикальное, 9:16, без звука).
//
// Порядок для гостя: фото показывается сразу, видео грузится и, когда
// действительно заиграло, плавно заменяет фото. Нет видео, оно не загрузилось
// или не заиграло (энергосбережение iPhone, экономия трафика) — остаётся фото.

// Ссылка на видео блюда или null.
export function videoOf(dish) {
  const url = dish?.video_url;
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

// connection — navigator.connection (может не быть), reducedMotion — гость
// отключил анимации в системе.
export function canPlayVideo({ connection, reducedMotion } = {}) {
  if (reducedMotion) return false;
  if (connection?.saveData) return false;
  if (connection?.effectiveType && /(^|-)2g$/.test(connection.effectiveType)) return false;
  return true;
}

// Заранее подгружать видео соседнего блюда — только на быстрой сети: на 3G
// это отнимет канал у видео, которое смотрит гость.
export function canPrefetchVideo({ connection, reducedMotion } = {}) {
  if (!canPlayVideo({ connection, reducedMotion })) return false;
  const t = connection?.effectiveType;
  return !t || t === '4g';
}

// Соседи открытого блюда в разделе (листание свайпом), у которых есть видео.
export function neighborVideoUrls(siblings, dishId) {
  if (!Array.isArray(siblings) || !dishId) return [];
  const i = siblings.findIndex((d) => d.id === dishId);
  if (i < 0) return [];
  return [siblings[i + 1], siblings[i - 1]].map(videoOf).filter(Boolean);
}

// Предзагрузка: невидимый video с preload=auto. Держим не больше одного,
// чтобы не копить соединения.
let warm = null;
export function prefetchVideo(url) {
  if (typeof document === 'undefined' || !url) return;
  if (warm?.dataset.src === url) return;
  releasePrefetch();
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.dataset.src = url;
  v.src = url;
  warm = v;
}

export function releasePrefetch() {
  if (!warm) return;
  warm.removeAttribute('src');
  warm.load();
  warm = null;
}
