-- ============================================================
-- pay_table_seats: fail-fast вместо вечного ожидания блокировки.
--
-- ПРОБЛЕМА:
--   pay_table_seats берёт SELECT ... FOR UPDATE по строке активного заказа,
--   чтобы сериализовать оплаты. Если строку в этот момент держит другая
--   незакоммиченная транзакция (например, place_guest_order, чья транзакция
--   ещё не завершилась из-за задержки сети/пула соединений), FOR UPDATE
--   ждёт БЕЗ ТАЙМАУТА — оплата на клиенте зависает на "Подтверждаем..."
--   периодически, по совпадению таймингов.
--
-- ФИКС:
--   SET LOCAL lock_timeout = '5s' — если блокировку не удалось взять за 5 сек,
--   функция падает ошибкой (55P03), а не висит. Клиент (PaymentFlowModal)
--   это ловит и показывает "попробуйте ещё раз", кнопка разблокируется.
--   Тело функции без изменений.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260705010000_pay_table_seats_lock_timeout.sql
-- ============================================================

BEGIN;

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
  v_order_id uuid;
  v_table_id uuid;
  v_all_paid boolean;
BEGIN
  -- Не ждём блокировку строки заказа вечно: если её держит другая
  -- незакоммиченная транзакция дольше 5 сек — падаем понятной ошибкой,
  -- клиент предложит повторить, вместо бесконечного "Подтверждаем...".
  SET LOCAL lock_timeout = '5s';

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
  END IF;

  RETURN QUERY SELECT v_order_id, v_all_paid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_table_seats(uuid, text, integer[]) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
