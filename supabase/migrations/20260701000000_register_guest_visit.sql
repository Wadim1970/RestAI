-- ============================================================
-- Атомарная регистрация визита гостя (фикс гонки visit_count)
--
-- ЗАЧЕМ:
--   App.jsx делал read (select visit_count) -> посчитать +1 в браузере ->
--   write (update). Два почти одновременных запроса (React StrictMode
--   в dev дважды подряд вызывает эффект, два таба, счастливое совпадение
--   по времени) читают одно и то же старое значение и оба пишут одно и
--   то же новое — один инкремент теряется.
--
--   INSERT ... ON CONFLICT ... DO UPDATE SET visit_count = visit_count + 1
--   выполняется атомарно внутри Postgres: инкремент берёт значение
--   ИМЕННО в момент своего выполнения, конкурентный запрос ждёт своей
--   очереди, а не читает устаревшее число. Гонка невозможна структурно.
--
-- Условие уже выполнено: guests.device_id имеет UNIQUE (guests_device_id_key).
--
-- Запускать из-под supabase_admin (см. server/README у Waiter-app —
-- то же правило: суперюзер должен быть владельцем/иметь права на guests):
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260701000000_register_guest_visit.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.register_guest_visit(p_device_id text)
RETURNS TABLE (id bigint, visit_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.guests (device_id, visit_count, created_at, last_visit_at)
  VALUES (p_device_id, 1, now(), now())
  ON CONFLICT (device_id) DO UPDATE
    SET visit_count = COALESCE(guests.visit_count, 0) + 1,
        last_visit_at = now()
  RETURNING guests.id, guests.visit_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_guest_visit(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
