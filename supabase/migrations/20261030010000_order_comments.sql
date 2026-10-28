-- ============================================================
-- Комментарии к заказу: гость пишет при отправке, официант видит и пишет сам.
--
-- Было: комментарий гостя дописывался текстом в orders.comment («Место 2: …»),
-- приложение официанта его не читало вообще, ответить гостю было нечем.
--
-- Стало: таблица order_comments — одна строка на комментарий:
--   • order_id, seat_number (чей; NULL — ко всему столу или старый комментарий
--     без места), author ('guest' | 'waiter'), body (1…500 символов), created_at;
--   • acknowledged_at / acknowledged_by — официант отметил «учтено».
-- Гость пишет через cart_send и place_guest_order (они и дальше дописывают
-- orders.comment — для кухонных терминалов и старых приложений). Официант —
-- через add_order_comment (тоже дописывает orders.comment), отметка —
-- ack_order_comment. Читать таблицу могут только официанты с доступом к заказу.
-- Включён realtime — экран официанта обновляется сам.
--
-- Существующие комментарии неоплаченных заказов переносятся из текста в таблицу.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261030010000_order_comments.sql
-- Откат: 20261030010000_order_comments_rollback.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.order_comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  seat_number     integer,
  author          text NOT NULL CHECK (author IN ('guest', 'waiter')),
  author_waiter_id uuid,
  body            text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at      timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid
);

CREATE INDEX IF NOT EXISTS order_comments_order_idx ON public.order_comments (order_id, created_at);

ALTER TABLE public.order_comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_comments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_comments TO authenticated;
GRANT ALL ON public.order_comments TO service_role;

DROP POLICY IF EXISTS order_comments_select_waiter ON public.order_comments;
CREATE POLICY order_comments_select_waiter ON public.order_comments
  FOR SELECT TO authenticated USING (public.waiter_can_access_order(order_id));

-- Realtime: экран официанта получает новые комментарии и отметки сам.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'order_comments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_comments;
  END IF;
END $$;

-- Перенос: комментарии неоплаченных заказов из текста («Место N: …», по строке) в таблицу.
INSERT INTO public.order_comments (order_id, seat_number, author, body, created_at)
SELECT o.id,
       CASE WHEN m.parts IS NOT NULL THEN m.parts[1]::integer END,
       'guest',
       left(btrim(COALESCE(m.parts[2], line.txt)), 500),
       o.created_at
FROM public.orders o
CROSS JOIN LATERAL unnest(string_to_array(o.comment, E'\n')) AS line(txt)
CROSS JOIN LATERAL (SELECT regexp_match(line.txt, '^Место ([0-9]{1,3}): (.+)$') AS parts) m
WHERE o.status IN ('new', 'cooking', 'bill_requested')
  AND btrim(COALESCE(line.txt, '')) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.order_comments c WHERE c.order_id = o.id);

-- ------------------------------------------------------------
-- Официант пишет комментарий (ко всему столу или к месту гостя).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_order_comment(p_order_id uuid, p_seat integer, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me   uuid := public.current_waiter_id();
  v_body text := left(btrim(COALESCE(p_body, '')), 500);
  v_id   uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Нужен вход официанта' USING ERRCODE = '42501';
  END IF;
  IF v_body = '' THEN
    RAISE EXCEPTION 'Пустой комментарий';
  END IF;
  IF NOT public.waiter_can_access_order(p_order_id) THEN
    RAISE EXCEPTION 'Нет доступа к заказу' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id AND o.status = 'paid') THEN
    RAISE EXCEPTION 'Заказ уже оплачен';
  END IF;

  INSERT INTO public.order_comments (order_id, seat_number, author, author_waiter_id, body)
  VALUES (p_order_id, p_seat, 'waiter', v_me, v_body)
  RETURNING id INTO v_id;

  -- Общий текст заказа (для кухонных терминалов и старых приложений).
  UPDATE public.orders o
  SET comment = CASE
    WHEN o.comment IS NULL OR btrim(o.comment) = '' THEN
      CASE WHEN p_seat IS NULL THEN format('Официант: %s', v_body) ELSE format('Официант (место %s): %s', p_seat, v_body) END
    ELSE o.comment || E'\n' ||
      CASE WHEN p_seat IS NULL THEN format('Официант: %s', v_body) ELSE format('Официант (место %s): %s', p_seat, v_body) END
  END
  WHERE o.id = p_order_id;

  RETURN v_id;
END $$;

-- ------------------------------------------------------------
-- Отметка «учтено» (и снятие отметки).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ack_order_comment(p_id uuid, p_acknowledged boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me    uuid := public.current_waiter_id();
  v_order uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Нужен вход официанта' USING ERRCODE = '42501';
  END IF;
  SELECT c.order_id INTO v_order FROM public.order_comments c WHERE c.id = p_id;
  IF v_order IS NULL OR NOT public.waiter_can_access_order(v_order) THEN
    RAISE EXCEPTION 'Нет доступа к комментарию' USING ERRCODE = '42501';
  END IF;
  UPDATE public.order_comments
  SET acknowledged_at = CASE WHEN COALESCE(p_acknowledged, true) THEN now() ELSE NULL END,
      acknowledged_by = CASE WHEN COALESCE(p_acknowledged, true) THEN v_me ELSE NULL END
  WHERE id = p_id;
END $$;

REVOKE ALL ON FUNCTION public.add_order_comment(uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ack_order_comment(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_order_comment(uuid, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ack_order_comment(uuid, boolean) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Гость: комментарий при отправке попадает и в таблицу.
-- ------------------------------------------------------------
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

    INSERT INTO public.order_comments (order_id, seat_number, author, body)
    VALUES (v_order_id, v_seat, 'guest', left(btrim(p_comment), 500));
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

    INSERT INTO public.order_comments (order_id, seat_number, author, body)
    VALUES (v_order_id, v_seat_number, 'guest', left(btrim(p_comment), 500));
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

COMMIT;
NOTIFY pgrst, 'reload schema';
