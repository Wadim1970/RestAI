-- Откат 20261104010000_menu_item_video.sql: колонка и ссылки на видео удаляются
-- (сами файлы в хранилище остаются).
BEGIN;
ALTER TABLE public.menu_items DROP COLUMN IF EXISTS video_url;
COMMIT;
NOTIFY pgrst, 'reload schema';
