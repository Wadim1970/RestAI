-- Откат 20261029030000_guest_count_present.sql: прежний вход гостя (число
-- телефонов затирает guest_count), вью без guests_present, без триггера.
BEGIN;

DROP TRIGGER IF EXISTS trg_order_guest_paid_left ON public.order_guests;
DROP FUNCTION IF EXISTS public.trg_order_guest_paid_left();

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

    UPDATE public.table_sessions ts
    SET guest_count = (SELECT COUNT(*) FROM public.order_guests og
                       WHERE og.order_id = v_order_id AND og.device_id IS NOT NULL)
    WHERE ts.id = v_session_id;
  END IF;

  RETURN QUERY SELECT v_table_id, v_session_id, v_order_id, v_seat;
END $$;
REVOKE ALL ON FUNCTION public._cart_enter(uuid, text, text) FROM PUBLIC, anon, authenticated;

DROP VIEW IF EXISTS public.tables_with_active_session;
CREATE VIEW public.tables_with_active_session
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
    ts.bill_type AS session_bill_type
   FROM public.tables t
     LEFT JOIN public.table_sessions ts ON ts.table_id = t.id AND ts.is_active = true;
GRANT ALL ON public.tables_with_active_session TO anon, authenticated, service_role;

ALTER TABLE public.table_sessions DROP COLUMN IF EXISTS guests_left;

COMMIT;
NOTIFY pgrst, 'reload schema';
