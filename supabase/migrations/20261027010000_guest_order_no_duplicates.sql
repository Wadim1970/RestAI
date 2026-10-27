-- ============================================================
-- Заказ гостя не задваивается, если официант уже «взял» его корзину.
--
-- Что было. Официант нажимает на занятый стол, где гость набрал блюда, но ещё
-- не отправил (take_guest_cart): корзина гостя превращается в заказ со строками
-- status = 'new'. Гость в своём приложении этого не видит, корзина у него цела и
-- он нажимает «Отправить»: place_guest_order добавляла те же блюда ещё раз, со
-- status = 'sent'. Итог в приложении официанта — каждое блюдо дважды: одни
-- строки «не отправлено на кухню», другие «отправлено, ждём готовности».
--
-- Что стало. place_guest_order сначала ищет у того же места строку 'new' с тем
-- же блюдом, комментарием и опциями (_find_new_order_line) и переводит её в
-- 'sent' (количество — как прислал гость), а не вставляет копию. Блюда, которых
-- у официанта не было (гость добавил позже), и строки, которые официант набрал
-- сам, остаются как есть. Сумма заказа пересчитывается, как и раньше.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261027010000_guest_order_no_duplicates.sql
-- Откат: 20261027010000_guest_order_no_duplicates_rollback.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._find_new_order_line(
  p_order_id uuid, p_seat integer, p_item_id uuid, p_comment text, p_modifiers jsonb, p_exclude uuid[]
)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT oi.id
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.seat_number = p_seat
    AND oi.item_id = p_item_id
    AND oi.status = 'new'
    AND oi.comment IS NOT DISTINCT FROM p_comment
    AND NOT (oi.id = ANY (COALESCE(p_exclude, '{}'::uuid[])))
    AND COALESCE((SELECT array_agg(m.modifier_id::text ORDER BY m.modifier_id::text)
                  FROM public.order_item_modifiers m WHERE m.order_item_id = oi.id), '{}'::text[])
      = COALESCE((SELECT array_agg(x.mid ORDER BY x.mid)
                  FROM (SELECT DISTINCT mm.id::text AS mid
                        FROM jsonb_array_elements_text(
                               CASE WHEN jsonb_typeof(p_modifiers) = 'array' THEN p_modifiers ELSE '[]'::jsonb END) e
                        JOIN public.modifiers mm ON mm.id::text = e) x), '{}'::text[])
  ORDER BY oi.id
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public._find_new_order_line(uuid, integer, uuid, text, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;

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

COMMIT;
NOTIFY pgrst, 'reload schema';
