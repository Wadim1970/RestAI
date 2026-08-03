-- ============================================================
-- «Официант берёт корзину гостя» — материализация черновика в заказ.
--
-- ЗАЧЕМ:
--   Гость набирает корзину (guest_cart_drafts), но не отправляет на кухню.
--   Официанту нужно открыть её в том же редактируемом экране меню, что и когда
--   он сам набирает гостю. Для этого черновик надо перенести в order_items
--   (status 'new' = черновик официанта): дальше работает обычный поток
--   (добавить/убрать/модификаторы/отправить на кухню).
--
--   take_guest_cart(p_table_id, p_seat_number):
--     • берёт черновик этого гостя в активной сессии стола;
--     • находит/создаёт заказ стола (не оплаченный);
--     • заводит order_guests при необходимости;
--     • переносит позиции черновика в order_items ('new') + order_item_modifiers
--       (цены/наценки берём из БД, не из черновика);
--     • ОЧИЩАЕТ черновик (он «взят» официантом — чтобы не задваивать);
--     • пересчитывает сумму заказа и возвращает order_id.
--
--   Структура повторяет place_guest_order, но status='new' (не 'sent') и
--   источник — draft, а не входной массив.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260803020000_take_guest_cart.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.take_guest_cart(
  p_table_id     uuid,
  p_seat_number  integer
)
RETURNS TABLE (order_id uuid, seat_number integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    VALUES (p_table_id, v_table_number, v_restaurant::text, 'new', 0, '[]'::jsonb)
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
$$;

GRANT EXECUTE ON FUNCTION public.take_guest_cart(uuid, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
