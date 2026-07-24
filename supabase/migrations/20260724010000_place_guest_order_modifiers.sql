-- ============================================================
-- Модификаторы блюд в гостевом заказе (голосовой ИИ).
--
-- ЗАЧЕМ:
--   У блюд есть модификаторы (modifier_groups → modifiers): прожарка,
--   соус, гарнир и т.п., у некоторых с наценкой (price_delta). Приложение
--   официанта уже умеет их читать/писать (order_item_modifiers), а
--   гостевой путь (place_guest_order) — нет. Добавляем:
--     1) get_restaurant_modifiers — SECURITY DEFINER-чтение всех блюд с
--        модификаторами (голосовой relay ходит под anon, RLS на modifier_*
--        не гарантирован — поэтому через функцию);
--     2) place_guest_order — пишет выбранные модификаторы в
--        order_item_modifiers и учитывает их price_delta в сумме заказа.
--   Обратная совместимость: блюда без поля "modifiers" обрабатываются
--   ровно как раньше.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260724010000_place_guest_order_modifiers.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Чтение модификаторов ресторана (для голосового ИИ). Отдаёт только
--    блюда, у которых модификаторы есть. Формат — сразу удобный ИИ/клиенту.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_restaurant_modifiers(p_restaurant_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(dish ORDER BY dish->>'dish_name'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'item_id', mi.id,
      'dish_name', mi.dish_name,
      'groups', (
        SELECT jsonb_agg(jsonb_build_object(
          'name', mg.name,
          'required', COALESCE(mg.required, false),
          'type', mg.type,
          'options', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object('id', m.id, 'name', m.name, 'price_delta', COALESCE(m.price_delta, 0))
              ORDER BY m.sort_order
            ), '[]'::jsonb)
            FROM public.modifiers m
            WHERE m.group_id = mg.id AND m.is_available = true
          )
        ) ORDER BY mg.sort_order)
        FROM public.modifier_groups mg
        WHERE mg.item_id = mi.id
      )
    ) AS dish
    FROM public.menu_items mi
    WHERE mi.restaurant_id = p_restaurant_id
      AND EXISTS (SELECT 1 FROM public.modifier_groups mg2 WHERE mg2.item_id = mi.id)
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.get_restaurant_modifiers(uuid) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 2. place_guest_order с модификаторами. p_items — элементы теперь могут
--    нести поле "modifiers": массив UUID выбранных modifiers.id. Цену
--    наценки берём ИЗ БД (modifiers.price_delta), клиентской не доверяем.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_guest_order(
  p_restaurant_id uuid,
  p_table_number text,
  p_device_id text,
  p_items jsonb,
  p_comment text DEFAULT NULL
)
RETURNS TABLE (order_id uuid, seat_number integer, total_amount integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    VALUES (v_table_id, p_table_number, p_restaurant_id::text, 'cooking', 0, '[]'::jsonb)
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
$$;

GRANT EXECUTE ON FUNCTION public.place_guest_order(uuid, text, text, jsonb, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
