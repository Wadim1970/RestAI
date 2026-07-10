BEGIN;

-- Возвращает pay_table_seats к состоянию до этой миграции (без вызова
-- update_guest_restaurant_stats).
CREATE OR REPLACE FUNCTION public.pay_table_seats(
  p_restaurant_id uuid,
  p_table_number text,
  p_seat_numbers integer[]
)
RETURNS TABLE (paid_order_id uuid, all_paid boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id     uuid;
  v_table_id     uuid;
  v_all_paid     boolean;
BEGIN
  IF p_seat_numbers IS NULL OR array_length(p_seat_numbers, 1) IS NULL THEN
    RAISE EXCEPTION 'Не выбрано ни одного места для оплаты';
  END IF;

  SELECT id, table_id INTO v_order_id, v_table_id
  FROM public.orders
  WHERE restaurant_id = p_restaurant_id::text
    AND table_number = p_table_number
    AND status IN ('new', 'cooking')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Активный заказ для этого стола не найден';
  END IF;

  INSERT INTO public.order_guests (order_id, seat_number, status)
  SELECT v_order_id, s.seat_number, 'paid'
  FROM unnest(p_seat_numbers) AS s(seat_number)
  WHERE s.seat_number IN (
    SELECT DISTINCT oi.seat_number FROM public.order_items oi WHERE oi.order_id = v_order_id
  )
  ON CONFLICT (order_id, seat_number) DO UPDATE SET status = 'paid';

  SELECT NOT EXISTS (
    SELECT 1
    FROM (SELECT DISTINCT seat_number FROM public.order_items WHERE order_id = v_order_id) roster
    LEFT JOIN public.order_guests og
      ON og.order_id = v_order_id AND og.seat_number = roster.seat_number
    WHERE COALESCE(og.status, '') <> 'paid'
  ) INTO v_all_paid;

  IF v_all_paid THEN
    UPDATE public.orders SET status = 'paid' WHERE id = v_order_id;

    IF v_table_id IS NOT NULL THEN
      UPDATE public.table_sessions
      SET status = 'free', is_active = false, ended_at = now()
      WHERE table_id = v_table_id AND is_active = true;
    END IF;

    PERFORM public.update_guest_preferences(g.id)
    FROM (SELECT DISTINCT device_id FROM public.order_guests WHERE order_id = v_order_id) og
    JOIN public.guests g ON g.device_id = og.device_id;
  END IF;

  RETURN QUERY SELECT v_order_id, v_all_paid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_table_seats(uuid, text, integer[]) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.update_guest_restaurant_stats(bigint, text);
DROP TABLE IF EXISTS public.guest_restaurant_stats;

NOTIFY pgrst, 'reload schema';

COMMIT;
