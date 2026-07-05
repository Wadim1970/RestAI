-- ============================================================
-- Безопасный приём отзыва гостя (таблица reviews).
--
-- Проблемы, которые чиним:
--   1. Триггер fn_calculate_restaurant_ratings() пересчитывает рейтинги и
--      сравнивает restaurants."restaurantId" (uuid) с restaurant_id (text)
--      -> "42883 operator does not exist: uuid = text". Из-за этого падала
--      ЛЮБАЯ вставка отзыва. Приводим обе стороны к text.
--   2. Отзыв мог вставить любой аноним с любым restaurant_id/оценками
--      (политика reviews_insert = with_check true), а триггер сразу гнал это
--      в публичный рейтинг ресторана -> накрутка/спам кем угодно.
--
-- Как делаем правильно:
--   - Приём отзыва только через RPC submit_review (SECURITY DEFINER): он
--     проверяет, что с ЭТОГО устройства реально был заказ за этим столом
--     (order_guests.device_id), и только тогда пишет отзыв.
--   - Прямую анонимную вставку в reviews закрываем (убираем INSERT-политики
--     для anon). Единственный путь — проверяющий RPC.
--   - Триггер оставляем SECURITY INVOKER, но т.к. вставка теперь идёт из
--     DEFINER-функции (владелец — supabase_admin), его UPDATE restaurants
--     выполняется в привилегированном контексте — анониму права на запись
--     в restaurants для этого больше не нужны (сузить их — отдельным шагом,
--     после проверки, что это не сломает register_guest_visit).
--
-- Тип guest_id НЕ меняем: приложение шлёт числовой id (или NULL), bigint
-- подходит; смену типа не делаем, чтобы не задеть другие приложения.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260704030000_secure_reviews.sql
-- ============================================================

BEGIN;

-- 1. Починка триггерной функции (uuid = text -> сравниваем как text).
--    SECURITY DEFINER НЕ добавляем — привилегии функции не повышаем.
CREATE OR REPLACE FUNCTION public.fn_calculate_restaurant_ratings()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF (TG_TABLE_NAME = 'staff_feedback') THEN
    UPDATE restaurants
    SET rating_staff = (
      SELECT COALESCE(AVG(rating_staff_overall), 0)
      FROM staff_feedback
      WHERE restaurant_id = COALESCE(NEW.restaurant_id, OLD.restaurant_id)
    )
    WHERE "restaurantId"::text = COALESCE(NEW.restaurant_id, OLD.restaurant_id)::text;

  ELSIF (TG_TABLE_NAME = 'reviews') THEN
    UPDATE restaurants
    SET
      rating_kitchen = (
        SELECT COALESCE(AVG(rating_food), 0)
        FROM reviews
        WHERE restaurant_id = COALESCE(NEW.restaurant_id, OLD.restaurant_id)
      ),
      rating_service = (
        SELECT COALESCE(AVG(rating_service), 0)
        FROM reviews
        WHERE restaurant_id = COALESCE(NEW.restaurant_id, OLD.restaurant_id)
      )
    WHERE "restaurantId"::text = COALESCE(NEW.restaurant_id, OLD.restaurant_id)::text;
  END IF;

  RETURN NULL;
END;
$function$;

-- 2. Проверяющий приём отзыва. Гость должен реально заказывать за этим столом
--    с этого устройства (иначе — отказ). Вставка идёт в обход RLS (DEFINER),
--    но по нашим правилам. SET search_path — защита DEFINER от подмены пути.
CREATE OR REPLACE FUNCTION public.submit_review(
  p_restaurant_id uuid,
  p_table_number text,
  p_device_id text,
  p_rating_food integer,
  p_rating_service integer,
  p_comment text,
  p_session_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_id uuid;
  v_ok boolean;
BEGIN
  IF p_table_number IS NULL OR btrim(p_table_number) = '' OR p_table_number = 'null' THEN
    RAISE EXCEPTION 'Не удалось определить номер стола';
  END IF;

  SELECT id INTO v_table_id
  FROM public.tables
  WHERE restaurant_id = p_restaurant_id
    AND number = p_table_number::integer
    AND is_active = true;

  IF v_table_id IS NULL THEN
    RAISE EXCEPTION 'Стол не найден';
  END IF;

  -- Право на отзыв: с этого устройства был заказ за этим столом.
  SELECT EXISTS (
    SELECT 1
    FROM public.order_guests og
    JOIN public.orders o ON o.id = og.order_id
    WHERE og.device_id = p_device_id
      AND o.table_id = v_table_id
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Отзыв можно оставить только после заказа за этим столом';
  END IF;

  INSERT INTO public.reviews (restaurant_id, table_number, rating_food, rating_service, comment, session_id)
  VALUES (
    p_restaurant_id::text,
    p_table_number,
    LEAST(GREATEST(COALESCE(p_rating_food, 0), 0), 5),
    LEAST(GREATEST(COALESCE(p_rating_service, 0), 0), 5),
    NULLIF(btrim(COALESCE(p_comment, '')), ''),
    p_session_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_review(uuid, text, text, integer, integer, text, text)
  TO anon, authenticated, service_role;

-- 3. Закрываем прямую анонимную вставку отзывов — только через submit_review.
--    (RLS на reviews включён; без INSERT-политики прямая вставка от anon
--    заблокирована, а DEFINER-функция от владельца её обходит по своим правилам.)
DROP POLICY IF EXISTS reviews_insert ON public.reviews;
DROP POLICY IF EXISTS reviews_insert_anon ON public.reviews;

NOTIFY pgrst, 'reload schema';

COMMIT;
