-- ============================================================
-- Ресторан везде одного типа и с внешним ключом.
--
-- БЫЛО: в 5 таблицах (orders, reviews, conversation_turns,
-- guest_restaurant_stats, restaurant_ai_profiles) restaurant_id хранился как
-- text без внешнего ключа — так в orders оказались пустой id и заказы
-- несуществующих ресторанов. Ещё в 10 таблицах ключа на restaurants не было.
--
-- СТАЛО:
--   • restaurant_id во всех пяти таблицах — uuid;
--   • внешний ключ на restaurants("restaurantId") ON DELETE CASCADE в
--     15 таблицах: ai_suggestion_events, conversation_turns, dish_daily_flags, guest_cart_drafts, guest_restaurant_stats, menu_item_costing, menu_pairing_state, menu_pairings, orders, restaurant_ai_profiles, reviews, staff_review_prompts, table_reservations, table_sessions, waiter_ai_suggestions;
--   • NOT NULL там, где ресторан обязателен: jobs, menu_items, table_sessions, staff_feedback, staff_review_prompts, reviews, dish_daily_flags, menu_item_costing.
--     Остаются необязательными журналы ИИ: ai_suggestion_events,
--     conversation_turns, waiter_ai_suggestions (запись реплики или события не
--     должна падать, если ресторан неизвестен).
--
-- Функции, которые сравнивали ресторан как текст, переписаны здесь же
-- (убрано ::text): get_table_bill, pay_table_seats, place_guest_order,
-- submit_review, take_guest_cart, update_guest_restaurant_stats (теперь с
-- uuid), get_table_unpaid_total, get_guest_restaurant_stats,
-- get_restaurant_ai_profile, waiter_can_access_restaurant (добавлена
-- перегрузка с uuid). Прочие функции и триггеры сравнений с текстом не
-- содержат — проверено на копии структуры боевой базы.
--
-- Миграция останавливается, ничего не изменив, если:
--   • в этих таблицах есть значение не uuid или несуществующий ресторан;
--   • в таблицах под NOT NULL есть пустые значения.
--
-- ПЕРЕД ЗАПУСКОМ — бэкап (pg_dump -Fc). Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261024070000_restaurant_id_uuid_fk.sql
-- Откат: 20261024070000_restaurant_id_uuid_fk_rollback.sql
-- ============================================================

BEGIN;

