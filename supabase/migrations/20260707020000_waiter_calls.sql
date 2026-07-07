-- ============================================================
-- Живой вызов официанта: кнопка с колокольчиком в гостевом
-- приложении (MenuFooter, сейчас console.log-заглушка) -> звук
-- и вибро на приложении официанта (глобально, поверх любого экрана)
-- -> гость видит момент, когда официант откликнулся.
--
-- Адресация вызова (решение по обсуждению):
--   - если за столом на сегодня закреплён РОВНО один официант
--     (waiter_table_assignments) — вызов целевой, target_waiter_id
--     проставлен, получает только он;
--   - если закреплено 0 или несколько — target_waiter_id = NULL,
--     вызов широковещательный: получают все официанты, у кого
--     сегодня подтверждена смена в этом ресторане (тот же критерий,
--     что в hasConfirmedShiftToday на стороне Waiter-app).
--   Фильтрация "моя ли это смена/цель" — на клиенте официанта при
--   получении события (Realtime не умеет OR/IS NULL в filter, только
--   одно равенство), сам INSERT виден всем официантам этого ресторана
--   через фильтр по restaurant_id.
--
-- Гонка при широковещательном вызове (несколько официантов жмут "Иду"
-- одновременно): acknowledge_waiter_call обновляет только если
-- status ещё 'pending' — первый выигрывает, остальные получают false
-- и молча закрывают свою модалку (событие UPDATE придёт всем через
-- тот же Realtime).
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260707020000_waiter_calls.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.waiter_calls (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid NOT NULL REFERENCES public.restaurants(id),
  table_id         uuid NOT NULL REFERENCES public.tables(id),
  table_number     text NOT NULL,
  target_waiter_id uuid NULL REFERENCES public.waiters(id),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged')),
  acknowledged_by  uuid NULL REFERENCES public.waiters(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  acknowledged_at  timestamptz NULL
);

CREATE INDEX IF NOT EXISTS waiter_calls_restaurant_status_idx
  ON public.waiter_calls (restaurant_id, status);

-- Нужно для фильтрованной Realtime-подписки (по id у гостя, по
-- restaurant_id у официанта) — без этого UPDATE-события могут
-- приходить без изменившихся полей на фильтре.
ALTER TABLE public.waiter_calls REPLICA IDENTITY FULL;

ALTER TABLE public.waiter_calls ENABLE ROW LEVEL SECURITY;

-- Низкая чувствительность данных (номер стола + статус, без PII) —
-- SELECT открыт всем ролям, как и у tables/orders. Запись — только
-- через SECURITY DEFINER функции ниже, прямых INSERT/UPDATE-грантов
-- нет вообще.
DROP POLICY IF EXISTS waiter_calls_select ON public.waiter_calls;
CREATE POLICY waiter_calls_select ON public.waiter_calls
  FOR SELECT TO anon, authenticated
  USING (true);

GRANT SELECT ON public.waiter_calls TO anon, authenticated;

-- ------------------------------------------------------------
-- Создать вызов (гость, кнопка с колокольчиком)
-- ------------------------------------------------------------
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

  INSERT INTO public.waiter_calls (restaurant_id, table_id, table_number, target_waiter_id, status)
  VALUES (p_restaurant_id, v_table_id, p_table_number, v_target, 'pending')
  RETURNING id INTO v_call_id;

  RETURN v_call_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.call_waiter(uuid, text) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Откликнуться на вызов (официант, кнопка "Иду")
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acknowledge_waiter_call(
  p_call_id uuid,
  p_waiter_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated boolean;
BEGIN
  UPDATE public.waiter_calls
  SET status = 'acknowledged',
      acknowledged_by = p_waiter_id,
      acknowledged_at = now()
  WHERE id = p_call_id
    AND status = 'pending';

  v_updated := FOUND;
  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.acknowledge_waiter_call(uuid, uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Realtime
-- ------------------------------------------------------------
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'waiter_calls'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.waiter_calls;
  END IF;
END $do$;

NOTIFY pgrst, 'reload schema';

COMMIT;
