-- ============================================================
-- Состояние стола «Занят» + управление жизненным циклом гостевой сессии.
--
-- ЗАЧЕМ:
--  1) Раньше сессия стола (table_sessions) открывалась ТОЛЬКО при первом
--     заказе (place_guest_order -> status='preparing'). Пока гость просто
--     смотрел меню, у официанта стол висел «свободен». Нужен статус
--     'occupied' («Занят»), который ставится сразу по скану QR.
--  2) Гостевое приложение должно уметь узнать, что стол закрыли (официант
--     освободил стол / оплата), и что сессию пора сбросить по таймеру
--     бездействия. Делаем это read-only + release RPC (SECURITY DEFINER),
--     без Realtime-подписки anon на table_sessions — у неё RLS выключен
--     (официант пишет в table_sessions напрямую), и включать его ради
--     гостя рискованно. Клиент опрашивает эти функции (poll + на focus).
--
-- Прогрессия статуса стола: occupied («Занят») -> preparing («готовится»)
-- при первом заказе -> ... -> free (стол освободили).
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260722020000_table_occupied_session_lifecycle.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Разрешаем статус 'occupied' в CHECK-констрейнте table_sessions.
--    Делаем идемпотентно: сносим ЛЮБОЙ существующий check по колонке
--    status и ставим один полный. Если check'а не было вовсе — просто
--    добавляем (документирует допустимые значения).
-- ------------------------------------------------------------
DO $do$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.table_sessions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.table_sessions DROP CONSTRAINT %I', c);
  END LOOP;
END $do$;

ALTER TABLE public.table_sessions
  ADD CONSTRAINT table_sessions_status_check
  CHECK (status IN ('free', 'preparing', 'resting', 'bill_requested', 'call', 'occupied'));

-- ------------------------------------------------------------
-- 2. mark_table_occupied — гость отсканировал QR / вошёл в меню.
--    Открывает сессию 'occupied' ТОЛЬКО если активной ещё нет; если
--    сессия уже идёт (occupied/preparing/resting/...) — НЕ трогает её
--    статус, просто возвращает её id. Возвращает table_id и session_id:
--    session_id клиент запоминает, чтобы потом опрашивать «жива ли сессия».
-- ------------------------------------------------------------
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

  -- Сериализуем участок для этого стола: два гостя, сканирующие QR
  -- одновременно, не должны создать две сессии (та же защита, что в
  -- place_guest_order). Снимается сам в конце транзакции.
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

-- ------------------------------------------------------------
-- 3. is_table_session_active — жива ли ИМЕННО эта сессия (по её id).
--    Гость периодически опрашивает: если false (официант закрыл стол /
--    оплата) — приложение сбрасывает сессию и уводит на скан QR.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_table_session_active(
  p_session_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_active FROM public.table_sessions WHERE id = p_session_id),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_table_session_active(uuid) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 4. release_table_if_occupied — гость ушёл, ничего не заказав (таймер
--    бездействия). Закрывает сессию ТОЛЬКО если она всё ещё в статусе
--    'occupied' (т.е. заказа не было). Если гость успел что-то заказать
--    (preparing/resting/bill_requested) — НЕ трогаем: стол занят реально.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_table_if_occupied(
  p_session_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done boolean := false;
BEGIN
  UPDATE public.table_sessions
  SET is_active = false, ended_at = now(), status = 'free'
  WHERE id = p_session_id
    AND is_active = true
    AND status = 'occupied';
  GET DIAGNOSTICS v_done = ROW_COUNT;
  RETURN v_done;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_table_if_occupied(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
