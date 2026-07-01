-- ============================================================
-- Разделение счёта по гостям (RestAI).
--
-- ЗАЧЕМ:
--   Заказ на стол теперь общий на всех гостей (place_guest_order), но
--   гость не должен видеть чужие корзины просто листая меню — только
--   если сам явно выбрал "оплатить весь стол". После этого он видит
--   корзину каждого места за столом и сам выбирает, за кого платит
--   (например, семья/компания за одним столом платит раздельно).
--
--   get_table_bill — только ЧТЕНИЕ, вызывается ТОЛЬКО экраном разделения
--   счёта (после явного выбора гостя), не используется при обычном
--   заказе/просмотре меню.
--
--   pay_table_seats — отмечает выбранные места оплаченными. Место "оплачено"
--   значит order_guests.status = 'paid' — это уже существующая колонка и
--   конвенция значения, которую использует (но нигде не вызывает из своего
--   интерфейса) Waiter-app: server/../lib/orders.ts::markGuestPaid ставит
--   ровно status='paid' по (order_id, seat_number). Переиспользуем её,
--   а не заводим новую конвенцию.
--
--   Стол целиком (orders.status='paid') закрывается автоматически, когда
--   ОПЛАЧЕНЫ ВСЕ места этого заказа — до этого момента заказ остаётся
--   активным (new/cooking), даже если часть гостей уже заплатила.
--
-- Гонка при одновременной оплате разных мест:
--   в отличие от place_guest_order, тут заказ УЖЕ существует (создаём
--   исключение, если нет) — значит обычный FOR UPDATE на строку заказа
--   корректно сериализует конкурентные вызовы pay_table_seats без
--   advisory lock (там он был нужен именно из-за ещё-не-существующей
--   строки на новом столе, здесь этого случая нет).
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260701030000_table_bill_split.sql
-- ============================================================

BEGIN;

-- 1. Итемизированный счёт по месту для активного заказа стола.
--    Читает open orders/order_items/order_guests/menu_items — те же таблицы,
--    что уже открыты anon-ключу напрямую (RLS на них ещё не закрыт, это
--    отдельная задача); функция даёт фронту готовый плоский результат
--    вместо ручной сборки вложенных запросов на клиенте.
CREATE OR REPLACE FUNCTION public.get_table_bill(
  p_restaurant_id uuid,
  p_table_number text
)
RETURNS TABLE (
  seat_number integer,
  is_paid boolean,
  item_id uuid,
  dish_name text,
  quantity integer,
  unit_price numeric,
  line_total numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
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
  WHERE o.restaurant_id = p_restaurant_id::text
    AND o.table_number = p_table_number
    AND o.status IN ('new', 'cooking')
  ORDER BY oi.seat_number, oi.id;
$$;

GRANT EXECUTE ON FUNCTION public.get_table_bill(uuid, text) TO anon, authenticated, service_role;

-- 2. Отметить выбранные места оплаченными; закрыть стол целиком, если
--    оплачены уже все места этого заказа.
CREATE OR REPLACE FUNCTION public.pay_table_seats(
  p_restaurant_id uuid,
  p_table_number text,
  p_seat_numbers integer[]
)
-- Имя выходной колонки НЕ order_id: RETURNS TABLE делает его переменной
-- в теле функции, и INSERT ... ON CONFLICT (order_id, ...) ниже перестаёт
-- понимать, это колонка order_guests или эта переменная (поймано на
-- реальном запуске: "column reference order_id is ambiguous").
RETURNS TABLE (paid_order_id uuid, all_paid boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_all_paid boolean;
BEGIN
  IF p_seat_numbers IS NULL OR array_length(p_seat_numbers, 1) IS NULL THEN
    RAISE EXCEPTION 'Не выбрано ни одного места для оплаты';
  END IF;

  -- Заказ уже существует к этому моменту (иначе платить нечего) —
  -- FOR UPDATE тут корректно сериализует конкурентные вызовы этой функции.
  SELECT id INTO v_order_id
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

  -- UPSERT, а не UPDATE: официант может добавить позиции гостю до того,
  -- как для него появится строка order_guests (она сейчас заводится
  -- отдельно, при вводе описания гостя в Waiter-app) — если платить за
  -- такое место, строку нужно создать, а не молча обновить 0 строк.
  -- Ограничение "seat_number IN (... order_items ...)" — чтобы нельзя было
  -- завести строку под несуществующее место, если клиент пришлёт мусор.
  INSERT INTO public.order_guests (order_id, seat_number, status)
  SELECT v_order_id, s.seat_number, 'paid'
  FROM unnest(p_seat_numbers) AS s(seat_number)
  WHERE s.seat_number IN (
    SELECT DISTINCT oi.seat_number FROM public.order_items oi WHERE oi.order_id = v_order_id
  )
  ON CONFLICT (order_id, seat_number) DO UPDATE SET status = 'paid';

  -- "Оплачено всё" — когда КАЖДОЕ место, у которого реально есть позиции
  -- в заказе, отмечено paid. Не считаем по order_guests напрямую: для
  -- части мест строки может ещё не быть вовсе (см. комментарий выше), и
  -- такое место тогда просто выпало бы из проверки и заказ закрылся бы
  -- раньше времени.
  SELECT NOT EXISTS (
    SELECT 1
    FROM (SELECT DISTINCT seat_number FROM public.order_items WHERE order_id = v_order_id) roster
    LEFT JOIN public.order_guests og
      ON og.order_id = v_order_id AND og.seat_number = roster.seat_number
    WHERE COALESCE(og.status, '') <> 'paid'
  ) INTO v_all_paid;

  IF v_all_paid THEN
    UPDATE public.orders SET status = 'paid' WHERE id = v_order_id;
  END IF;

  RETURN QUERY SELECT v_order_id, v_all_paid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_table_seats(uuid, text, integer[]) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
