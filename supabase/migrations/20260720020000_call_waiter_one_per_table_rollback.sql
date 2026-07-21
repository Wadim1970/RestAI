-- Откат «один вызов на стол»: убираем уникальный индекс и возвращаем
-- call_waiter к простому INSERT без переиспользования (как в
-- 20260716010000_call_waiter_reason.sql).
BEGIN;

DROP INDEX IF EXISTS public.waiter_calls_one_pending_per_table;

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

  INSERT INTO public.waiter_calls (restaurant_id, table_id, table_number, target_waiter_id, status, reason)
  VALUES (p_restaurant_id, v_table_id, p_table_number, v_target, 'pending', NULLIF(btrim(p_reason), ''))
  RETURNING id INTO v_call_id;

  RETURN v_call_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.call_waiter(uuid, text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
