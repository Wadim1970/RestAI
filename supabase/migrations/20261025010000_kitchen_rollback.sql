-- Откат 20261025010000_kitchen.sql. ВНИМАНИЕ: стоп-лист, «срочно продать» и
-- время готовности блюд будут потеряны.
BEGIN;
DROP FUNCTION IF EXISTS public.guest_menu_priorities(uuid);
DROP TRIGGER IF EXISTS order_items_ready_at ON public.order_items;
DROP FUNCTION IF EXISTS public.order_items_ready_at();
DROP INDEX IF EXISTS public.order_items_ready_at_idx;
ALTER TABLE public.order_items DROP COLUMN IF EXISTS ready_at;
ALTER TABLE public.menu_items
  DROP COLUMN IF EXISTS stop_until,
  DROP COLUMN IF EXISTS stop_note,
  DROP COLUMN IF EXISTS urgent_until,
  DROP COLUMN IF EXISTS urgent_note;
COMMIT;
NOTIFY pgrst, 'reload schema';
