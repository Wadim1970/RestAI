-- Откат 20261029020000_drop_cart_drafts.sql: возвращает таблицу guest_cart_drafts
-- (пустую), три функции и прежнюю release_table_if_occupied.
BEGIN;

CREATE TABLE IF NOT EXISTS public.guest_cart_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE CASCADE,
  table_id      uuid NOT NULL,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  device_id     text NOT NULL,
  seat_number   integer NOT NULL,
  items         jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_guest_cart_drafts_table   ON public.guest_cart_drafts(table_id);
CREATE INDEX IF NOT EXISTS idx_guest_cart_drafts_session ON public.guest_cart_drafts(session_id);
ALTER TABLE public.guest_cart_drafts ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_rc_guest_cart_drafts_session_id ON public.guest_cart_drafts;
CREATE TRIGGER trg_rc_guest_cart_drafts_session_id
  BEFORE INSERT OR UPDATE OF session_id, restaurant_id ON public.guest_cart_drafts
  FOR EACH ROW EXECUTE FUNCTION fn_same_restaurant('session_id', 'SELECT restaurant_id FROM public.table_sessions WHERE id = $1::uuid', 'посадка');

CREATE OR REPLACE FUNCTION public.sync_guest_cart(p_restaurant_id uuid, p_table_number text, p_device_id text, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(session_id uuid, seat_number integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_table_id   uuid;
  v_session_id uuid;
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
  LIMIT 1;
  IF v_session_id IS NULL THEN
    INSERT INTO public.table_sessions (table_id, restaurant_id, status, is_active, started_at)
    VALUES (v_table_id, p_restaurant_id, 'occupied', true, now())
    RETURNING id INTO v_session_id;
  END IF;

  SELECT d.seat_number INTO v_seat
  FROM public.guest_cart_drafts d
  WHERE d.session_id = v_session_id AND d.device_id = p_device_id;

  IF v_seat IS NULL THEN
    SELECT COALESCE(MAX(d.seat_number), 0) + 1 INTO v_seat
    FROM public.guest_cart_drafts d
    WHERE d.session_id = v_session_id;

    INSERT INTO public.guest_cart_drafts
      (session_id, table_id, restaurant_id, device_id, seat_number, items, updated_at)
    VALUES
      (v_session_id, v_table_id, p_restaurant_id, p_device_id, v_seat, COALESCE(p_items, '[]'::jsonb), now());
  ELSE
    UPDATE public.guest_cart_drafts AS gcd
    SET items = COALESCE(p_items, '[]'::jsonb), updated_at = now()
    WHERE gcd.session_id = v_session_id AND gcd.device_id = p_device_id;
  END IF;

  UPDATE public.table_sessions
  SET guest_count = (SELECT COUNT(*) FROM public.guest_cart_drafts gcd WHERE gcd.session_id = v_session_id)
  WHERE id = v_session_id;

  RETURN QUERY SELECT v_session_id, v_seat;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_table_cart_drafts(p_table_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session_id uuid;
  v_result     jsonb;
BEGIN
  SELECT id INTO v_session_id
  FROM public.table_sessions
  WHERE table_id = p_table_id AND is_active = true
  LIMIT 1;
  IF v_session_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(seat ORDER BY (seat->>'seat_number')::int), '[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'seat_number', d.seat_number,
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'item_id',   elem->>'item_id',
          'dish_name', mi.dish_name,
          'image_url', mi.image_url,
          'unit_price', mi.cost_rub,
          'quantity',  GREATEST(COALESCE((elem->>'quantity')::int, 1), 1),
          'comment',   NULLIF(elem->>'comment', ''),
          'modifiers', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('name', m.name, 'price_delta', COALESCE(m.price_delta, 0)))
            FROM jsonb_array_elements_text(COALESCE(elem->'modifiers', '[]'::jsonb)) AS mid
            JOIN public.modifiers m ON m.id = mid::uuid
          ), '[]'::jsonb)
        ))
        FROM jsonb_array_elements(d.items) AS elem
        JOIN public.menu_items mi ON mi.id = (elem->>'item_id')::uuid
      ), '[]'::jsonb)
    ) AS seat
    FROM public.guest_cart_drafts d
    WHERE d.session_id = v_session_id
      AND jsonb_array_length(d.items) > 0
  ) seats;

  RETURN v_result;
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
