-- ============================================================
-- Раздел «Кухня» в админке: стоп-лист, «срочно продать», время готовности.
--
-- 1) menu_items.stop_until — блюдо в стопе, пока now() < stop_until
--    («до конца дня» — до 06:00 следующего дня ресторана, «до отмены» —
--    'infinity'). Гость видит «нет в наличии», ИИ и подсказки его не
--    предлагают. stop_note — для своих («закончился лосось»).
-- 2) menu_items.urgent_until — «срочно продать» (последний день
--    реализации и т. п.): в подсказки гостю и официанту — в первую очередь.
--    Постоянный приоритет по марже — как и был, menu_item_costing.push_priority.
-- 3) order_items.ready_at — когда блюдо отметили готовым (официант в
--    приложении — статус 'ready'; позже — POS кухни). Ставится само при
--    смене статуса на 'ready'. Норматив — menu_items.cook_time_min, отсчёт —
--    от sent_at (заказ ушёл на кухню).
-- 4) guest_menu_priorities(restaurant) — какие блюда рекомендовать гостю в
--    первую очередь. Только уровень приоритета, без себестоимости и маржи:
--    menu_item_costing закрыта от публичного ключа и такой остаётся.
--
-- Запускать на сервере базы из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < /tmp/kitchen.sql
-- Откат: 20261025010000_kitchen_rollback.sql
-- ============================================================

BEGIN;

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS stop_until   timestamptz,
  ADD COLUMN IF NOT EXISTS stop_note    text,
  ADD COLUMN IF NOT EXISTS urgent_until timestamptz,
  ADD COLUMN IF NOT EXISTS urgent_note  text;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS ready_at timestamptz;

CREATE OR REPLACE FUNCTION public.order_items_ready_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'ready' AND NEW.ready_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ready') THEN
    NEW.ready_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_items_ready_at ON public.order_items;
CREATE TRIGGER order_items_ready_at
  BEFORE INSERT OR UPDATE OF status ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.order_items_ready_at();

CREATE INDEX IF NOT EXISTS order_items_ready_at_idx
  ON public.order_items (ready_at) WHERE ready_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guest_menu_priorities(p_restaurant_id uuid)
RETURNS TABLE (dish_id uuid, priority smallint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mi.id,
         GREATEST(COALESCE(c.push_priority, 0),
                  CASE WHEN mi.urgent_until > now() THEN 3 ELSE 0 END)::smallint
  FROM public.menu_items mi
  LEFT JOIN public.menu_item_costing c ON c.dish_id = mi.id
  WHERE mi.restaurant_id = p_restaurant_id
    AND (COALESCE(c.push_priority, 0) > 0 OR mi.urgent_until > now())
$$;

REVOKE ALL ON FUNCTION public.guest_menu_priorities(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_menu_priorities(uuid) TO anon, authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
