-- ============================================================
-- ДЕМО: гости с историей для раздела «Брони» админки.
--
-- НЕ миграция — заполняет ОДИН ресторан (по умолчанию демо-ресторан)
-- готовыми гостями, чтобы рестораторы видели, как работает карточка гостя:
--   • Мария Соколова — постоянная гостья приложения, 14 визитов, любимый
--     стол, день рождения через 3 дня, не ест кинзу; бронь сегодня в 19:00;
--   • Алексей Воронов — приходит большой компанией, высокий чек; бронь сегодня;
--   • Екатерина Лебедева — была 3 раза, бронь завтра;
--   • Дмитрий Орлов — был 1 раз, бронь в свой день рождения;
--   • Ирина Белова — НЕ в приложении: дважды пришла по брони, раз не пришла;
--   • Сергей Ким — НЕ в приложении: не пришёл и отменял — отметка ⚠;
--   • Новый гость — бронь без истории.
-- Плюс их визиты (посадки, заказы по местам, отзывы) за последние 4 месяца.
-- Визиты попадут и в «Статистику», «Официантов», «Зал» этого ресторана.
--
-- Повторный запуск безопасен: сначала удаляет прежние демо-данные
-- (метка — устройства 'restai-demo-%' и телефоны +7 999 000-00-0X),
-- и брони строятся от сегодняшнего дня заново.
-- Убрать демо-данные: demo_guests_cleanup.sql.
--
-- Запуск на сервере базы:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < /tmp/demo_guests.sql
-- Другой ресторан: добавьте  -v rid=<uuid ресторана>
-- ============================================================

\if :{?rid}
\else
  \set rid 'dd89773c-0952-4fd1-9510-514094a928ee'
\endif
SELECT set_config('demo.rid', :'rid', false);

BEGIN;

-- ---------- 1. Убрать прежние демо-данные ----------
CREATE TEMP TABLE _demo_orders ON COMMIT DROP AS
  SELECT DISTINCT og.order_id AS id FROM public.order_guests og WHERE og.device_id LIKE 'restai-demo-%';
CREATE TEMP TABLE _demo_sessions ON COMMIT DROP AS
  SELECT DISTINCT o.table_session_id AS id FROM public.orders o
  WHERE o.id IN (SELECT id FROM _demo_orders) AND o.table_session_id IS NOT NULL;
CREATE TEMP TABLE _demo_guests ON COMMIT DROP AS
  SELECT g.id FROM public.guests g WHERE g.device_id LIKE 'restai-demo-%';

DELETE FROM public.reviews WHERE session_id IN (SELECT id FROM _demo_sessions);
DELETE FROM public.order_item_modifiers WHERE order_item_id IN (SELECT id FROM public.order_items WHERE order_id IN (SELECT id FROM _demo_orders));
DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM _demo_orders);
DELETE FROM public.order_guests WHERE order_id IN (SELECT id FROM _demo_orders);
DELETE FROM public.orders WHERE id IN (SELECT id FROM _demo_orders);
DELETE FROM public.table_sessions WHERE id IN (SELECT id FROM _demo_sessions);
DELETE FROM public.guest_restaurant_stats WHERE guest_id IN (SELECT id FROM _demo_guests);
DELETE FROM public.guest_devices WHERE guest_id IN (SELECT id FROM _demo_guests) OR device_id LIKE 'restai-demo-%';
DELETE FROM public.guests WHERE id IN (SELECT id FROM _demo_guests);
DELETE FROM public.table_reservations WHERE guest_phone LIKE '+799900000__';

