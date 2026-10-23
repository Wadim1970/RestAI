// Картинки блюда. Миниатюры части блюд (image_url_thumbnail) остались на
// старом облачном Supabase-проекте, которого больше нет — его домен даже не
// существует, и запрос к нему только тянет время до ошибки (в «Шеф советует»
// на месте фото оставалась пустая белая плашка). Такие ссылки не используем
// и берём само фото блюда (image_url).
const DEAD_HOSTS = ['utdfzrpkoscyikitceow.supabase.co'];

const isDead = (url) => DEAD_HOSTS.some((host) => url.includes(host));

// Маленькая картинка (карточки, подсказки): миниатюра, иначе само фото.
export function dishThumb(dish) {
  const thumb = dish?.image_url_thumbnail;
  if (thumb && !isDead(thumb)) return thumb;
  return dish?.image_url || null;
}

// Крупное фото: само фото, иначе живая миниатюра.
export function dishPhoto(dish) {
  return dish?.image_url || dishThumb(dish);
}

// Короткое видео блюда (menu_items.video_url) — вместо фото в карточке.
// Нет ссылки — null, карточка показывает фото. Только http(s) и путь от корня
// сайта: чужие схемы (javascript:, data:) в src не пускаем.
export function dishVideo(dish) {
  const url = typeof dish?.video_url === 'string' ? dish.video_url.trim() : '';
  return /^(https?:\/\/|\/(?!\/))/i.test(url) ? url : null;
}

// onError для <img>: миниатюра не загрузилась — один раз пробуем само фото,
// не вышло и оно — прячем картинку (остаётся тёмная плашка).
export function fallbackToPhoto(dish) {
  return (e) => {
    const img = e.currentTarget;
    if (dish?.image_url && img.dataset.fallback !== '1') {
      img.dataset.fallback = '1';
      img.src = dish.image_url;
    } else {
      img.style.visibility = 'hidden';
    }
  };
}
