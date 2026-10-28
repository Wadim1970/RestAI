-- ============================================================
-- Убрать старые черновики корзины гостя.
--
-- Корзина гостя теперь — строки общего заказа стола (20261028010000), черновики
-- guest_cart_drafts и три функции вокруг них никому не нужны:
--   • sync_guest_cart(...)        — телефон гостя копировал корзину в черновик;
--   • get_table_cart_drafts(...)  — официант читал черновики;
--   • take_guest_cart(...)        — официант «брал» черновик в заказ (из-за неё
--                                   заказ задваивался).
-- release_table_if_occupied больше не чистит черновики (остаётся очистка
-- корзин-строк заказа).
--
-- Перед удалением миграция проверяет, что ни одна другая функция в базе не
-- ссылается на эти объекты, иначе останавливается ничего не изменив.
--
-- Данные в таблице (на момент подготовки 39 строк, почти все старше нескольких
-- дней) не восстанавливаются откатом: откат возвращает структуру и функции.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261029020000_drop_cart_drafts.sql
-- Откат: 20261029020000_drop_cart_drafts_rollback.sql
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_names text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_names
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname NOT IN ('sync_guest_cart', 'take_guest_cart', 'get_table_cart_drafts', 'release_table_if_occupied')
    AND p.prosrc ~ 'guest_cart_drafts|sync_guest_cart|take_guest_cart|get_table_cart_drafts';
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'Эти функции ещё ссылаются на черновики: %. Ничего не удалено.', v_names;
  END IF;
END $$;

-- release_table_if_occupied — уже без черновиков.
CREATE OR REPLACE FUNCTION public.release_table_if_occupied(p_session_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_done boolean := false;
BEGIN
  UPDATE public.table_sessions
  SET is_active = false, ended_at = now(), status = 'free'
  WHERE id = p_session_id
    AND is_active = true
    AND status = 'occupied';
  GET DIAGNOSTICS v_done = ROW_COUNT;
  IF v_done THEN
    -- Стол свободен, ничего не отправлено: корзины гостей (строки 'new') и
    -- пустой заказ этой посадки убираем, чтобы не висели на закрытом столе.
    DELETE FROM public.order_items oi
    USING public.orders o
    WHERE oi.order_id = o.id
      AND o.table_session_id = p_session_id
      AND o.status IN ('new', 'cooking')
      AND oi.status = 'new';

    DELETE FROM public.orders o
    WHERE o.table_session_id = p_session_id
      AND o.status = 'new'
      AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id);
  END IF;
  RETURN v_done;
END;
$function$;

DROP FUNCTION IF EXISTS public.sync_guest_cart(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.get_table_cart_drafts(uuid);
DROP FUNCTION IF EXISTS public.take_guest_cart(uuid, integer);
DROP TABLE IF EXISTS public.guest_cart_drafts;

COMMIT;
NOTIFY pgrst, 'reload schema';
