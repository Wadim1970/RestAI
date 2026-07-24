-- ============================================================
-- ROLLBACK для 20260724020000_fix_mark_table_occupied_ambiguous.sql
--
-- Восстанавливает прежнюю (ДО фикса) версию mark_table_occupied из
-- миграции 20260722020000. ВНИМАНИЕ: та версия падает с ошибкой 42702
-- на каждом вызове (ради чего фикс и делался) — откатывать имеет смысл
-- только если сам фикс оказался проблемным.
--
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260724020000_fix_mark_table_occupied_ambiguous_rollback.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_table_occupied(
  p_restaurant_id uuid,
  p_table_number text
)
RETURNS TABLE (table_id uuid, session_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_id   uuid;
  v_session_id uuid;
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

  PERFORM pg_advisory_xact_lock(hashtextextended(v_table_id::text, 0));

  SELECT id INTO v_session_id
  FROM public.table_sessions
  WHERE table_id = v_table_id AND is_active = true
  LIMIT 1;

  IF v_session_id IS NULL THEN
    INSERT INTO public.table_sessions (table_id, restaurant_id, status, is_active, started_at)
    VALUES (v_table_id, p_restaurant_id, 'occupied', true, now())
    RETURNING id INTO v_session_id;
  END IF;

  RETURN QUERY SELECT v_table_id, v_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_table_occupied(uuid, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
