-- ============================================================
-- ОТКАТ фикса перегрузки call_waiter — воссоздаёт устаревшую
-- 2-аргументную функцию call_waiter(uuid, text) в том виде, в каком её
-- создавала первая миграция.
--
-- ВНИМАНИЕ: применение этого отката ВОЗВРАЩАЕТ состояние с двумя
-- перегрузками, из-за которого PostgREST снова падает с PGRST203 и связь
-- гость↔официант рвётся. Файл нужен только для формального полного отката;
-- в нормальной эксплуатации запускать его НЕ следует.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260722010000_call_waiter_fix_overload_rollback.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.call_waiter(
  p_restaurant_id uuid,
  p_table_number text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_id   uuid;
  v_waiter_ids uuid[];
  v_target     uuid;
  v_call_id    uuid;
  v_today      date := now()::date;
BEGIN
  IF p_table_number IS NULL OR btrim(p_table_number) = '' OR p_table_number = 'null' THEN
    RAISE EXCEPTION 'Не удалось определить номер стола';
  END IF;

  SELECT id INTO v_table_id
  FROM public.tables
  WHERE restaurant_id = p_restaurant_id
    AND number = p_table_number::integer
    AND is_active = true;

  IF v_table_id IS NULL THEN
    RAISE EXCEPTION 'Стол % не найден для этого ресторана', p_table_number;
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT wta.waiter_id
    FROM public.waiter_table_assignments wta
    WHERE wta.table_id = v_table_id
      AND (wta.assigned_date = v_today OR wta.is_permanent = true)
  ) INTO v_waiter_ids;

  IF array_length(v_waiter_ids, 1) = 1 THEN
    v_target := v_waiter_ids[1];
  ELSE
    v_target := NULL;
  END IF;

  INSERT INTO public.waiter_calls (restaurant_id, table_id, table_number, target_waiter_id, status)
  VALUES (p_restaurant_id, v_table_id, p_table_number, v_target, 'pending')
  RETURNING id INTO v_call_id;

  RETURN v_call_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.call_waiter(uuid, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
