-- ============================================================
-- Фикс: mark_table_occupied падал с ошибкой 42702
--   "column reference \"table_id\" is ambiguous".
--
-- ПРИЧИНА: функция объявлена как RETURNS TABLE (table_id uuid, session_id
-- uuid) — table_id становится выходной ПЕРЕМЕННОЙ. А в теле есть запрос к
-- public.table_sessions с "WHERE table_id = v_table_id", где table_id —
-- ещё и КОЛОНКА. PL/pgSQL не может решить, колонка это или переменная, и
-- падает — но только во ВРЕМЯ ВЫПОЛНЕНИЯ, поэтому исходная миграция
-- (20260722020000) накатилась без ошибок, а функция валилась на каждом
-- вызове. Из-за этого статус «Занят» никогда не проставлялся.
--
-- РЕШЕНИЕ: квалифицируем все ссылки на колонки псевдонимами таблиц
-- (t. для tables, ts. для table_sessions). Имена выходных колонок
-- (table_id, session_id) НЕ меняем — клиент читает row.session_id.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260724020000_fix_mark_table_occupied_ambiguous.sql
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

  SELECT t.id INTO v_table_id
  FROM public.tables t
  WHERE t.restaurant_id = p_restaurant_id
    AND t.number = p_table_number::integer
    AND t.is_active = true;

  IF v_table_id IS NULL THEN
    RAISE EXCEPTION 'Стол % не найден для этого ресторана', p_table_number;
  END IF;

  -- Сериализуем участок для этого стола: два гостя, сканирующие QR
  -- одновременно, не должны создать две сессии. Снимается в конце транзакции.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_table_id::text, 0));

  SELECT ts.id INTO v_session_id
  FROM public.table_sessions ts
  WHERE ts.table_id = v_table_id AND ts.is_active = true
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
