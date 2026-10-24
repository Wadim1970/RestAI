-- ============================================================
-- Официанты и рестораны: кто где работает и работал.
--
--  1. Очистка: остаются только «Сыроварня» и «Гастро Паб» (aabbccdd…);
--     остальные рестораны и всё, что на них ссылается, удаляются.
--  2. restaurant_staff — постоянные сотрудники ресторана и история
--     (уволили → dismissal_date, строка остаётся). Один человек не может
--     быть в двух ресторанах одновременно (частичный уникальный индекс).
--  3. Фрилансер ресторанов не «имеет»: его рестораны видны по staff_shifts
--     (смены по вакансии, job_id). Постоянный сотрудник может подрабатывать
--     фрилансером в ДРУГИХ ресторанах, но не в своём.
--  4. Защита связей (триггеры):
--       • bookings — нельзя откликнуться на вакансию своего ресторана и
--         нельзя подтвердить две пересекающиеся по времени брони;
--       • waiter_table_assignments — официант закрепляется только за столом
--         ресторана, с которым у него есть связь (штат, смена или бронь).
--  5. Представление waiter_restaurants — «где работает/работал человек»
--     одним запросом (штат + смены фрилансера).
--  6. waiters.employment_type больше не обязателен: тип выводится из связей.
--     Сами старые колонки (employment_type, restaurant_id, role, hire_date,
--     dismissal_date) удаляет СЛЕДУЮЩАЯ миграция — после выкладки приложений.
--
-- ВНИМАНИЕ: шаг 1 удаляет данные без возврата. Перед запуском — бэкап:
--   sudo docker exec supabase-db pg_dump -U supabase_admin -d postgres -Fc > backup.dump
-- Запускать на сервере базы из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261024020000_restaurant_staff.sql
-- В выводе будут строки NOTICE с числом удалённых записей. Чтобы только
-- посмотреть, замените в конце файла COMMIT на ROLLBACK.
-- Откат структуры: 20261024020000_restaurant_staff_rollback.sql
-- (удалённые данные он не вернёт).
-- ============================================================

BEGIN;

-- ── 1. Очистка ──
DO $$
DECLARE
  keep   text[] := ARRAY['dd89773c-0952-4fd1-9510-514094a928ee', 'aabbccdd-1111-2222-3333-444455556666'];
  t      text;
  n      bigint;
BEGIN
  -- Защита от запуска не в той базе: оба оставляемых ресторана обязаны быть.
  IF (SELECT count(*) FROM public.restaurants WHERE "restaurantId"::text = ANY (keep)) <> 2 THEN
    RAISE EXCEPTION 'Нет одного из оставляемых ресторанов — очистка отменена';
  END IF;

  -- Заказы: restaurant_id — text без внешнего ключа (есть пустой и несуществующие).
  -- Строки order_items / order_guests / order_item_modifiers уйдут каскадом.
  DELETE FROM public.orders WHERE restaurant_id <> ALL (keep);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'orders удалено: %', n;

  -- Остальные таблицы, где ресторан хранится без внешнего ключа на restaurants.
  FOREACH t IN ARRAY ARRAY[
    'reviews', 'conversation_turns', 'guest_restaurant_stats', 'restaurant_ai_profiles',
    'ai_suggestion_events', 'dish_daily_flags', 'guest_cart_drafts', 'menu_item_costing',
    'menu_pairing_state', 'menu_pairings', 'table_reservations', 'waiter_ai_suggestions'
  ] LOOP
    EXECUTE format('DELETE FROM public.%I WHERE restaurant_id::text <> ALL ($1)', t) USING keep;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '% удалено: %', t, n;
  END LOOP;

  -- Сами рестораны. Столы, меню, вакансии, смены, посадки и т. п. уходят
  -- каскадом по внешним ключам.
  DELETE FROM public.restaurants WHERE "restaurantId"::text <> ALL (keep);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'restaurants удалено: %', n;
END $$;

-- ── 2. Тип официанта выводится из связей, колонка больше не обязательна ──
ALTER TABLE public.waiters ALTER COLUMN employment_type DROP NOT NULL;

-- ── 3. restaurant_staff ──
CREATE TABLE public.restaurant_staff (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waiter_id      uuid NOT NULL REFERENCES public.waiters(id) ON DELETE CASCADE,
  restaurant_id  uuid NOT NULL REFERENCES public.restaurants("restaurantId") ON DELETE CASCADE,
  role           text NOT NULL DEFAULT 'waiter'
                   CHECK (role IN ('waiter', 'senior_waiter', 'manager')),
  hire_date      date NOT NULL DEFAULT current_date,
  dismissal_date date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (dismissal_date IS NULL OR dismissal_date >= hire_date)
);

COMMENT ON TABLE public.restaurant_staff IS
  'Постоянные сотрудники ресторана и история. Активная запись — dismissal_date IS NULL. Фрилансеры сюда не попадают: их рестораны видны по staff_shifts.';

-- Не больше одной активной работы на человека.
CREATE UNIQUE INDEX restaurant_staff_one_active_idx
  ON public.restaurant_staff (waiter_id) WHERE dismissal_date IS NULL;
CREATE INDEX restaurant_staff_restaurant_idx
  ON public.restaurant_staff (restaurant_id, waiter_id);

