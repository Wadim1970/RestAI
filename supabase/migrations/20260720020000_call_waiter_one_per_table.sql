-- ============================================================
-- Один активный вызов официанта на стол.
-- До этого call_waiter делал простой INSERT: двое гостей за одним столом
-- (или быстрые повторные тапы под нагрузкой) плодили десятки дублей-вызовов,
-- флудили официанта и раскачивали Realtime. Теперь:
--   - партиальный уникальный индекс: максимум ОДИН pending-вызов на стол;
--   - call_waiter переиспользует уже висящий pending-вызов (возвращает его id),
--     а не создаёт новый — второй гость подпишется на тот же вызов и увидит
--     «Уже иду». Новый вызов появится только когда текущий принят/отменён.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260720020000_call_waiter_one_per_table.sql
-- ============================================================

BEGIN;

-- 1) Подчистить дубли, накопившиеся во время сбоя: на каждый стол оставить
--    самый ранний pending, остальные пометить cancelled — иначе уникальный
--    индекс ниже не создастся.
UPDATE public.waiter_calls wc
SET status = 'cancelled'
WHERE wc.status = 'pending'
  AND wc.id <> (
    SELECT w2.id FROM public.waiter_calls w2
    WHERE w2.table_id = wc.table_id AND w2.status = 'pending'
    ORDER BY w2.created_at ASC, w2.id ASC
    LIMIT 1
  );

-- 2) Максимум один pending-вызов на стол (acknowledged/cancelled в истории
--    не мешают — индекс частичный, только по pending).
CREATE UNIQUE INDEX IF NOT EXISTS waiter_calls_one_pending_per_table
  ON public.waiter_calls (table_id)
  WHERE status = 'pending';

-- 3) call_waiter: сперва ищем висящий pending этого стола и возвращаем его;
--    иначе вставляем новый. ON CONFLICT по частичному индексу защищает от
--    гонки двух одновременных вызовов (второй переиспользует первый).
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

  -- Уже висит вызов за этим столом — переиспользуем его.
  SELECT id INTO v_call_id
  FROM public.waiter_calls
  WHERE table_id = v_table_id AND status = 'pending'
  LIMIT 1;
  IF v_call_id IS NOT NULL THEN
    RETURN v_call_id;
  END IF;

  -- Адресат (как раньше): ровно один закреплённый — целевой; иначе broadcast.
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
  ON CONFLICT (table_id) WHERE status = 'pending' DO NOTHING
  RETURNING id INTO v_call_id;

  -- Гонка: между SELECT и INSERT кто-то успел вставить — берём его вызов.
  IF v_call_id IS NULL THEN
    SELECT id INTO v_call_id
    FROM public.waiter_calls
    WHERE table_id = v_table_id AND status = 'pending'
    LIMIT 1;
  END IF;

  RETURN v_call_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.call_waiter(uuid, text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