-- ── 0. Страховка ──
DO $$
DECLARE n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM public.orders x WHERE x.restaurant_id IS NOT NULL AND x.restaurant_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') OR EXISTS (SELECT 1 FROM public.reviews x WHERE x.restaurant_id IS NOT NULL AND x.restaurant_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') OR EXISTS (SELECT 1 FROM public.conversation_turns x WHERE x.restaurant_id IS NOT NULL AND x.restaurant_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') OR EXISTS (SELECT 1 FROM public.guest_restaurant_stats x WHERE x.restaurant_id IS NOT NULL AND x.restaurant_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') OR EXISTS (SELECT 1 FROM public.restaurant_ai_profiles x WHERE x.restaurant_id IS NOT NULL AND x.restaurant_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'В restaurant_id есть значение, которое не uuid — ничего не изменено';
  END IF;
  SELECT count(*) INTO n FROM public.ai_suggestion_events x WHERE x.restaurant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r."restaurantId"::text = x.restaurant_id::text);
  IF n > 0 THEN RAISE EXCEPTION 'В ai_suggestion_events % строк с несуществующим рестораном', n; END IF;
  SELECT count(*) INTO n FROM public.conversation_turns x WHERE x.restaurant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r."restaurantId"::text = x.restaurant_id::text);
  IF n > 0 THEN RAISE EXCEPTION 'В conversation_turns % строк с несуществующим рестораном', n; END IF;
  SELECT count(*) INTO n FROM public.dish_daily_flags x WHERE x.restaurant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r."restaurantId"::text = x.restaurant_id::text);
  IF n > 0 THEN RAISE EXCEPTION 'В dish_daily_flags % строк с несуществующим рестораном', n; END IF;
  SELECT count(*) INTO n FROM public.guest_cart_drafts x WHERE x.restaurant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r."restaurantId"::text = x.restaurant_id::text);
  IF n > 0 THEN RAISE EXCEPTION 'В guest_cart_drafts % строк с несуществующим рестораном', n; END IF;
  SELECT count(*) INTO n FROM public.guest_restaurant_stats x WHERE x.restaurant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r."restaurantId"::text = x.restaurant_id::text);
  IF n > 0 THEN RAISE EXCEPTION 'В guest_restaurant_stats % строк с несуществующим рестораном', n; END IF;
  SELECT count(*) INTO n FROM public.menu_item_costing x WHERE x.restaurant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r."restaurantId"::text = x.restaurant_id::text);
  IF n > 0 THEN RAISE EXCEPTION 'В menu_item_costing % строк с несуществующим рестораном', n; END IF;
  SELECT count(*) INTO n FROM public.menu_pairing_state x WHERE x.restaurant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r."restaurantId"::text = x.restaurant_id::text);
  IF n > 0 THEN RAISE EXCEPTION 'В menu_pairing_state % строк с несуществующим рестораном', n; END IF;
  SELECT count(*) INTO n FROM public.menu_pairings x WHERE x.restaurant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r."restaurantId"::text = x.restaurant_id::text);
  IF n > 0 THEN RAISE EXCEPTION 'В menu_pairings % строк с несуществующим рестораном', n; END IF;
  SELECT count(*) INTO n FROM public.orders x WHERE x.restaurant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r."restaurantId"::text = x.restaurant_id::text);
  IF n > 0 THEN RAISE EXCEPTION 'В orders % строк с несуществующим рестораном', n; END IF;
  SELECT count(*) INTO n FROM public.restaurant_ai_profiles x WHERE x.restaurant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r."restaurantId"::text = x.restaurant_id::text);
  IF n > 0 THEN RAISE EXCEPTION 'В restaurant_ai_profiles % строк с несуществующим рестораном', n; END IF;
  SELECT count(*) INTO n FROM public.reviews x WHERE x.restaurant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r."restaurantId"::text = x.restaurant_id::text);
  IF n > 0 THEN RAISE EXCEPTION 'В reviews % строк с несуществующим рестораном', n; END IF;
  SELECT count(*) INTO n FROM public.staff_review_prompts x WHERE x.restaurant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r."restaurantId"::text = x.restaurant_id::text);
  IF n > 0 THEN RAISE EXCEPTION 'В staff_review_prompts % строк с несуществующим рестораном', n; END IF;
  SELECT count(*) INTO n FROM public.table_reservations x WHERE x.restaurant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r."restaurantId"::text = x.restaurant_id::text);
  IF n > 0 THEN RAISE EXCEPTION 'В table_reservations % строк с несуществующим рестораном', n; END IF;
  SELECT count(*) INTO n FROM public.table_sessions x WHERE x.restaurant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r."restaurantId"::text = x.restaurant_id::text);
  IF n > 0 THEN RAISE EXCEPTION 'В table_sessions % строк с несуществующим рестораном', n; END IF;
  SELECT count(*) INTO n FROM public.waiter_ai_suggestions x WHERE x.restaurant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r."restaurantId"::text = x.restaurant_id::text);
  IF n > 0 THEN RAISE EXCEPTION 'В waiter_ai_suggestions % строк с несуществующим рестораном', n; END IF;
  SELECT count(*) INTO n FROM public.jobs WHERE restaurant_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'В jobs % строк без ресторана — сначала заполните или удалите', n; END IF;
  SELECT count(*) INTO n FROM public.menu_items WHERE restaurant_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'В menu_items % строк без ресторана — сначала заполните или удалите', n; END IF;
  SELECT count(*) INTO n FROM public.table_sessions WHERE restaurant_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'В table_sessions % строк без ресторана — сначала заполните или удалите', n; END IF;
  SELECT count(*) INTO n FROM public.staff_feedback WHERE restaurant_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'В staff_feedback % строк без ресторана — сначала заполните или удалите', n; END IF;
  SELECT count(*) INTO n FROM public.staff_review_prompts WHERE restaurant_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'В staff_review_prompts % строк без ресторана — сначала заполните или удалите', n; END IF;
  SELECT count(*) INTO n FROM public.reviews WHERE restaurant_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'В reviews % строк без ресторана — сначала заполните или удалите', n; END IF;
  SELECT count(*) INTO n FROM public.dish_daily_flags WHERE restaurant_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'В dish_daily_flags % строк без ресторана — сначала заполните или удалите', n; END IF;
  SELECT count(*) INTO n FROM public.menu_item_costing WHERE restaurant_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'В menu_item_costing % строк без ресторана — сначала заполните или удалите', n; END IF;
