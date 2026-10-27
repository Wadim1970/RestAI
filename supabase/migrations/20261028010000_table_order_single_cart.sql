-- ============================================================
-- Стол — одна сущность: корзина гостя это строки общего заказа стола.
--
-- Было: корзина гостя жила в его телефоне, на сервер уходила копия-черновик
-- (guest_cart_drafts), официант «брал» её копированием (take_guest_cart), и
-- отправка гостя добавляла блюда второй раз.
--
-- Стало: у посадки стола один неоплаченный заказ. Корзина гостя — это строки
-- этого заказа со status = 'new' на его месте (seat_number). Гость, официант и
-- голосовой помощник пишут в одни и те же строки. «Отправить» только меняет
-- 'new' → 'sent'. Блюда других мест гость не видит (get_my_table_state отдаёт
-- только его место); весь чек стола виден лишь при оплате (get_table_bill).
--
-- Новые функции для гостя (по device_id, как и раньше):
--   cart_join(ресторан, стол, устройство)    — войти за стол: место и заказ
--   cart_set(ресторан, стол, устройство, блюдо, количество, комментарий, опции)
--                                            — задать количество строки (0 = убрать)
--   cart_send(ресторан, стол, устройство, комментарий)
--                                            — отправить свои строки на кухню
--   get_my_table_state(ресторан, стол, устройство)
--                                            — моё место: корзина и заказанное
--
-- Что ещё меняется:
--   • Строки 'new' не входят в сумму заказа, в чек (get_table_bill) и не мешают
--     закрыть стол при оплате (pay_table_seats). Итог заказа теперь считает
--     триггер при любом изменении строк, в том числе у официанта.
--   • Заказ стал «paid» — оставшиеся строки 'new' удаляются.
--   • release_table_if_occupied (стол освобождён без заказа) убирает корзины и
--     пустой заказ посадки.
--   • place_guest_order (старые приложения, очередь без связи) работает как
--     прежде, итог считает по общему правилу.
--   • order_items.created_at — чтобы корзина показывалась в порядке добавления.
--
-- Старые guest_cart_drafts / sync_guest_cart / take_guest_cart /
-- get_table_cart_drafts остаются до выкладки приложений; удаляются отдельной
-- миграцией.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261028010000_table_order_single_cart.sql
-- Откат: 20261028010000_table_order_single_cart_rollback.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Порядок добавления строк
-- ------------------------------------------------------------
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- ------------------------------------------------------------
-- 2. Итог заказа: отправленные строки (status <> 'new') + наценки опций.
--    Оплаченные заказы не пересчитываются.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._recalc_order_total(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v integer;
BEGIN
  SELECT COALESCE(SUM(oi.quantity * (oi.unit_price + COALESCE(m.delta, 0))), 0)::integer
  INTO v
  FROM public.order_items oi
  LEFT JOIN LATERAL (
    SELECT SUM(oim.price_delta) AS delta
    FROM public.order_item_modifiers oim
    WHERE oim.order_item_id = oi.id
  ) m ON true
  WHERE oi.order_id = p_order_id
    AND oi.status <> 'new';

  UPDATE public.orders
  SET total_amount = v
  WHERE id = p_order_id
    AND status IS DISTINCT FROM 'paid'
    AND total_amount IS DISTINCT FROM v;
END $$;
REVOKE ALL ON FUNCTION public._recalc_order_total(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_order_items_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public._recalc_order_total(NEW.order_id);
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.order_id IS DISTINCT FROM NEW.order_id) THEN
    PERFORM public._recalc_order_total(OLD.order_id);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.trg_order_items_total() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_order_items_total ON public.order_items;
CREATE TRIGGER trg_order_items_total
  AFTER INSERT OR DELETE OR UPDATE OF order_id, quantity, unit_price, status ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_order_items_total();

CREATE OR REPLACE FUNCTION public.trg_order_item_modifiers_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_order uuid;
BEGIN
  SELECT oi.order_id INTO v_order
  FROM public.order_items oi
  WHERE oi.id = COALESCE(NEW.order_item_id, OLD.order_item_id);
  IF v_order IS NOT NULL THEN
    PERFORM public._recalc_order_total(v_order);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.trg_order_item_modifiers_total() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_order_item_modifiers_total ON public.order_item_modifiers;
CREATE TRIGGER trg_order_item_modifiers_total
  AFTER INSERT OR DELETE OR UPDATE OF price_delta ON public.order_item_modifiers
  FOR EACH ROW EXECUTE FUNCTION public.trg_order_item_modifiers_total();

-- ------------------------------------------------------------
-- 3. Заказ оплачен — неотправленные строки больше не нужны.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_orders_paid_drop_unsent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  DELETE FROM public.order_items WHERE order_id = NEW.id AND status = 'new';
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.trg_orders_paid_drop_unsent() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_orders_paid_drop_unsent ON public.orders;
CREATE TRIGGER trg_orders_paid_drop_unsent
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW WHEN (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid')
  EXECUTE FUNCTION public.trg_orders_paid_drop_unsent();

-- ------------------------------------------------------------
-- 4. Вход гостя за стол: активная посадка, общий заказ, место гостя.
--    Внутренняя функция; клиентам отдаются cart_join / cart_set / cart_send.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 5. cart_join — гость отсканировал QR / открыл меню: место за столом.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cart_join(
  p_restaurant_id uuid, p_table_number text, p_device_id text
)
RETURNS TABLE(session_id uuid, order_id uuid, seat_number integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT e.o_session_id, e.o_order_id, e.o_seat
  FROM public._cart_enter(p_restaurant_id, p_table_number, p_device_id) e;
END $$;

-- ------------------------------------------------------------
-- 6. cart_set — задать количество блюда в корзине своего места.
--    Строка определяется блюдом + комментарием + опциями. Количество задаётся
--    абсолютно (повтор запроса безопасен, подходит очереди без связи);
--    0 — убрать строку. Отправленные строки не затрагиваются.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cart_set(
  p_restaurant_id uuid, p_table_number text, p_device_id text,
  p_item_id uuid, p_quantity integer,
  p_comment text DEFAULT NULL, p_modifiers jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_order_id uuid;
  v_seat     integer;
  v_qty      integer := LEAST(GREATEST(COALESCE(p_quantity, 0), 0), 99);
  v_comment  text := NULLIF(btrim(COALESCE(p_comment, '')), '');
  v_price    numeric;
  v_line     uuid;
  v_mod      text;
  v_delta    integer;
BEGIN
  SELECT e.o_order_id, e.o_seat INTO v_order_id, v_seat
  FROM public._cart_enter(p_restaurant_id, p_table_number, p_device_id) e;

  v_line := public._find_new_order_line(v_order_id, v_seat, p_item_id, v_comment, p_modifiers, '{}'::uuid[]);

  IF v_qty = 0 THEN
    IF v_line IS NOT NULL THEN
      DELETE FROM public.order_items WHERE id = v_line;
    END IF;
    RETURN jsonb_build_object('line_id', NULL, 'quantity', 0);
  END IF;

  SELECT m.cost_rub INTO v_price
  FROM public.menu_items m
  WHERE m.id = p_item_id AND m.restaurant_id = p_restaurant_id;
  IF v_price IS NULL THEN
    RAISE EXCEPTION 'Блюдо % не найдено в меню этого ресторана', p_item_id;
  END IF;

  IF v_line IS NOT NULL THEN
    UPDATE public.order_items
    SET quantity = v_qty, unit_price = v_price
    WHERE id = v_line;
  ELSE
    INSERT INTO public.order_items (order_id, item_id, seat_number, quantity, unit_price, status, comment)
    VALUES (v_order_id, p_item_id, v_seat, v_qty, v_price, 'new', v_comment)
    RETURNING id INTO v_line;

    IF jsonb_typeof(p_modifiers) = 'array' THEN
      FOR v_mod IN SELECT DISTINCT jsonb_array_elements_text(p_modifiers)
      LOOP
        SELECT mo.price_delta INTO v_delta FROM public.modifiers mo WHERE mo.id::text = v_mod;
        IF v_delta IS NOT NULL THEN
          INSERT INTO public.order_item_modifiers (order_item_id, modifier_id, price_delta)
          VALUES (v_line, v_mod::uuid, v_delta);
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object('line_id', v_line, 'quantity', v_qty);
END $$;

-- ------------------------------------------------------------
-- 7. cart_send — отправить на кухню свои строки 'new'.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cart_send(
  p_restaurant_id uuid, p_table_number text, p_device_id text, p_comment text DEFAULT NULL
)
RETURNS TABLE(order_id uuid, seat_number integer, total_amount integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
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
END $$;

-- ------------------------------------------------------------
-- 8. get_my_table_state — только моё место: корзина (status = 'new') и
--    заказанное (sent / ready). Ничего не создаёт. Блюд других мест не отдаёт.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_table_state(
  p_restaurant_id uuid, p_table_number text, p_device_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_table_id   uuid;
  v_session    record;
  v_order      record;
  v_seat       integer;
  v_lines      jsonb;
BEGIN
  IF p_table_number IS NULL OR btrim(p_table_number) = '' OR p_table_number = 'null'
     OR p_device_id IS NULL OR btrim(p_device_id) = '' THEN
    RETURN jsonb_build_object('session_id', NULL, 'lines', '[]'::jsonb);
  END IF;

  SELECT t.id INTO v_table_id
  FROM public.tables t
  WHERE t.restaurant_id = p_restaurant_id AND t.number = p_table_number::integer AND t.is_active = true;
  IF v_table_id IS NULL THEN
    RETURN jsonb_build_object('session_id', NULL, 'lines', '[]'::jsonb);
  END IF;

  SELECT ts.id, ts.status INTO v_session
  FROM public.table_sessions ts
  WHERE ts.table_id = v_table_id AND ts.is_active = true
  ORDER BY ts.started_at DESC LIMIT 1;
  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('session_id', NULL, 'lines', '[]'::jsonb);
  END IF;

  SELECT o.id, o.status INTO v_order
  FROM public.orders o
  WHERE o.table_id = v_table_id AND o.status IN ('new', 'cooking')
  ORDER BY o.created_at DESC LIMIT 1;

  IF v_order.id IS NOT NULL THEN
    SELECT og.seat_number INTO v_seat
    FROM public.order_guests og
    WHERE og.order_id = v_order.id AND og.device_id = p_device_id;
  END IF;

  IF v_seat IS NULL THEN
    RETURN jsonb_build_object(
      'session_id', v_session.id, 'session_status', v_session.status,
      'order_id', v_order.id, 'order_status', v_order.status,
      'seat_number', NULL, 'lines', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', oi.id,
           'item_id', oi.item_id,
           'dish_name', mi.dish_name,
           'image_url', mi.image_url,
           'image_url_thumbnail', mi.image_url_thumbnail,
           'product_type', mi.product_type,
           'cost_rub', mi.cost_rub,
           'quantity', oi.quantity,
           'unit_price', oi.unit_price,
           'comment', oi.comment,
           'status', oi.status,
           'sent_at', oi.sent_at,
           'ready_at', oi.ready_at,
           'modifiers', COALESCE((
             SELECT jsonb_agg(jsonb_build_object('id', mo.id, 'name', mo.name, 'price_delta', oim.price_delta))
             FROM public.order_item_modifiers oim
             JOIN public.modifiers mo ON mo.id = oim.modifier_id
             WHERE oim.order_item_id = oi.id
           ), '[]'::jsonb)
         ) ORDER BY oi.created_at, oi.id), '[]'::jsonb)
  INTO v_lines
  FROM public.order_items oi
  JOIN public.menu_items mi ON mi.id = oi.item_id
  WHERE oi.order_id = v_order.id AND oi.seat_number = v_seat;

  RETURN jsonb_build_object(
    'session_id', v_session.id, 'session_status', v_session.status,
    'order_id', v_order.id, 'order_status', v_order.status,
    'seat_number', v_seat, 'lines', v_lines);
END $$;

-- Клиентам (по device_id, как и остальные гостевые функции).
REVOKE ALL ON FUNCTION public.cart_join(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cart_set(uuid, text, text, uuid, integer, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cart_send(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_table_state(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cart_join(uuid, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cart_set(uuid, text, text, uuid, integer, text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cart_send(uuid, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_table_state(uuid, text, text) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 9. Существующие функции: строки 'new' не входят в чек, оплату и итог.
-- ------------------------------------------------------------
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
    AND oi.status <> 'new'
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
    SELECT DISTINCT oi.seat_number FROM public.order_items oi WHERE oi.order_id = v_order_id AND oi.status <> 'new'
  )
  ON CONFLICT (order_id, seat_number) DO UPDATE SET status = 'paid';

  SELECT NOT EXISTS (
    SELECT 1
    FROM (SELECT DISTINCT seat_number FROM public.order_items WHERE order_id = v_order_id AND status <> 'new') roster
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

CREATE OR REPLACE FUNCTION public.release_table_if_occupied(p_session_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_done boolean := false;
BEGIN
  UPDATE public.table_sessions
  SET is_active = false, ended_at = now(), status = 'free'
  WHERE id = p_session_id
    AND is_active = true
    AND status = 'occupied';
  GET DIAGNOSTICS v_done = ROW_COUNT;
  IF v_done THEN
    DELETE FROM public.guest_cart_drafts WHERE session_id = p_session_id;

    -- Стол свободен, ничего не отправлено: корзины гостей (строки 'new') и
    -- пустой заказ этой посадки убираем, чтобы не висели на закрытом столе.
    DELETE FROM public.order_items oi
    USING public.orders o
    WHERE oi.order_id = o.id
      AND o.table_session_id = p_session_id
      AND o.status IN ('new', 'cooking')
      AND oi.status = 'new';

    DELETE FROM public.orders o
    WHERE o.table_session_id = p_session_id
      AND o.status = 'new'
      AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id);
  END IF;
  RETURN v_done;
END;
$function$;


COMMIT;
NOTIFY pgrst, 'reload schema';
