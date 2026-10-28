-- ============================================================
-- Счётчик гостей за столом: гость оплатил своё место — он ушёл.
--
-- Было: table_sessions.guest_count только росло (и перезаписывалось числом
-- телефонов, затирая то, что выставил официант). Гость оплатил и ушёл, а на
-- плитке стола у официанта он оставался.
--
-- Стало: в одном месте считаем двух разных вещей:
--   • guest_count — сколько гостей было за посадкой ВСЕГО (для истории, отзывов,
--     аналитики зала). Не уменьшается, не меньше числа телефонов и не меньше
--     того, что выставил официант.
--   • guests_left — сколько мест оплачено (гость ушёл). Растёт, когда место
--     становится «оплачено» (pay_table_seats, отметка официанта и любая другая
--     запись в order_guests.status = 'paid'), каждое место считается один раз.
--   • вью tables_with_active_session получает новую колонку guests_present =
--     guest_count − guests_left (не меньше 0): её показывает плитка стола.
--
-- Не покрыто: гость, который ушёл, не оплатив (закрыл приложение и ушёл), —
-- система не может этого узнать; число поправит официант на экране гостей.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261029030000_guest_count_present.sql
-- Откат: 20261029030000_guest_count_present_rollback.sql
-- ============================================================

BEGIN;

ALTER TABLE public.table_sessions ADD COLUMN IF NOT EXISTS guests_left integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.table_sessions.guests_left IS 'Сколько мест оплачено (гость ушёл). Присутствуют сейчас: guest_count − guests_left.';

-- Уже идущие посадки: считаем оплаченные места по их заказам.
UPDATE public.table_sessions ts
SET guests_left = sub.n,
    guest_count = GREATEST(COALESCE(ts.guest_count, 0), sub.n)
FROM (
  SELECT o.table_session_id AS sid, COUNT(*) AS n
  FROM public.order_guests og
  JOIN public.orders o ON o.id = og.order_id
  WHERE og.status = 'paid' AND o.table_session_id IS NOT NULL
  GROUP BY o.table_session_id
) sub
WHERE ts.id = sub.sid AND ts.is_active;

-- Место оплачено → гость ушёл (один раз на место).
CREATE OR REPLACE FUNCTION public.trg_order_guest_paid_left()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'paid' THEN
    RETURN NULL;
  END IF;
  UPDATE public.table_sessions ts
  SET guests_left = ts.guests_left + 1,
      guest_count = GREATEST(COALESCE(ts.guest_count, 0), ts.guests_left + 1)
  FROM public.orders o
  WHERE o.id = NEW.order_id
    AND ts.id = o.table_session_id
    AND ts.is_active;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.trg_order_guest_paid_left() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_order_guest_paid_left ON public.order_guests;
CREATE TRIGGER trg_order_guest_paid_left
  AFTER INSERT OR UPDATE OF status ON public.order_guests
  FOR EACH ROW WHEN (NEW.status = 'paid')
  EXECUTE FUNCTION public.trg_order_guest_paid_left();

-- Вход гостя за стол: guest_count не затирает число официанта.
CREATE OR REPLACE FUNCTION public._cart_enter(
  p_restaurant_id uuid, p_table_number text, p_device_id text
)
RETURNS TABLE(o_table_id uuid, o_session_id uuid, o_order_id uuid, o_seat integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_table_id   uuid;
  v_session_id uuid;
  v_order_id   uuid;
  v_seat       integer;
BEGIN
  IF p_table_number IS NULL OR btrim(p_table_number) = '' OR p_table_number = 'null' THEN
    RAISE EXCEPTION 'Не удалось определить номер стола';
  END IF;
  IF p_device_id IS NULL OR btrim(p_device_id) = '' THEN
    RAISE EXCEPTION 'Не удалось определить устройство гостя';
  END IF;

  SELECT t.id INTO v_table_id
  FROM public.tables t
  WHERE t.restaurant_id = p_restaurant_id
    AND t.number = p_table_number::integer
    AND t.is_active = true;
  IF v_table_id IS NULL THEN
    RAISE EXCEPTION 'Стол % не найден для этого ресторана', p_table_number;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_table_id::text, 0));

  SELECT ts.id INTO v_session_id
  FROM public.table_sessions ts
  WHERE ts.table_id = v_table_id AND ts.is_active = true
  ORDER BY ts.started_at DESC
  LIMIT 1;
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'Стол закрыт: отсканируйте QR-код на столе заново';
  END IF;

  SELECT o.id INTO v_order_id
  FROM public.orders o
  WHERE o.table_id = v_table_id AND o.status IN ('new', 'cooking')
  ORDER BY o.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    INSERT INTO public.orders (table_id, table_number, restaurant_id, status, total_amount, items)
    VALUES (v_table_id, p_table_number, p_restaurant_id, 'new', 0, '[]'::jsonb)
    RETURNING id INTO v_order_id;
  END IF;

  SELECT og.seat_number INTO v_seat
  FROM public.order_guests og
  WHERE og.order_id = v_order_id AND og.device_id = p_device_id;

  IF v_seat IS NULL THEN
    SELECT COALESCE(MAX(og.seat_number), 0) + 1 INTO v_seat
    FROM public.order_guests og
    WHERE og.order_id = v_order_id;

    INSERT INTO public.order_guests (order_id, seat_number, device_id)
    VALUES (v_order_id, v_seat, p_device_id);

    -- Всего гостей за посадку (для истории и аналитики) — не меньше числа
    -- телефонов за столом и не меньше того, что выставил официант.
    UPDATE public.table_sessions ts
    SET guest_count = GREATEST(
          COALESCE(ts.guest_count, 0),
          (SELECT COUNT(*) FROM public.order_guests og
           WHERE og.order_id = v_order_id AND og.device_id IS NOT NULL))
    WHERE ts.id = v_session_id;
  END IF;

  RETURN QUERY SELECT v_table_id, v_session_id, v_order_id, v_seat;
END $$;
REVOKE ALL ON FUNCTION public._cart_enter(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Плитка стола: сколько гостей сидит сейчас.
CREATE OR REPLACE VIEW public.tables_with_active_session
WITH (security_invoker = true) AS
 SELECT t.id,
    t.restaurant_id,
    t.number,
    t.zone,
    t.capacity,
    t.is_active AS table_is_active,
    ts.id AS session_id,
    ts.status AS session_status,
    ts.guest_count,
    ts.started_at,
    ts.waiter_id AS session_waiter_id,
    ts.bill_type AS session_bill_type,
    GREATEST(ts.guest_count - ts.guests_left, 0) AS guests_present
   FROM public.tables t
     LEFT JOIN public.table_sessions ts ON ts.table_id = t.id AND ts.is_active = true;

COMMIT;
NOTIFY pgrst, 'reload schema';
