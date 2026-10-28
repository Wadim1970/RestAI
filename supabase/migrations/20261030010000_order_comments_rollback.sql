-- Откат 20261030010000_order_comments.sql: убирает таблицу комментариев (они
-- пропадают; в orders.comment текст остаётся) и возвращает прежние cart_send и
-- place_guest_order.
BEGIN;

CREATE OR REPLACE FUNCTION public.cart_send(p_restaurant_id uuid, p_table_number text, p_device_id text, p_comment text DEFAULT NULL::text)
 RETURNS TABLE(order_id uuid, seat_number integer, total_amount integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_table_id   uuid;
  v_session_id uuid;
  v_order_id   uuid;
  v_seat       integer;
  v_sent       integer;
  v_total      integer;
BEGIN
  SELECT e.o_table_id, e.o_session_id, e.o_order_id, e.o_seat
  INTO v_table_id, v_session_id, v_order_id, v_seat
  FROM public._cart_enter(p_restaurant_id, p_table_number, p_device_id) e;

  UPDATE public.order_items oi
  SET status = 'sent', sent_at = now()
  WHERE oi.order_id = v_order_id AND oi.seat_number = v_seat AND oi.status = 'new';
  GET DIAGNOSTICS v_sent = ROW_COUNT;

  IF v_sent = 0 THEN
    RAISE EXCEPTION 'Корзина пуста';
  END IF;

  IF p_comment IS NOT NULL AND btrim(p_comment) <> '' THEN
    UPDATE public.orders o
    SET comment = CASE
      WHEN o.comment IS NULL OR btrim(o.comment) = '' THEN format('Место %s: %s', v_seat, btrim(p_comment))
      ELSE o.comment || E'\n' || format('Место %s: %s', v_seat, btrim(p_comment))
    END
    WHERE o.id = v_order_id;
  END IF;

  UPDATE public.orders o SET status = 'cooking' WHERE o.id = v_order_id AND o.status = 'new';
  UPDATE public.table_sessions ts SET status = 'preparing' WHERE ts.id = v_session_id;

  SELECT o.total_amount INTO v_total FROM public.orders o WHERE o.id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_seat, v_total;
END $function$;

CREATE OR REPLACE FUNCTION public.place_guest_order(p_restaurant_id uuid, p_table_number text, p_device_id text, p_items jsonb, p_comment text DEFAULT NULL::text)
 RETURNS TABLE(order_id uuid, seat_number integer, total_amount integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_table_id       uuid;
  v_order_id       uuid;
  v_seat_number    integer;
  v_item           jsonb;
  v_unit_price     numeric;
  v_total          integer;
  v_order_item_id  uuid;
  v_mod_id         text;
  v_mod_price      numeric;
  v_promoted       uuid[] := '{}';
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Пустой список блюд';
  END IF;

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

  PERFORM pg_advisory_xact_lock(hashtextextended(v_table_id::text, 0));

  INSERT INTO public.table_sessions (table_id, restaurant_id, status, is_active, started_at)
  SELECT v_table_id, p_restaurant_id, 'preparing', true, now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.table_sessions WHERE table_id = v_table_id AND is_active = true
  );

  UPDATE public.table_sessions
  SET status = 'preparing'
  WHERE table_id = v_table_id AND is_active = true;

  SELECT id INTO v_order_id
  FROM public.orders
  WHERE table_id = v_table_id AND status IN ('new', 'cooking')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    INSERT INTO public.orders (table_id, table_number, restaurant_id, status, total_amount, items)
    VALUES (v_table_id, p_table_number, p_restaurant_id, 'cooking', 0, '[]'::jsonb)
    RETURNING id INTO v_order_id;
  END IF;

  SELECT og.seat_number INTO v_seat_number
  FROM public.order_guests og
  WHERE og.order_id = v_order_id AND og.device_id = p_device_id;

  IF v_seat_number IS NULL THEN
    SELECT COALESCE(MAX(og.seat_number), 0) + 1 INTO v_seat_number
    FROM public.order_guests og
    WHERE og.order_id = v_order_id;

    INSERT INTO public.order_guests (order_id, seat_number, device_id)
    VALUES (v_order_id, v_seat_number, p_device_id);
  END IF;

  IF p_comment IS NOT NULL AND btrim(p_comment) <> '' THEN
    UPDATE public.orders
    SET comment = CASE
      WHEN comment IS NULL OR btrim(comment) = '' THEN format('Место %s: %s', v_seat_number, btrim(p_comment))
      ELSE comment || E'\n' || format('Место %s: %s', v_seat_number, btrim(p_comment))
    END
    WHERE id = v_order_id;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT cost_rub INTO v_unit_price
    FROM public.menu_items
    WHERE id = (v_item->>'item_id')::uuid
      AND restaurant_id = p_restaurant_id;

    IF v_unit_price IS NULL THEN
      RAISE EXCEPTION 'Блюдо % не найдено в меню этого ресторана', v_item->>'item_id';
    END IF;

    -- Если официант уже «взял» корзину этого гостя (строки status = 'new' того
    -- же места, блюда, комментария и опций), отправка гостя не добавляет вторую
    -- копию, а переводит эти строки в «отправлено». Иначе заказ задваивался.
    v_order_item_id := public._find_new_order_line(
      v_order_id, v_seat_number, (v_item->>'item_id')::uuid,
      NULLIF(v_item->>'comment', ''), v_item->'modifiers', v_promoted);
    IF v_order_item_id IS NOT NULL THEN
      UPDATE public.order_items
      SET status = 'sent',
          sent_at = now(),
          quantity = GREATEST(COALESCE((v_item->>'quantity')::integer, 1), 1),
          unit_price = v_unit_price
      WHERE id = v_order_item_id;
      v_promoted := array_append(v_promoted, v_order_item_id);
      CONTINUE; -- опции у этой строки уже записаны
    END IF;

    INSERT INTO public.order_items
      (order_id, item_id, seat_number, quantity, unit_price, status, sent_at, comment)
    VALUES (
      v_order_id,
      (v_item->>'item_id')::uuid,
      v_seat_number,
      GREATEST(COALESCE((v_item->>'quantity')::integer, 1), 1),
      v_unit_price,
      'sent',
      now(),
      NULLIF(v_item->>'comment', '')
    )
    RETURNING id INTO v_order_item_id;

    -- Модификаторы (если пришли): пишем в order_item_modifiers, наценку
    -- берём из БД. Неизвестные id молча пропускаем (не валим весь заказ).
    IF jsonb_typeof(v_item->'modifiers') = 'array' THEN
      FOR v_mod_id IN SELECT jsonb_array_elements_text(v_item->'modifiers')
      LOOP
        SELECT price_delta INTO v_mod_price FROM public.modifiers WHERE id = v_mod_id::uuid;
        IF v_mod_price IS NOT NULL THEN
          INSERT INTO public.order_item_modifiers (order_item_id, modifier_id, price_delta)
          VALUES (v_order_item_id, v_mod_id::uuid, v_mod_price);
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- Итог заказа считает общая функция: только отправленные строки
  -- (корзины гостей, status = 'new', в сумму не входят).
  PERFORM public._recalc_order_total(v_order_id);
  SELECT o.total_amount INTO v_total FROM public.orders o WHERE o.id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_seat_number, v_total;
END;
$function$;

DROP FUNCTION IF EXISTS public.add_order_comment(uuid, integer, text);
DROP FUNCTION IF EXISTS public.ack_order_comment(uuid, boolean);
DROP TABLE IF EXISTS public.order_comments;

COMMIT;
NOTIFY pgrst, 'reload schema';
