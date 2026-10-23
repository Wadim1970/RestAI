-- Откат 20261023010000_menu_items_video.sql
BEGIN;
ALTER TABLE public.menu_items DROP COLUMN IF EXISTS video_url;
COMMIT;
