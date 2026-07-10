-- Восстанавливает функции в состоянии ДО этой миграции — то есть в
-- том же (нерабочем для preferences) виде, что был до неё. Это не
-- откатывает исходный баг 0ce7227 (guest_id/items на orders), просто
-- возвращает как было непосредственно перед 20260710010000.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_guest_preferences(p_guest_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_prefs JSONB;
BEGIN
  SELECT jsonb_build_object(
    'tags', (
      SELECT COALESCE(jsonb_object_agg(tag, cnt), '{}')
      FROM (
        SELECT tag, COUNT(*) AS cnt
        FROM orders o
        CROSS JOIN jsonb_array_elements(o.items) AS item
        JOIN menu_items mi ON (item->>'dish_id')::uuid = mi.id
        CROSS JOIN UNNEST(mi.tags) AS tag
        WHERE o.guest_id = p_guest_id
          AND o.status = 'paid'
        GROUP BY tag
        ORDER BY cnt DESC
      ) t
    ),
    'sections', (
      SELECT COALESCE(jsonb_object_agg(section, cnt), '{}')
      FROM (
        SELECT mi.menu_section AS section, COUNT(*) AS cnt
        FROM orders o
        CROSS JOIN jsonb_array_elements(o.items) AS item
        JOIN menu_items mi ON (item->>'dish_id')::uuid = mi.id
        WHERE o.guest_id = p_guest_id
          AND o.status = 'paid'
        GROUP BY mi.menu_section
        ORDER BY cnt DESC
      ) t
    ),
    'top_dishes', (
      SELECT COALESCE(jsonb_agg(dish_obj ORDER BY times DESC), '[]')
      FROM (
        SELECT jsonb_build_object(
          'dish_id', mi.id,
          'name', mi.dish_name,
          'times', COUNT(*)
        ) AS dish_obj, COUNT(*) AS times
        FROM orders o
        CROSS JOIN jsonb_array_elements(o.items) AS item
        JOIN menu_items mi ON (item->>'dish_id')::uuid = mi.id
        WHERE o.guest_id = p_guest_id
          AND o.status = 'paid'
        GROUP BY mi.id, mi.dish_name
        ORDER BY COUNT(*) DESC
        LIMIT 5
      ) t
    ),
    'avg_check', (
      SELECT COALESCE(ROUND(AVG(total_amount), 0), 0)
      FROM orders
      WHERE guest_id = p_guest_id AND status = 'paid'
    ),
    'total_orders', (
      SELECT COUNT(*)
      FROM orders
      WHERE guest_id = p_guest_id AND status = 'paid'
    ),
    'comments', (
      SELECT COALESCE(jsonb_agg(comment ORDER BY created_at DESC), '[]')
      FROM (
        SELECT comment, created_at
        FROM orders
        WHERE guest_id = p_guest_id
          AND comment IS NOT NULL
          AND TRIM(comment) <> ''
        ORDER BY created_at DESC
        LIMIT 10
      ) t
    ),
    'last_computed_at', NOW()
  ) INTO v_prefs;

  UPDATE guests
  SET preferences = v_prefs
  WHERE id = p_guest_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
  END IF;

  RETURN QUERY SELECT v_order_id, v_all_paid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_table_seats(uuid, text, integer[]) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