-- ---------- 2. Помощник: один визит гостя ----------
-- Посадка (закрыта) + оплаченный заказ: место 1 — сам гость (его устройство),
-- места 2… — его компания. Возвращает id посадки.
CREATE OR REPLACE FUNCTION pg_temp.demo_visit(
  p_rid uuid, p_tz text, p_table uuid, p_day date, p_time time, p_minutes int,
  p_guests int, p_device text, p_mine uuid[], p_company uuid[]
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_start timestamptz := (p_day + p_time) AT TIME ZONE p_tz;
  v_session uuid;
  v_order uuid;
  v_number text;
  v_total numeric := 0;
  v_dish uuid;
  v_price numeric;
  v_cook int;
  v_seat int;
  i int := 0;
BEGIN
  SELECT t.number::text INTO v_number FROM public.tables t WHERE t.id = p_table;

  INSERT INTO public.table_sessions (table_id, restaurant_id, status, is_active, started_at, ended_at, guest_count)
  VALUES (p_table, p_rid, 'free', false, v_start, v_start + make_interval(mins => p_minutes), p_guests)
  RETURNING id INTO v_session;

  INSERT INTO public.orders (table_id, table_number, restaurant_id, status, total_amount, items, table_session_id, created_at)
  VALUES (p_table, v_number, p_rid, 'paid', 0, '[]'::jsonb, v_session, v_start + interval '6 minutes')
  RETURNING id INTO v_order;

  INSERT INTO public.order_guests (order_id, seat_number, device_id, status)
  VALUES (v_order, 1, p_device, 'paid');

  FOREACH v_dish IN ARRAY p_mine || p_company LOOP
    i := i + 1;
    v_seat := CASE WHEN i <= coalesce(array_length(p_mine, 1), 0) THEN 1
                   ELSE 2 + ((i - coalesce(array_length(p_mine, 1), 0) - 1) % greatest(p_guests - 1, 1)) END;
    SELECT coalesce(m.cost_rub, 0), coalesce(m.cook_time_min, 15) INTO v_price, v_cook FROM public.menu_items m WHERE m.id = v_dish;
    INSERT INTO public.order_items (order_id, item_id, seat_number, quantity, unit_price, status, sent_at, ready_at)
    VALUES (v_order, v_dish, v_seat, 1, v_price, 'ready',
            v_start + interval '10 minutes',
            v_start + interval '10 minutes' + make_interval(mins => v_cook + (i % 4) - 1));
    v_total := v_total + v_price;
  END LOOP;

  UPDATE public.orders SET total_amount = v_total WHERE id = v_order;
  RETURN v_session;
END;
$$;

-- ---------- 3. Гости, визиты, отзывы, брони ----------
DO $demo$
DECLARE
  v_rid uuid := current_setting('demo.rid')::uuid;
  v_tz text;
  v_today date;
  t uuid[];        -- столы ресторана по номерам
  t_big uuid;      -- самый большой стол
  m uuid[];        -- блюда меню (по одному на название)
  n_t int;
  n_m int;
  g_maria bigint; g_alex bigint; g_kate bigint; g_dima bigint;
  s uuid;
  k int;
  d date;
  pick uuid[];
BEGIN
  SELECT coalesce(nullif(r.timezone, ''), 'Europe/Moscow') INTO v_tz FROM public.restaurants r WHERE r.id = v_rid;
  IF v_tz IS NULL THEN RAISE EXCEPTION 'Ресторан % не найден', v_rid; END IF;
  -- День ресторана начинается в 06:00.
  v_today := ((now() AT TIME ZONE v_tz) - interval '6 hours')::date;

  SELECT array_agg(id ORDER BY number) INTO t FROM public.tables WHERE restaurant_id = v_rid AND is_active;
  n_t := coalesce(array_length(t, 1), 0);
  IF n_t < 3 THEN RAISE EXCEPTION 'В ресторане нужно хотя бы 3 стола (сейчас %)', n_t; END IF;
  SELECT id INTO t_big FROM public.tables WHERE restaurant_id = v_rid AND is_active ORDER BY capacity DESC NULLS LAST, number LIMIT 1;

  SELECT array_agg(id ORDER BY ord) INTO m FROM (
    SELECT DISTINCT ON (lower(trim(dish_name))) id, md5(id::text) AS ord
    FROM public.menu_items
    WHERE restaurant_id = v_rid AND coalesce(is_hidden, false) = false AND coalesce(cost_rub, 0) > 0
    ORDER BY lower(trim(dish_name)), coalesce(section_order, 0) DESC
  ) x;
  n_m := coalesce(array_length(m, 1), 0);
  IF n_m < 6 THEN RAISE EXCEPTION 'В меню ресторана нужно хотя бы 6 блюд (сейчас %)', n_m; END IF;

  -- Гости приложения (телефон «подтверждён», как после SMS в личном кабинете).
  INSERT INTO public.guests (device_id, name, phone, points, birthday_day, birthday_month, dislikes, visit_count, created_at, last_visit_at)
  VALUES ('restai-demo-maria', 'Мария Соколова', '+79990000001', 340,
          extract(day FROM v_today + 3)::smallint, extract(month FROM v_today + 3)::smallint, 'кинза, острое', 14, now() - interval '130 days', now() - interval '4 days')
  RETURNING id INTO g_maria;
  INSERT INTO public.guests (device_id, name, phone, points, visit_count, created_at, last_visit_at)
  VALUES ('restai-demo-alex', 'Алексей Воронов', '+79990000002', 120, 7, now() - interval '100 days', now() - interval '9 days')
  RETURNING id INTO g_alex;
  INSERT INTO public.guests (device_id, name, phone, points, dislikes, visit_count, created_at, last_visit_at)
  VALUES ('restai-demo-kate', 'Екатерина Лебедева', '+79990000003', 60, 'не ест мясо', 3, now() - interval '40 days', now() - interval '12 days')
  RETURNING id INTO g_kate;
  INSERT INTO public.guests (device_id, name, phone, points, birthday_day, birthday_month, visit_count, created_at, last_visit_at)
  VALUES ('restai-demo-dima', 'Дмитрий Орлов', '+79990000004', 20,
          extract(day FROM v_today + 4)::smallint, extract(month FROM v_today + 4)::smallint, 1, now() - interval '20 days', now() - interval '20 days')
  RETURNING id INTO g_dima;
  INSERT INTO public.guest_devices (device_id, guest_id) VALUES
    ('restai-demo-maria', g_maria), ('restai-demo-alex', g_alex), ('restai-demo-kate', g_kate), ('restai-demo-dima', g_dima);

  -- Мария: 14 визитов за 4 месяца, обычно за столом № первый, вдвоём;
  -- любимые блюда — первые три из меню, иногда что-то новое.
  FOR k IN 1..14 LOOP
    d := v_today - (k * 9 - 5);
    pick := ARRAY[m[1], m[1 + (k % 2) + 1]];
    IF k % 3 = 0 THEN pick := pick || m[4 + (k % (n_m - 4))]; END IF;
    s := pg_temp.demo_visit(v_rid, v_tz, CASE WHEN k % 5 = 0 THEN t[2] ELSE t[1] END, d, time '19:00' + make_interval(mins => (k % 3) * 15), 100, 2,
                            'restai-demo-maria', pick, ARRAY[m[5], m[6]]);
    IF k IN (1, 4, 9) THEN
      INSERT INTO public.reviews (restaurant_id, table_number, rating_food, rating_service, comment, session_id, created_at)
      SELECT v_rid, tb.number::text, 5, 5, CASE k WHEN 1 THEN 'Как всегда отлично, спасибо официанту!' WHEN 4 THEN 'Любимое место' ELSE NULL END, s,
             (d + time '21:00') AT TIME ZONE v_tz
      FROM public.table_sessions ts JOIN public.tables tb ON tb.id = ts.table_id WHERE ts.id = s;
    END IF;
    -- Часть визитов — по брони.
    IF k IN (2, 5, 8, 11) THEN
      INSERT INTO public.table_reservations (restaurant_id, table_id, starts_at, ends_at, guest_count, guest_name, guest_phone, status, source)
      VALUES (v_rid, t[1], (d + time '19:00') AT TIME ZONE v_tz, (d + time '21:00') AT TIME ZONE v_tz, 2, 'Мария', '+79990000001', 'seated', 'admin');
    END IF;
  END LOOP;

  -- Алексей: 7 визитов большой компанией за самым большим столом, высокий чек.
  FOR k IN 1..7 LOOP
    d := v_today - (k * 13 - 4);
    s := pg_temp.demo_visit(v_rid, v_tz, t_big, d, time '20:00', 150, 5,
                            'restai-demo-alex', ARRAY[m[2], m[7 % n_m + 1], m[3]],
                            ARRAY[m[2], m[3], m[5], m[6], m[1 + (k % n_m)], m[1 + ((k + 3) % n_m)], m[4]]);
    IF k = 3 THEN
      INSERT INTO public.reviews (restaurant_id, table_number, rating_food, rating_service, comment, session_id, created_at)
      SELECT v_rid, tb.number::text, 4, 3, 'Долго ждали горячее', s, (d + time '22:40') AT TIME ZONE v_tz
      FROM public.table_sessions ts JOIN public.tables tb ON tb.id = ts.table_id WHERE ts.id = s;
    END IF;
  END LOOP;

  -- Екатерина: 3 визита, обед.
  FOR k IN 1..3 LOOP
    d := v_today - (k * 10 + 2);
    PERFORM pg_temp.demo_visit(v_rid, v_tz, t[3], d, time '13:30', 60, 1, 'restai-demo-kate', ARRAY[m[3], m[6]], ARRAY[]::uuid[]);
  END LOOP;

  -- Дмитрий: один визит.
  PERFORM pg_temp.demo_visit(v_rid, v_tz, t[2], v_today - 20, time '18:30', 90, 2, 'restai-demo-dima', ARRAY[m[4]], ARRAY[m[2]]);

  -- Ирина (не в приложении): дважды пришла по брони — посадка за тем же
  -- столом в то же время; раз не пришла.
  FOR k IN 1..2 LOOP
    d := v_today - (k * 15);
    INSERT INTO public.table_reservations (restaurant_id, table_id, starts_at, ends_at, guest_count, guest_name, guest_phone, status, source)
    VALUES (v_rid, t[3], (d + time '19:30') AT TIME ZONE v_tz, (d + time '21:30') AT TIME ZONE v_tz, 3, 'Ирина', '+79990000005', 'seated', 'admin');
    PERFORM pg_temp.demo_visit(v_rid, v_tz, t[3], d, time '19:35', 110, 3, 'restai-demo-irina', ARRAY[]::uuid[], ARRAY[m[1], m[5], m[6], m[2]]);
  END LOOP;
  INSERT INTO public.table_reservations (restaurant_id, table_id, starts_at, ends_at, guest_count, guest_name, guest_phone, status, source)
  VALUES (v_rid, t[3], ((v_today - 40) + time '19:00') AT TIME ZONE v_tz, ((v_today - 40) + time '21:00') AT TIME ZONE v_tz, 2, 'Ирина', '+79990000005', 'no_show', 'admin');

  -- Сергей (не в приложении): не пришёл и отменял.
  INSERT INTO public.table_reservations (restaurant_id, table_id, starts_at, ends_at, guest_count, guest_name, guest_phone, status, source) VALUES
    (v_rid, t[2], ((v_today - 8) + time '20:00') AT TIME ZONE v_tz, ((v_today - 8) + time '22:00') AT TIME ZONE v_tz, 4, 'Сергей', '+79990000006', 'no_show', 'admin'),
    (v_rid, t[2], ((v_today - 25) + time '20:00') AT TIME ZONE v_tz, ((v_today - 25) + time '22:00') AT TIME ZONE v_tz, 4, 'Сергей', '+79990000006', 'cancelled', 'admin');

  -- Ближайшие брони — от сегодняшнего дня.
  INSERT INTO public.table_reservations (restaurant_id, table_id, starts_at, ends_at, guest_count, guest_name, guest_phone, comment, status, source) VALUES
    (v_rid, t[1], (v_today + time '19:00') AT TIME ZONE v_tz, (v_today + time '21:00') AT TIME ZONE v_tz, 2, 'Мария', '+79990000001', 'Как обычно, у окна', 'confirmed', 'admin'),
    (v_rid, t_big, (v_today + time '20:00') AT TIME ZONE v_tz, (v_today + time '23:00') AT TIME ZONE v_tz, 6, 'Алексей', '+79990000002', 'Деловой ужин', 'confirmed', 'admin'),
    (v_rid, t[3], (v_today + time '19:30') AT TIME ZONE v_tz, (v_today + time '21:30') AT TIME ZONE v_tz, 3, 'Ирина', '+79990000005', NULL, 'confirmed', 'admin'),
    (v_rid, t[3], ((v_today + 1) + time '13:30') AT TIME ZONE v_tz, ((v_today + 1) + time '15:00') AT TIME ZONE v_tz, 2, 'Екатерина', '+79990000003', 'Вегетарианское меню', 'confirmed', 'admin'),
    (v_rid, t[2], ((v_today + 2) + time '20:00') AT TIME ZONE v_tz, ((v_today + 2) + time '22:00') AT TIME ZONE v_tz, 4, 'Сергей', '+79990000006', NULL, 'confirmed', 'admin'),
    (v_rid, t_big, ((v_today + 4) + time '19:00') AT TIME ZONE v_tz, ((v_today + 4) + time '22:00') AT TIME ZONE v_tz, 5, 'Дмитрий', '+79990000004', 'День рождения, принесут торт', 'confirmed', 'admin'),
    (v_rid, t[1], ((v_today + 10) + time '19:00') AT TIME ZONE v_tz, ((v_today + 10) + time '21:00') AT TIME ZONE v_tz, 2, 'Мария', '+79990000001', NULL, 'confirmed', 'admin'),
    (v_rid, t[least(4, n_t)], ((v_today + 14) + time '18:00') AT TIME ZONE v_tz, ((v_today + 14) + time '20:00') AT TIME ZONE v_tz, 2, 'Новый гость', '+79990000007', NULL, 'confirmed', 'admin');

  -- Статистика гостей по ресторану (вкусы, любимые блюда) — как после оплаты.
  BEGIN
    PERFORM public.update_guest_restaurant_stats(g, v_rid) FROM unnest(ARRAY[g_maria, g_alex, g_kate, g_dima]) AS g;
  EXCEPTION WHEN undefined_function OR undefined_column OR datatype_mismatch THEN
    RAISE NOTICE 'Статистика гостей не пересчитана (%), карточки всё равно заполнятся', SQLERRM;
  END;

  RAISE NOTICE 'Готово: ресторан %, гостей приложения 4, броней от % до %', v_rid, v_today, v_today + 14;
END
$demo$;

COMMIT;

-- Итог.
SELECT g.name AS гость, g.phone AS телефон,
       (SELECT count(DISTINCT o.table_session_id) FROM public.order_guests og JOIN public.orders o ON o.id = og.order_id
         WHERE og.device_id = g.device_id) AS визитов
FROM public.guests g WHERE g.device_id LIKE 'restai-demo-%' ORDER BY g.id;
SELECT guest_name AS бронь, to_char(starts_at AT TIME ZONE 'Europe/Moscow', 'DD.MM HH24:MI') AS когда_мск, status
FROM public.table_reservations WHERE guest_phone LIKE '+799900000__' AND status = 'confirmed' ORDER BY starts_at;
