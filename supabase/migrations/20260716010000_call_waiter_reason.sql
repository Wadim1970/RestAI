-- ============================================================
-- Причина вызова официанта — необязательный текст, который передаётся
-- вместе с вызовом (сейчас источник один: голосовой ИИ-ассистент,
-- слышит от гостя "убери со стола" и т.п.), чтобы официант заранее знал,
-- зачем идёт. Кнопка-звонок в MenuFooter продолжает работать без
-- изменений — параметр необязательный, значение по умолчанию NULL.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260716010000_call_waiter_reason.sql
-- ============================================================

BEGIN;

ALTER TABLE public.waiter_calls ADD COLUMN IF NOT EXISTS reason text;

-- CREATE OR REPLACE с новым параметром В КОНЦЕ списка и значением по
-- умолчанию — по правилам Postgres это заменяет функцию на месте (тот
-- же OID, те же гранты остаются в силе), а не создаёт вторую
-- перегруженную функцию с тем же именем. Существующие вызовы с двумя
-- аргументами продолжают резолвиться в неё же, reason = NULL.
CREATE OR REPLACE FUNCTION public.call_waiter(
  p_restaurant_id uuid,
  p_table_number text,
  p_reason text DEFAULT NULL
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

  -- Официанты, закреплённые за этим столом сегодня (та же логика,
  -- что и getMyTables в Waiter-app: assigned_date=сегодня ИЛИ is_permanent).
  SELECT ARRAY(
    SELECT DISTINCT wta.waiter_id
    FROM public.waiter_table_assignments wta
    WHERE wta.table_id = v_table_id
      AND (wta.assigned_date = v_today OR wta.is_permanent = true)
  ) INTO v_waiter_ids;

  -- Ровно один закреплённый — вызов целевой; 0 или несколько — широковещательный.
  IF array_length(v_waiter_ids, 1) = 1 THEN
    v_target := v_waiter_ids[1];
  ELSE
    v_target := NULL;
  END IF;

  INSERT INTO public.waiter_calls (restaurant_id, table_id, table_number, target_waiter_id, status, reason)
  VALUES (p_restaurant_id, v_table_id, p_table_number, v_target, 'pending', NULLIF(btrim(p_reason), ''))
  RETURNING id INTO v_call_id;

  RETURN v_call_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.call_waiter(uuid, text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
