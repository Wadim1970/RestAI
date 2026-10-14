-- Откат 20261014010000_menu_items_hidden.sql
BEGIN;
ALTER TABLE public.menu_items DROP COLUMN IF EXISTS is_hidden;
COMMIT;
