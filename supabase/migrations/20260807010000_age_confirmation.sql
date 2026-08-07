-- ============================================================
-- Подтверждение возраста официантом при заказе алкоголя гостем.
--
-- Когда гость сам (без официанта) кладёт в корзину позицию с
-- product_type='alcohol' и жмёт «Отправить заказ», заказ НЕ уходит на
-- кухню сразу. Вместо этого создаётся вызов официанта того же рода, что и
-- обычный (та же таблица waiter_calls → тот же звук/вибро/пуш/оверлей), но
-- с kind='age_check' и текстом «Требуется подтвердить возраст». В оверлее
-- у официанта две кнопки:
--   • Подтвердить → confirm_age_check → статус 'confirmed' → устройство
--     гостя по Realtime отправляет заказ на кухню (place_guest_order);
--   • Отказать   → decline_age_check → статус 'declined' → гость видит
--     просьбу убрать алкоголь из корзины и оформить заказ заново.
-- Заказ материализуется в БД только ПОСЛЕ «Подтвердить», поэтому «убрать
-- алкоголь» — это просто правка клиентской корзины, откатывать нечего.
--
-- Пуш переиспользуется как есть: sendPushForCall берёт текст из
-- waiter_calls.reason — значит сервер waiter-api менять НЕ нужно.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260807010000_age_confirmation.sql
-- ============================================================

BEGIN;

-- 1) Род вызова: обычный сервис или подтверждение возраста.
ALTER TABLE public.waiter_calls
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'service';

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'waiter_calls_kind_check'
      AND conrelid = 'public.waiter_calls'::regclass
  ) THEN
    ALTER TABLE public.waiter_calls
      ADD CONSTRAINT waiter_calls_kind_check CHECK (kind IN ('service', 'age_check'));
  END IF;
END $do$;

-- 2) Новые статусы для age_check: confirmed (возраст подтверждён) и
--    declined (официант отказал). Обычный вызов по-прежнему pending →
--    acknowledged, cancelled остаётся для дедупа. Существующий CHECK по
--    статусу ищем по определению и заменяем (имя исторически разное).
DO $do$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  WHERE con.conrelid = 'public.waiter_calls'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%status%';
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.waiter_calls DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $do$;

ALTER TABLE public.waiter_calls
  ADD CONSTRAINT waiter_calls_status_check
  CHECK (status IN ('pending', 'acknowledged', 'cancelled', 'confirmed', 'declined'));

-- 3) «Один pending на стол» → «один pending на стол НА КАЖДЫЙ РОД»: обычный
--    вызов и age_check за одним столом больше не конфликтуют по индексу.
DROP INDEX IF EXISTS public.waiter_calls_one_pending_per_table;
CREATE UNIQUE INDEX IF NOT EXISTS waiter_calls_one_pending_per_table_kind
  ON public.waiter_calls (table_id, kind)
  WHERE status = 'pending';

-- 4) call_waiter (обычный вызов) теперь работает строго в рамках
--    kind='service' — чтобы не подхватить и не «занять» age_check-вызов.
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

  -- Уже висит обычный вызов за этим столом — переиспользуем его.
  SELECT id INTO v_call_id
  FROM public.waiter_calls
  WHERE table_id = v_table_id AND status = 'pending' AND kind = 'service'
  LIMIT 1;
  IF v_call_id IS NOT NULL THEN
    RETURN v_call_id;
  END IF;

  -- Адресат: ровно один закреплённый — целевой; иначе broadcast.
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

  INSERT INTO public.waiter_calls (restaurant_id, table_id, table_number, target_waiter_id, status, reason, kind)
  VALUES (p_restaurant_id, v_table_id, p_table_number, v_target, 'pending', NULLIF(btrim(p_reason), ''), 'service')
  ON CONFLICT (table_id, kind) WHERE status = 'pending' DO NOTHING
  RETURNING id INTO v_call_id;

  -- Гонка: между SELECT и INSERT кто-то успел вставить — берём его вызов.
  IF v_call_id IS NULL THEN
    SELECT id INTO v_call_id
    FROM public.waiter_calls
    WHERE table_id = v_table_id AND status = 'pending' AND kind = 'service'
    LIMIT 1;
  END IF;

  RETURN v_call_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.call_waiter(uuid, text, text) TO anon, authenticated, service_role;

-- 5) request_age_confirmation: гость с алкоголем в корзине. Создаёт (или
--    переиспользует уже висящий) age_check-вызов за этим столом. Адресат —
--    как у обычного вызова; reason фиксированный, чтобы пуш без правок
--    сервера показал «Требуется подтвердить возраст».
CREATE OR REPLACE FUNCTION public.request_age_confirmation(
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

  -- Уже висит age_check за этим столом — переиспользуем (второй гость с
  -- алкоголем подхватит тот же вызов).
  SELECT id INTO v_call_id
  FROM public.waiter_calls
  WHERE table_id = v_table_id AND status = 'pending' AND kind = 'age_check'
  LIMIT 1;
  IF v_call_id IS NOT NULL THEN
    RETURN v_call_id;
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

  INSERT INTO public.waiter_calls (restaurant_id, table_id, table_number, target_waiter_id, status, reason, kind)
  VALUES (p_restaurant_id, v_table_id, p_table_number, v_target, 'pending', 'Требуется подтвердить возраст', 'age_check')
  ON CONFLICT (table_id, kind) WHERE status = 'pending' DO NOTHING
  RETURNING id INTO v_call_id;

  IF v_call_id IS NULL THEN
    SELECT id INTO v_call_id
    FROM public.waiter_calls
    WHERE table_id = v_table_id AND status = 'pending' AND kind = 'age_check'
    LIMIT 1;
  END IF;

  RETURN v_call_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_age_confirmation(uuid, text) TO anon, authenticated, service_role;

-- 6) Официант подтвердил возраст → 'confirmed'. Гонка как у
--    acknowledge_waiter_call: обновляем только pending age_check, первый
--    откликнувшийся выигрывает (FOUND=false у остальных).
CREATE OR REPLACE FUNCTION public.confirm_age_check(
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
  SET status = 'confirmed',
      acknowledged_by = p_waiter_id,
      acknowledged_at = now()
  WHERE id = p_call_id
    AND status = 'pending'
    AND kind = 'age_check';

  v_updated := FOUND;
  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_age_check(uuid, uuid) TO authenticated, service_role;

-- 7) Официант отказал → 'declined'.
CREATE OR REPLACE FUNCTION public.decline_age_check(
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
  SET status = 'declined',
      acknowledged_by = p_waiter_id,
      acknowledged_at = now()
  WHERE id = p_call_id
    AND status = 'pending'
    AND kind = 'age_check';

  v_updated := FOUND;
  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decline_age_check(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