ALTER TABLE public.restaurant_staff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restaurant_staff FROM anon, authenticated;
GRANT SELECT ON public.restaurant_staff TO authenticated;
CREATE POLICY restaurant_staff_select_own ON public.restaurant_staff
  FOR SELECT TO authenticated
  USING (waiter_id = public.current_waiter_id());

-- Перенос того, что уже лежит в waiters (сейчас там ни у кого нет ресторана).
INSERT INTO public.restaurant_staff (waiter_id, restaurant_id, role, hire_date, dismissal_date)
SELECT w.id, w.restaurant_id, COALESCE(w.role, 'waiter'), COALESCE(w.hire_date, current_date), w.dismissal_date
FROM public.waiters w
WHERE w.restaurant_id IS NOT NULL;

-- ── 4. Защита связей ──

-- 4.1 Брони: не на свой ресторан, без пересечений по времени.
CREATE OR REPLACE FUNCTION public.fn_booking_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  j      record;
  v_from timestamp;
  v_to   timestamp;
BEGIN
  IF NEW.job_id IS NULL OR NEW.status NOT IN ('applied', 'approved', 'confirmed') THEN
    RETURN NEW;
  END IF;
  -- Служебные обновления (seen_at и т. п.) не проверяем.
  IF TG_OP = 'UPDATE'
     AND (OLD.status, OLD.job_id, OLD.worker_id) IS NOT DISTINCT FROM (NEW.status, NEW.job_id, NEW.worker_id) THEN
    RETURN NEW;
  END IF;

  SELECT restaurant_id, shift_date, start_time, end_time INTO j FROM public.jobs WHERE id = NEW.job_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.restaurant_staff s
    WHERE s.waiter_id = NEW.worker_id AND s.restaurant_id = j.restaurant_id AND s.dismissal_date IS NULL
  ) THEN
    RAISE EXCEPTION 'Сотрудник ресторана не может брать смены фрилансера в своём ресторане'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IN ('approved', 'confirmed') THEN
    v_from := j.shift_date + j.start_time;
    v_to   := CASE WHEN j.end_time <= j.start_time THEN j.shift_date + j.end_time + interval '1 day'
                   ELSE j.shift_date + j.end_time END;
    IF EXISTS (
      SELECT 1
      FROM public.bookings b
      JOIN public.jobs o ON o.id = b.job_id
      WHERE b.worker_id = NEW.worker_id
        AND b.id <> NEW.id
        AND b.status IN ('approved', 'confirmed')
        AND tsrange(
              o.shift_date + o.start_time,
              CASE WHEN o.end_time <= o.start_time THEN o.shift_date + o.end_time + interval '1 day'
                   ELSE o.shift_date + o.end_time END
            ) && tsrange(v_from, v_to)
    ) THEN
      RAISE EXCEPTION 'У официанта уже есть подтверждённая смена в это время'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_booking_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_booking_guard ON public.bookings;
CREATE TRIGGER trg_booking_guard
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.fn_booking_guard();

-- 4.2 Закрепление за столом: только у ресторана, с которым есть связь.
CREATE OR REPLACE FUNCTION public.fn_assignment_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  r uuid;
BEGIN
  SELECT restaurant_id INTO r FROM public.tables WHERE id = NEW.table_id;
  IF r IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.restaurant_staff s
              WHERE s.waiter_id = NEW.waiter_id AND s.restaurant_id = r AND s.dismissal_date IS NULL)
     OR EXISTS (SELECT 1 FROM public.staff_shifts sh
                 WHERE sh.waiter_id = NEW.waiter_id AND sh.restaurant_id = r)
     OR EXISTS (SELECT 1 FROM public.bookings b JOIN public.jobs j ON j.id = b.job_id
                 WHERE b.worker_id = NEW.waiter_id AND j.restaurant_id = r
                   AND b.status IN ('approved', 'confirmed'))
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Официант не связан с рестораном этого стола (нет ни штатной записи, ни смены, ни брони)'
    USING ERRCODE = 'check_violation';
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_assignment_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_assignment_guard ON public.waiter_table_assignments;
CREATE TRIGGER trg_assignment_guard
  BEFORE INSERT OR UPDATE OF waiter_id, table_id ON public.waiter_table_assignments
  FOR EACH ROW EXECUTE FUNCTION public.fn_assignment_guard();

-- ── 5. Где работает / работал человек ──
-- security_invoker: каждый видит только то, что разрешено ему политиками RLS
-- (официант — свои строки; серверные функции с service_role — всё).
CREATE VIEW public.waiter_restaurants WITH (security_invoker = true) AS
SELECT s.waiter_id,
       s.restaurant_id,
       'staff'::text      AS relation,
       s.role,
       s.hire_date        AS first_date,
       s.dismissal_date   AS last_date,
       NULL::bigint       AS shifts
FROM public.restaurant_staff s
UNION ALL
SELECT sh.waiter_id,
       sh.restaurant_id,
       'freelance'::text  AS relation,
       NULL::text         AS role,
       min(sh.shift_date) AS first_date,
       max(sh.shift_date) AS last_date,
       count(*)           AS shifts
FROM public.staff_shifts sh
WHERE sh.job_id IS NOT NULL
GROUP BY sh.waiter_id, sh.restaurant_id;

REVOKE ALL ON public.waiter_restaurants FROM anon, authenticated;
GRANT SELECT ON public.waiter_restaurants TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
