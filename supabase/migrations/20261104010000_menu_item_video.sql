-- ============================================================
-- Видео блюда: короткое вертикальное видео вместо фото в окне блюда.
--
-- menu_items.video_url — ссылка на файл (как image_url), целиком: при переезде
-- на другое хранилище/CDN меняется только адрес в ссылках, приложение не
-- переписывается. Файлы кладёт deploy/images/upload-dish-videos.mjs в bucket
-- menu-videos: <id ресторана>/dishes/<id блюда>_<хэш>.mp4. NULL — видео нет,
-- гость видит фото.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261104010000_menu_item_video.sql
-- Откат: 20261104010000_menu_item_video_rollback.sql
-- ============================================================

BEGIN;

ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS video_url text;
COMMENT ON COLUMN public.menu_items.video_url IS
  'Ссылка на короткое вертикальное видео блюда (MP4, 9:16, без звука). NULL — видео нет, показывается фото.';

COMMIT;
NOTIFY pgrst, 'reload schema';