END $$;

-- ── 1. Политики orders держат колонку — снимаем на время смены типа ──
DROP POLICY IF EXISTS orders_select_waiter ON public.orders;
DROP POLICY IF EXISTS orders_insert_waiter ON public.orders;
DROP POLICY IF EXISTS orders_update_waiter ON public.orders;

-- ── 2. Тип uuid ──
ALTER TABLE public.orders ALTER COLUMN restaurant_id TYPE uuid USING restaurant_id::uuid;
ALTER TABLE public.reviews ALTER COLUMN restaurant_id TYPE uuid USING restaurant_id::uuid;
ALTER TABLE public.conversation_turns ALTER COLUMN restaurant_id TYPE uuid USING restaurant_id::uuid;
ALTER TABLE public.guest_restaurant_stats ALTER COLUMN restaurant_id TYPE uuid USING restaurant_id::uuid;
ALTER TABLE public.restaurant_ai_profiles ALTER COLUMN restaurant_id TYPE uuid USING restaurant_id::uuid;

-- ── 3. Допуск официанта: перегрузка с uuid и политики заново ──
CREATE OR REPLACE FUNCTION public.waiter_can_access_restaurant(p_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.waiter_can_access_restaurant(p_restaurant_id::text) $$;
REVOKE ALL ON FUNCTION public.waiter_can_access_restaurant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waiter_can_access_restaurant(uuid) TO authenticated, service_role;

CREATE POLICY orders_select_waiter ON public.orders FOR SELECT TO authenticated
  USING (public.waiter_can_access_restaurant(restaurant_id));
CREATE POLICY orders_insert_waiter ON public.orders FOR INSERT TO authenticated
  WITH CHECK (public.waiter_can_access_restaurant(restaurant_id));
CREATE POLICY orders_update_waiter ON public.orders FOR UPDATE TO authenticated
  USING (public.waiter_can_access_restaurant(restaurant_id))
  WITH CHECK (public.waiter_can_access_restaurant(restaurant_id));

-- ── 4. Функции без ::text ──
-- Статистика гостя в ресторане: теперь с uuid (старая (bigint, text) удаляется).
CREATE OR REPLACE FUNCTION public.update_guest_restaurant_stats(p_guest_id bigint, p_restaurant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_device_id text;
  v_tags      jsonb;
  v_top       jsonb;
  v_total     integer;
  v_avg_check numeric;
BEGIN
  SELECT device_id INTO v_device_id FROM guests WHERE id = p_guest_id;
  IF v_device_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(jsonb_object_agg(tag, cnt), '{}') INTO v_tags
  FROM (
    SELECT tag, COUNT(*) AS cnt
    FROM order_items oi
    JOIN order_guests og ON og.order_id = oi.order_id AND og.seat_number = oi.seat_number
    JOIN orders o ON o.id = oi.order_id
    JOIN menu_items mi ON mi.id = oi.item_id
    CROSS JOIN UNNEST(mi.tags) AS tag
    WHERE og.device_id = v_device_id AND o.status = 'paid' AND o.restaurant_id = p_restaurant_id
    GROUP BY tag
    ORDER BY cnt DESC
  ) t;

  SELECT COALESCE(jsonb_agg(dish_obj ORDER BY times DESC), '[]') INTO v_top
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
    WHERE og.device_id = v_device_id AND o.status = 'paid' AND o.restaurant_id = p_restaurant_id
    GROUP BY mi.id, mi.dish_name
    ORDER BY COUNT(*) DESC
    LIMIT 5
  ) t;

  SELECT COUNT(DISTINCT oi.order_id) INTO v_total
  FROM order_items oi
  JOIN order_guests og ON og.order_id = oi.order_id AND og.seat_number = oi.seat_number
  JOIN orders o ON o.id = oi.order_id
  WHERE og.device_id = v_device_id AND o.status = 'paid' AND o.restaurant_id = p_restaurant_id;

  SELECT COALESCE(ROUND(AVG(seat_total), 2), 0) INTO v_avg_check
  FROM (
    SELECT oi.order_id, SUM(oi.unit_price * oi.quantity) AS seat_total
    FROM order_items oi
    JOIN order_guests og ON og.order_id = oi.order_id AND og.seat_number = oi.seat_number
    JOIN orders o ON o.id = oi.order_id
    WHERE og.device_id = v_device_id AND o.status = 'paid' AND o.restaurant_id = p_restaurant_id
    GROUP BY oi.order_id
  ) per_order;

  IF v_total = 0 THEN
    RETURN;
  END IF;

  INSERT INTO guest_restaurant_stats (guest_id, restaurant_id, tags, top_dishes, avg_check, total_orders, last_computed_at)
  VALUES (p_guest_id, p_restaurant_id, v_tags, v_top, v_avg_check, v_total, now())
  ON CONFLICT (guest_id, restaurant_id) DO UPDATE
    SET tags = EXCLUDED.tags,
        top_dishes = EXCLUDED.top_dishes,
        avg_check = EXCLUDED.avg_check,
        total_orders = EXCLUDED.total_orders,
        last_computed_at = EXCLUDED.last_computed_at;
END;
$function$;

-- Права прежней функции (bigint, text) перенесены на новую.
GRANT EXECUTE ON FUNCTION public.update_guest_restaurant_stats(bigint, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.update_guest_restaurant_stats(bigint, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_table_bill(p_restaurant_id uuid, p_table_number text)
 RETURNS TABLE(seat_number integer, is_paid boolean, item_id uuid, dish_name text, quantity integer, unit_price numeric, line_total numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    oi.seat_number,
    COALESCE(og.status = 'paid', false) AS is_paid,
    oi.item_id,
    mi.dish_name,
    oi.quantity,
    oi.unit_price,
    (oi.quantity * oi.unit_price) AS line_total
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id = o.id
  JOIN public.menu_items mi ON mi.id = oi.item_id
  LEFT JOIN public.order_guests og
    ON og.order_id = o.id AND og.seat_number = oi.seat_number
  WHERE o.restaurant_id = p_restaurant_id
    AND o.table_number = p_table_number
    AND o.status IN ('new', 'cooking')
  ORDER BY oi.seat_number, oi.id;
$function$;

CREATE OR REPLACE FUNCTION public.pay_table_seats(p_restaurant_id uuid, p_table_number text, p_seat_numbers integer[])
 RETURNS TABLE(paid_order_id uuid, all_paid boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  WHERE restaurant_id = p_restaurant_id
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

    PERFORM public.update_guest_restaurant_stats(g.id, p_restaurant_id)
    FROM (SELECT DISTINCT device_id FROM public.order_guests WHERE order_id = v_order_id) og
    JOIN public.guests g ON g.device_id = og.device_id;
  END IF;

  RETURN QUERY SELECT v_order_id, v_all_paid;
END;
$function$;

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

  -- Итог: база (unit_price * qty) + наценки модификаторов (price_delta * qty
  -- того же order_item).
  SELECT COALESCE(SUM(oi.unit_price * oi.quantity), 0)::integer INTO v_total
  FROM public.order_items oi
  WHERE oi.order_id = v_order_id;

  SELECT v_total + COALESCE(SUM(oim.price_delta * oi.quantity), 0)::integer INTO v_total
  FROM public.order_item_modifiers oim
  JOIN public.order_items oi ON oi.id = oim.order_item_id
  WHERE oi.order_id = v_order_id;

  UPDATE public.orders SET total_amount = v_total WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_seat_number, v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_review(p_restaurant_id uuid, p_table_number text, p_device_id text, p_rating_food integer, p_rating_service integer, p_comment text, p_session_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_table_id uuid; v_ok boolean;
BEGIN
  IF p_table_number IS NULL OR btrim(p_table_number)='' OR p_table_number='null' THEN
    RAISE EXCEPTION 'Не удалось определить номер стола'; END IF;
  SELECT id INTO v_table_id FROM public.tables
  WHERE restaurant_id=p_restaurant_id AND number=p_table_number::integer AND is_active=true;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'Стол не найден'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.order_guests og
    JOIN public.orders o ON o.id=og.order_id
    WHERE og.device_id=p_device_id AND o.table_id=v_table_id) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Отзыв можно оставить только после заказа за этим столом'; END IF;
  INSERT INTO public.reviews (restaurant_id, table_number, rating_food, rating_service, comment, session_id)
  VALUES (p_restaurant_id, p_table_number,
    LEAST(GREATEST(COALESCE(p_rating_food,0),0),5),
    LEAST(GREATEST(COALESCE(p_rating_service,0),0),5),
    NULLIF(btrim(COALESCE(p_comment,'')),''), p_session_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.take_guest_cart(p_table_id uuid, p_seat_number integer)
 RETURNS TABLE(order_id uuid, seat_number integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session_id   uuid;
  v_restaurant   uuid;
  v_device       text;
  v_items        jsonb;
  v_table_number text;
  v_order_id     uuid;
  v_item         jsonb;
  v_unit_price   numeric;
  v_oi_id        uuid;
  v_mod          text;
  v_mod_price    numeric;
  v_total        integer;
BEGIN
  -- Активная сессия стола.
  SELECT ts.id, ts.restaurant_id INTO v_session_id, v_restaurant
  FROM public.table_sessions ts
  WHERE ts.table_id = p_table_id AND ts.is_active = true
  ORDER BY ts.started_at DESC
  LIMIT 1;

  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'Активная сессия стола не найдена';
  END IF;

  -- Черновик этого гостя (может отсутствовать/быть пустым — тогда просто
  -- откроем заказ для гостя без позиций).
  SELECT d.items, d.device_id INTO v_items, v_device
  FROM public.guest_cart_drafts d
  WHERE d.session_id = v_session_id AND d.seat_number = p_seat_number;

  v_items := COALESCE(v_items, '[]'::jsonb);

  PERFORM pg_advisory_xact_lock(hashtextextended(p_table_id::text, 0));

  SELECT t.number::text INTO v_table_number FROM public.tables t WHERE t.id = p_table_id;

  -- Найти/создать не оплаченный заказ стола.
  SELECT o.id INTO v_order_id
  FROM public.orders o
  WHERE o.table_id = p_table_id AND o.status IN ('new', 'cooking')
  ORDER BY o.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    INSERT INTO public.orders (table_id, table_number, restaurant_id, status, total_amount, items)
    VALUES (p_table_id, v_table_number, v_restaurant, 'new', 0, '[]'::jsonb)
    RETURNING id INTO v_order_id;
  END IF;

  -- Гость за местом.
  IF NOT EXISTS (
    SELECT 1 FROM public.order_guests og
    WHERE og.order_id = v_order_id AND og.seat_number = p_seat_number
  ) THEN
    INSERT INTO public.order_guests (order_id, seat_number, device_id)
    VALUES (v_order_id, p_seat_number, v_device);
  END IF;

  -- Переносим позиции черновика как 'new'. Цену и наценки берём из БД.
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    SELECT cost_rub INTO v_unit_price
    FROM public.menu_items
    WHERE id = (v_item->>'item_id')::uuid AND restaurant_id = v_restaurant;

    IF v_unit_price IS NULL THEN
      CONTINUE; -- неизвестное блюдо молча пропускаем
    END IF;

    INSERT INTO public.order_items
      (order_id, item_id, seat_number, quantity, unit_price, status, comment)
    VALUES (
      v_order_id,
      (v_item->>'item_id')::uuid,
      p_seat_number,
      GREATEST(COALESCE((v_item->>'quantity')::integer, 1), 1),
      v_unit_price,
      'new',
      NULLIF(v_item->>'comment', '')
    )
    RETURNING id INTO v_oi_id;

    IF jsonb_typeof(v_item->'modifiers') = 'array' THEN
      FOR v_mod IN SELECT jsonb_array_elements_text(v_item->'modifiers')
      LOOP
        SELECT price_delta INTO v_mod_price FROM public.modifiers WHERE id = v_mod::uuid;
        IF v_mod_price IS NOT NULL THEN
          INSERT INTO public.order_item_modifiers (order_item_id, modifier_id, price_delta)
          VALUES (v_oi_id, v_mod::uuid, v_mod_price);
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- Черновик «взят» — очищаем, чтобы не задваивать и не показывать повторно.
  -- Алиас d обязателен: seat_number также имя OUT-параметра (RETURNS TABLE),
  -- без квалификации PostgreSQL считает ссылку неоднозначной (42702).
  DELETE FROM public.guest_cart_drafts d
  WHERE d.session_id = v_session_id AND d.seat_number = p_seat_number;

  -- Пересчёт суммы заказа: база + наценки модификаторов.
  SELECT COALESCE(SUM(oi.unit_price * oi.quantity), 0)::integer INTO v_total
  FROM public.order_items oi WHERE oi.order_id = v_order_id;

  SELECT v_total + COALESCE(SUM(oim.price_delta * oi.quantity), 0)::integer INTO v_total
  FROM public.order_item_modifiers oim
  JOIN public.order_items oi ON oi.id = oim.order_item_id
  WHERE oi.order_id = v_order_id;

  UPDATE public.orders SET total_amount = v_total WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, p_seat_number;
END;
$function$;

-- Функции чтения для гостя (20261024040000) — без ::text.
CREATE OR REPLACE FUNCTION public.get_table_unpaid_total(p_restaurant_id uuid, p_table_number text)
RETURNS numeric
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT COALESCE(sum(t.total_amount), 0)
  FROM (
    SELECT o.total_amount
    FROM public.orders o
    WHERE o.restaurant_id = p_restaurant_id
      AND o.table_number = p_table_number
      AND o.status IN ('new', 'cooking')
    LIMIT 20
  ) t;
$$;

CREATE OR REPLACE FUNCTION public.get_guest_restaurant_stats(p_device_id text, p_restaurant_id uuid)
RETURNS TABLE (tags jsonb, top_dishes jsonb, avg_check numeric, total_orders integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT s.tags, s.top_dishes, s.avg_check::numeric, s.total_orders
  FROM public.guest_restaurant_stats s
  WHERE s.guest_id = public.guest_id_for_device(p_device_id)
    AND s.restaurant_id = p_restaurant_id;
$$;

CREATE OR REPLACE FUNCTION public.get_restaurant_ai_profile(p_restaurant_id uuid)
RETURNS TABLE (character_profile jsonb, restaurant_policy jsonb, philosophy text)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT p.character_profile, p.restaurant_policy, p.philosophy
  FROM public.restaurant_ai_profiles p
  WHERE p.restaurant_id = p_restaurant_id;
$$;

DROP FUNCTION IF EXISTS public.update_guest_restaurant_stats(bigint, text);

-- ── 5. Внешние ключи на restaurants ──
ALTER TABLE public.ai_suggestion_events ADD CONSTRAINT ai_suggestion_events_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants("restaurantId") ON DELETE CASCADE;
ALTER TABLE public.conversation_turns ADD CONSTRAINT conversation_turns_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants("restaurantId") ON DELETE CASCADE;
ALTER TABLE public.dish_daily_flags ADD CONSTRAINT dish_daily_flags_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants("restaurantId") ON DELETE CASCADE;
ALTER TABLE public.guest_cart_drafts ADD CONSTRAINT guest_cart_drafts_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants("restaurantId") ON DELETE CASCADE;
ALTER TABLE public.guest_restaurant_stats ADD CONSTRAINT guest_restaurant_stats_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants("restaurantId") ON DELETE CASCADE;
ALTER TABLE public.menu_item_costing ADD CONSTRAINT menu_item_costing_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants("restaurantId") ON DELETE CASCADE;
ALTER TABLE public.menu_pairing_state ADD CONSTRAINT menu_pairing_state_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants("restaurantId") ON DELETE CASCADE;
ALTER TABLE public.menu_pairings ADD CONSTRAINT menu_pairings_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants("restaurantId") ON DELETE CASCADE;
ALTER TABLE public.orders ADD CONSTRAINT orders_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants("restaurantId") ON DELETE CASCADE;
ALTER TABLE public.restaurant_ai_profiles ADD CONSTRAINT restaurant_ai_profiles_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants("restaurantId") ON DELETE CASCADE;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants("restaurantId") ON DELETE CASCADE;
ALTER TABLE public.staff_review_prompts ADD CONSTRAINT staff_review_prompts_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants("restaurantId") ON DELETE CASCADE;
ALTER TABLE public.table_reservations ADD CONSTRAINT table_reservations_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants("restaurantId") ON DELETE CASCADE;
ALTER TABLE public.table_sessions ADD CONSTRAINT table_sessions_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants("restaurantId") ON DELETE CASCADE;
ALTER TABLE public.waiter_ai_suggestions ADD CONSTRAINT waiter_ai_suggestions_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants("restaurantId") ON DELETE CASCADE;

-- ── 6. Ресторан обязателен ──
ALTER TABLE public.jobs ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE public.menu_items ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE public.table_sessions ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE public.staff_feedback ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE public.staff_review_prompts ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE public.reviews ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE public.dish_daily_flags ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE public.menu_item_costing ALTER COLUMN restaurant_id SET NOT NULL;

COMMIT;
NOTIFY pgrst, 'reload schema';
