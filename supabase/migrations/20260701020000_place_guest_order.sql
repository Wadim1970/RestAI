-- ============================================================
-- Связка гостевого заказа (RestAI) с реляционной моделью, которую
-- уже использует Waiter-app (orders + order_items + order_guests).
--
-- ЗАЧЕМ:
--   RestAI писал заказ ТОЛЬКО в JSONB-блоб orders.items — Waiter-app
--   ищет позиции в order_items и стол по table_id, которого RestAI
--   вообще не проставлял. Итог: 100% гостевых заказов были невидимы
--   официанту (проверено на живых данных: 20 из 20 заказов с непустым
--   items имели 0 строк в order_items).
--
--   Эта функция — единственная точка входа для гостевого заказа:
--   находит стол, открывает/переводит сессию в "preparing", находит
--   или создаёт заказ, определяет место (seat) по device_id гостя,
--   берёт РЕАЛЬНУЮ цену блюда из menu_items (не из браузера), и сразу
--   отправляет позиции на кухню (status='sent') — решение: без
--   подтверждения официантом, обсуждено с владельцем продукта.
--
-- Место (seat) по device_id:
--   order_guests уже хранит атрибуты по (order_id, seat_number) —
--   добавляем туда device_id, а не заводим отдельную таблицу.
--   Один device_id -> одно место в рамках заказа (UNIQUE), повторный
--   заказ с того же телефона попадает в то же место.
--
-- Гонка при одновременных заказах за одним столом:
--   FOR UPDATE защищает только УЖЕ существующую строку заказа — для
--   нового стола (заказа ещё нет) блокировать нечего, и два гостя оба
--   увидят "заказа нет" и оба создадут свой (проверено гонкой на 8
--   параллельных устройствах: получили 2 заказа и совпадение по месту).
--   Поэтому дополнительно берём pg_advisory_xact_lock по table_id —
--   сериализует весь участок ниже для конкретного стола целиком.
--
-- Общий комментарий (p_comment, orders.comment):
--   заказ теперь общий на весь стол, поэтому комментарий не перезаписывает,
--   а дописывается с пометкой места — иначе второй гость стирал бы
--   комментарий первого.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260701020000_place_guest_order.sql
-- ============================================================

BEGIN;

-- 1. device_id на order_guests: одно устройство = одно место в заказе.
--    NULL остаётся для мест, которые завёл официант вручную (без телефона) —
--    обычный UNIQUE не конфликтует на NULL, так что это безопасно.
ALTER TABLE public.order_guests
  ADD COLUMN IF NOT EXISTS device_id text;

ALTER TABLE public.order_guests
  ADD CONSTRAINT order_guests_order_device_unique UNIQUE (order_id, device_id);

-- 2. Сама функция
CREATE OR REPLACE FUNCTION public.place_guest_order(
  p_restaurant_id uuid,
  p_table_number text,
  p_device_id text,
  p_items jsonb,  -- [{"item_id": "...", "quantity": 2, "comment": "без лука"}, ...]
  p_comment text DEFAULT NULL  -- общий комментарий к заказу (не к позиции)
)
RETURNS TABLE (order_id uuid, seat_number integer, total_amount integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_id     uuid;
  v_order_id     uuid;
  v_seat_number  integer;
  v_item         jsonb;
  v_unit_price   numeric;
  v_total        integer;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Пустой список блюд';
  END IF;

  -- Защита от клиентского бага, который уже встречался: String(null) в JS
  -- даёт текст "null", а не пустую строку/NULL — без этой проверки cast
  -- ниже в integer падает с сырой, непонятной ошибкой Postgres (22P02).
  IF p_table_number IS NULL OR btrim(p_table_number) = '' OR p_table_number = 'null' THEN
    RAISE EXCEPTION 'Не удалось определить номер стола';
  END IF;

  -- Стол этого ресторана
  SELECT id INTO v_table_id
  FROM public.tables
  WHERE restaurant_id = p_restaurant_id
    AND number = p_table_number::integer
    AND is_active = true;

  IF v_table_id IS NULL THEN
    RAISE EXCEPTION 'Стол % не найден для этого ресторана', p_table_number;
  END IF;

  -- Блокируем стол на время транзакции: FOR UPDATE ниже защищает только
  -- УЖЕ существующую строку заказа, а для НОВОГО стола (заказа ещё нет)
  -- блокировать нечего — два гостя одновременно оба увидят "заказа нет"
  -- и оба создадут свой (проверено гонкой на 8 параллельных устройствах).
  -- Advisory lock на table_id сериализует весь участок ниже для этого
  -- стола целиком, снимается сам в конце транзакции.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_table_id::text, 0));

  -- Открываем сессию стола, если не открыта; в любом случае — "preparing"
  INSERT INTO public.table_sessions (table_id, restaurant_id, status, is_active, started_at)
  SELECT v_table_id, p_restaurant_id, 'preparing', true, now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.table_sessions WHERE table_id = v_table_id AND is_active = true
  );

  UPDATE public.table_sessions
  SET status = 'preparing'
  WHERE table_id = v_table_id AND is_active = true;

  -- Активный заказ этого стола. FOR UPDATE — чтобы одновременные заказы
  -- за одним столом не гонялись за одним и тем же номером места.
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

  -- Место для этого устройства: существующее либо следующее свободное
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

  -- Общий комментарий к этой отправке (orders.comment). Заказ теперь общий
  -- на весь стол, поэтому не перезаписываем чужую пометку, а дописываем
  -- с указанием места — иначе комментарий второго гостя стирал бы первого.
  IF p_comment IS NOT NULL AND btrim(p_comment) <> '' THEN
    UPDATE public.orders
    SET comment = CASE
      WHEN comment IS NULL OR btrim(comment) = '' THEN format('Место %s: %s', v_seat_number, btrim(p_comment))
      ELSE comment || E'\n' || format('Место %s: %s', v_seat_number, btrim(p_comment))
    END
    WHERE id = v_order_id;
  END IF;

  -- Позиции — цена ТОЛЬКО из menu_items, клиентской цене не доверяем.
  -- Сразу "sent" (на кухню) — по решению: без подтверждения официантом.
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
    );
  END LOOP;

  -- total_amount — из реальных order_items, не из присланной суммы
  SELECT COALESCE(SUM(oi.unit_price * oi.quantity), 0)::integer INTO v_total
  FROM public.order_items oi
  WHERE oi.order_id = v_order_id;

  UPDATE public.orders SET total_amount = v_total WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_seat_number, v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_guest_order(uuid, text, text, jsonb, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
