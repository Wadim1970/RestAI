-- ============================================================
-- get_active_table_session — жива ли активная сессия у стола (по ресторану
-- и номеру стола), БЕЗ её создания.
--
-- ЗАЧЕМ:
--   При повторном открытии приложения гостя (свернул/закрыл и вернулся) надо
--   понять: стол ещё открыт или его закрыли/оплатили, пока приложение было
--   закрыто. mark_table_occupied для этого не годится — она get-or-create,
--   т.е. пересоздала бы «занятую» сессию (фантомный «Занят»). Эта функция
--   только ЧИТАЕТ активную сессию: есть — продолжаем, нет — уводим гостя на
--   скан QR.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260725030000_get_active_table_session.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_active_table_session(
  p_restaurant_id uuid,
  p_table_number  text
)
RETURNS TABLE (session_id uuid, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ts.id, ts.status
  FROM public.table_sessions ts
  JOIN public.tables t ON t.id = ts.table_id
  WHERE t.restaurant_id = p_restaurant_id
    AND t.number = p_table_number::integer
    AND ts.is_active = true
  ORDER BY ts.started_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_table_session(uuid, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
