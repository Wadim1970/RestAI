-- ============================================================
-- Короткое видео блюда (5 секунд) вместо фото в карточке блюда.
--
-- Колонка video_url в menu_items: ссылка на ролик. Пусто — карточка
-- показывает фото, как раньше. Ссылка может быть абсолютной (Supabase Storage,
-- CDN) или от корня сайта (/dish-video/<файл>.mp4 — файл лежит в public/).
--
-- Пока видео только у «Фокаччи с Бурратой и томатами»: блюдо стоит в двух
-- разделах («Популярное» и «Фокачча и брускетта»), обновляются обе строки.
--
-- Идемпотентно. Запускать из-под supabase_admin (или в Studio → SQL Editor).
-- ============================================================

BEGIN;

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS video_url text;

COMMENT ON COLUMN public.menu_items.video_url IS
  'Короткое видео блюда для карточки (mp4/webm). NULL — показываем фото image_url.';

UPDATE public.menu_items
   SET video_url = '/dish-video/focaccia-burrata.mp4'
 WHERE dish_name = 'Фокачча с Бурратой и томатами'
   AND video_url IS NULL;

COMMIT;
