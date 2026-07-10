-- ============================================================
-- Статистика гостя ПО КОНКРЕТНОМУ ресторану — второй, узкий слой
-- поверх уже существующего глобального guests.preferences.
--
-- ЗАЧЕМ ОБА СЛОЯ:
--   guests.preferences — общий кросс-ресторанный портрет гостя (вся
--   платформа), нужен для широкой персонализации: тип кухни, средний
--   чек вообще, любимые блюда вообще. У guests НЕТ restaurant_id —
--   гость на платформе один, независимо от того, в скольких разных
--   ресторанах он бывал.
--
--   guest_restaurant_stats — то же самое, но отфильтровано по ОДНОМУ
--   ресторану: чтобы конкретный ресторан/его ИИ мог сказать "вы в
--   прошлый раз пробовали наш стейк, как он вам?", а не выдавать
--   рекомендации, замешанные на посещениях гостем других заведений с
--   другим меню и ценами.
--
--   Отдельная таблица, а не preferences->by_restaurant вложенным
--   JSON — растёт по числу РАЗНЫХ посещённых ресторанов (у любого
--   гостя это единицы), а не по числу визитов, и её удобно
--   индексировать/запрашивать точечно (по guest_id+restaurant_id),
--   не разбирая JSON-путь.
--
--   Пересчитывается в той же точке, что и глобальный профиль —
--   pay_table_seats() уже знает p_restaurant_id, добавляем второй
--   вызов рядом с уже существующим update_guest_preferences().
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260710020000_guest_restaurant_stats.sql
-- ============================================================

BEGIN;

-- orders.restaurant_id хранится как text (см. place_guest_order:
-- p_restaurant_id::text), а не uuid — здесь та же типизация, чтобы
-- JOIN'иться с orders напрямую без приведения типов.
CREATE TABLE IF NOT EXISTS public.guest_restaurant_stats (
  guest_id         bigint NOT NULL REFERENCES public.guests(id),
  restaurant_id    text   NOT NULL,
  tags             jsonb  NOT NULL DEFAULT '{}',
  top_dishes       jsonb  NOT NULL DEFAULT '[]',
  avg_check        numeric(10,2) NOT NULL DEFAULT 0,
  total_orders     integer NOT NULL DEFAULT 0,
  last_computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guest_id, restaurant_id)
);

ALTER TABLE public.guest_restaurant_stats ENABLE ROW LEVEL SECURITY;

-- Та же чувствительность данных, что и guests.preferences (уже открыт
-- на SELECT анониму) — читает гостевой ИИ-чат напрямую с клиента.
DROP POLICY IF EXISTS guest_restaurant_stats_select ON public.guest_restaurant_stats;
CREATE POLICY guest_restaurant_stats_select ON public.guest_restaurant_stats
  FOR SELECT TO anon, authenticated
  USING (true);

GRANT SELECT ON public.guest_restaurant_stats TO anon, authenticated;

-- ------------------------------------------------------------
-- Пересчёт статистики гостя В ОДНОМ ресторане — та же логика, что
-- update_guest_preferences, плюс фильтр по restaurant_id.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_guest_restaurant_stats(
  p_guest_id bigint,
  p_restaurant_id text
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    RETURN; -- нет оплаченных заказов в ЭТОМ ресторане — нечего сохранять
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
$$;

GRANT EXECUTE ON FUNCTION public.update_guest_restaurant_stats(bigint, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- pay_table_seats: тот же триггер-момент (v_all_paid), плюс вызов
-- пересчёта по ресторану рядом с уже существующим глобальным.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pay_table_seats(
  p_restaurant_id uuid,
  p_table_number text,
  p_seat_numbers integer[]
)
RETURNS TABLE (paid_order_id uuid, all_paid boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  WHERE restaurant_id = p_restaurant_id::text
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

    PERFORM public.update_guest_restaurant_stats(g.id, p_restaurant_id::text)
    FROM (SELECT DISTINCT device_id FROM public.order_guests WHERE order_id = v_order_id) og
    JOIN public.guests g ON g.device_id = og.device_id;
  END IF;

  RETURN QUERY SELECT v_order_id, v_all_paid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_table_seats(uuid, text, integer[]) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
