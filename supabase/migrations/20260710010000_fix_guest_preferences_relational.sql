-- ============================================================
-- Чиним guest preferences/avg_check под актуальную реляционную модель
-- заказов.
--
-- ИСТОРИЯ БАГА:
--   До коммита 0ce7227 (1 июля) RestAI создавал заказ напрямую
--   (INSERT INTO orders с guest_id и реальным JSONB items) — триггер
--   trg_update_guest_preferences на это реагировал и писал preferences.
--   0ce7227 перевёл создание заказа на place_guest_order() ради
--   видимости заказов официанту (Waiter-app читает order_items, не
--   orders.items) — но заодно, как побочный эффект, orders.guest_id
--   перестал проставляться, а orders.items так и остаётся '[]'.
--   Триггер с тех пор выходит на первой же строке (NEW.guest_id IS
--   NULL) — preferences не обновляется вообще ни для одного гостя.
--
-- ПОЧЕМУ НЕ ПРОСТО ВЕРНУТЬ guest_id НА orders:
--   Модель теперь другая: один orders = весь стол, за ним могут стоять
--   НЕСКОЛЬКО гостей (order_guests: seat_number <-> device_id). Одно
--   поле guest_id на orders физически не может корректно отразить
--   нескольких гостей — а слепое присвоение приписало бы одному гостю
--   чужие блюда соседей по столу.
--
-- РЕШЕНИЕ:
--   update_guest_preferences(p_guest_id) переписана на чтение из
--   order_items/order_guests (актуальная модель) вместо мёртвого
--   orders.items, с привязкой ПО МЕСТУ (device_id -> seat_number) —
--   так одному гостю считаются только его собственные позиции, даже
--   если заказ на весь стол общий.
--
--   avg_check пишется сразу в ДВА места: preferences->avg_check (уже
--   читает guest_summary/get_guest_brief для официанта) и в саму
--   колонку guests.avg_check — её читает useChatApi.js для ИИ-чата,
--   но раньше в неё не писал никто и никогда за всю историю репо.
--
--   Вызывается из pay_table_seats() в момент, когда ВЕСЬ заказ стола
--   реально оплачен (v_all_paid) — тогда, и только тогда, у функции
--   есть новые оплаченные позиции для пересчёта; при частичной оплате
--   стола пересчитывать нечего (orders.status ещё не 'paid').
--
--   Область действия: путь оплаты через приложение гостя (pay_table_seats,
--   SplitBillModal/PaymentFlowModal). У Waiter-app есть СВОЙ, отдельный
--   markGuestPaid (прямой UPDATE order_guests, без вызова pay_table_seats) —
--   этот путь этой миграцией не затронут (официант закрывает стол вручную,
--   без переиспользования этой функции).
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260710010000_fix_guest_preferences_relational.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.update_guest_preferences(p_guest_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id text;
  v_prefs     jsonb;
  v_avg_check numeric;
BEGIN
  SELECT device_id INTO v_device_id FROM guests WHERE id = p_guest_id;
  IF v_device_id IS NULL THEN
    RETURN;
  END IF;

  SELECT jsonb_build_object(
    'tags', (
      SELECT COALESCE(jsonb_object_agg(tag, cnt), '{}')
      FROM (
        SELECT tag, COUNT(*) AS cnt
        FROM order_items oi
        JOIN order_guests og ON og.order_id = oi.order_id AND og.seat_number = oi.seat_number
        JOIN orders o ON o.id = oi.order_id
        JOIN menu_items mi ON mi.id = oi.item_id
        CROSS JOIN UNNEST(mi.tags) AS tag
        WHERE og.device_id = v_device_id AND o.status = 'paid'
        GROUP BY tag
        ORDER BY cnt DESC
      ) t
    ),
    'sections', (
      SELECT COALESCE(jsonb_object_agg(section, cnt), '{}')
      FROM (
        SELECT mi.menu_section AS section, COUNT(*) AS cnt
        FROM order_items oi
        JOIN order_guests og ON og.order_id = oi.order_id AND og.seat_number = oi.seat_number
        JOIN orders o ON o.id = oi.order_id
        JOIN menu_items mi ON mi.id = oi.item_id
        WHERE og.device_id = v_device_id AND o.status = 'paid'
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
        FROM order_items oi
        JOIN order_guests og ON og.order_id = oi.order_id AND og.seat_number = oi.seat_number
        JOIN orders o ON o.id = oi.order_id
        JOIN menu_items mi ON mi.id = oi.item_id
        WHERE og.device_id = v_device_id AND o.status = 'paid'
        GROUP BY mi.id, mi.dish_name
        ORDER BY COUNT(*) DESC
        LIMIT 5
      ) t
    ),
    'total_orders', (
      SELECT COUNT(DISTINCT oi.order_id)
      FROM order_items oi
      JOIN order_guests og ON og.order_id = oi.order_id AND og.seat_number = oi.seat_number
      JOIN orders o ON o.id = oi.order_id
      WHERE og.device_id = v_device_id AND o.status = 'paid'
    ),
    'comments', (
      SELECT COALESCE(jsonb_agg(comment ORDER BY created_at DESC), '[]')
      FROM (
        SELECT DISTINCT o.comment, o.created_at
        FROM orders o
        JOIN order_guests og ON og.order_id = o.id
        WHERE og.device_id = v_device_id AND o.status = 'paid'
          AND o.comment IS NOT NULL AND TRIM(o.comment) <> ''
        ORDER BY o.created_at DESC
        LIMIT 10
      ) t
    ),
    'last_computed_at', NOW()
  ) INTO v_prefs;

  -- Средний чек ЭТОГО гостя = сумма его собственных позиций (по месту)
  -- за заказ, усреднённая по всем его оплаченным заказам — не
  -- total_amount всего стола, чтобы не приписывать гостю траты соседей.
  SELECT COALESCE(ROUND(AVG(seat_total), 2), 0) INTO v_avg_check
  FROM (
    SELECT oi.order_id, SUM(oi.unit_price * oi.quantity) AS seat_total
    FROM order_items oi
    JOIN order_guests og ON og.order_id = oi.order_id AND og.seat_number = oi.seat_number
    JOIN orders o ON o.id = oi.order_id
    WHERE og.device_id = v_device_id AND o.status = 'paid'
    GROUP BY oi.order_id
  ) per_order;

  v_prefs := v_prefs || jsonb_build_object('avg_check', v_avg_check);

  UPDATE guests
  SET preferences = v_prefs,
      avg_check = v_avg_check
  WHERE id = p_guest_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_guest_preferences(bigint) TO authenticated, service_role;

-- ------------------------------------------------------------
-- pay_table_seats: без изменений в логике оплаты, добавлен только
-- пересчёт preferences для гостей этого стола в момент, когда заказ
-- закрывается целиком (v_all_paid).
-- ------------------------------------------------------------
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

    -- Заказ стола закрыт целиком — пересчитываем preferences/avg_check
    -- для каждого гостя, у кого было место за этим заказом (device_id
    -- NULL у мест, заведённых официантом вручную, просто не даст
    -- совпадения в JOIN и молча пропускается).
    PERFORM public.update_guest_preferences(g.id)
    FROM (SELECT DISTINCT device_id FROM public.order_guests WHERE order_id = v_order_id) og
    JOIN public.guests g ON g.device_id = og.device_id;
  END IF;

  RETURN QUERY SELECT v_order_id, v_all_paid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_table_seats(uuid, text, integer[]) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
