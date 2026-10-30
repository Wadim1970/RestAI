-- ============================================================
-- Залы ресторана со своими названиями, отзывы ресторана о фрилансерах,
-- график смен.
--
-- 1) restaurant_zones — залы ресторана (Основной зал, Веранда, ВИП…):
--    ключ (его хранит tables.zone), название, порядок. Раньше зал стола
--    мог быть только main / veranda / banquet — ограничение снимаем,
--    ключ теперь любой из залов ресторана. Для уже заведённых столов залы
--    создаются с прежними названиями.
-- 2) waiter_reviews — оценка (1–5) и отзыв ресторана о фрилансере после
--    смены (по отклику на заявку — booking). Официант видит свои отзывы в
--    приложении; пишет только сервер админки (service_role).
-- 3) staff_schedule — график: кто из официантов в какой день и с какого
--    по какое время работает. Пишет сервер админки; официант видит свой.
--
-- Запускать на сервере базы из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < /tmp/zones_staff.sql
-- Откат: 20261031010000_zones_staff_rollback.sql
-- ============================================================

BEGIN;

-- ── 1. Залы ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.restaurant_zones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  key           text NOT NULL CHECK (key ~ '^[a-z0-9_-]{1,40}$'),
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, key)
);

-- Ограничение «зал — только main / veranda / banquet» (имя у него может
-- быть любым — ищем по тексту).
DO $do$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.tables'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%zone%'
  LOOP
    EXECUTE format('ALTER TABLE public.tables DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $do$;

INSERT INTO public.restaurant_zones (restaurant_id, key, name, sort_order)
SELECT DISTINCT t.restaurant_id, coalesce(t.zone, 'main'),
       CASE coalesce(t.zone, 'main') WHEN 'main' THEN 'Основной зал' WHEN 'veranda' THEN 'Веранда'
            WHEN 'banquet' THEN 'Банкетный зал' ELSE coalesce(t.zone, 'main') END,
       CASE coalesce(t.zone, 'main') WHEN 'main' THEN 1 WHEN 'veranda' THEN 2 WHEN 'banquet' THEN 3 ELSE 9 END
FROM public.tables t
WHERE coalesce(t.zone, 'main') ~ '^[a-z0-9_-]{1,40}$'
ON CONFLICT (restaurant_id, key) DO NOTHING;

UPDATE public.tables SET zone = 'main' WHERE zone IS NULL;

ALTER TABLE public.restaurant_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS restaurant_zones_service ON public.restaurant_zones;
CREATE POLICY restaurant_zones_service ON public.restaurant_zones FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS restaurant_zones_select_waiter ON public.restaurant_zones;
CREATE POLICY restaurant_zones_select_waiter ON public.restaurant_zones FOR SELECT TO authenticated
  USING (public.waiter_can_access_restaurant(restaurant_id));
GRANT SELECT ON public.restaurant_zones TO authenticated;
GRANT ALL ON public.restaurant_zones TO service_role;

-- ── 2. Отзывы ресторана о фрилансерах ───────────────────────
CREATE TABLE IF NOT EXISTS public.waiter_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  waiter_id     uuid NOT NULL REFERENCES public.waiters(id) ON DELETE CASCADE,
  booking_id    uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  shift_date    date,
  rating        smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       text CHECK (comment IS NULL OR length(comment) <= 1000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Одна смена — один отзыв (правится, а не дублируется).
CREATE UNIQUE INDEX IF NOT EXISTS waiter_reviews_booking_uniq ON public.waiter_reviews (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS waiter_reviews_waiter_idx ON public.waiter_reviews (waiter_id, created_at DESC);

ALTER TABLE public.waiter_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS waiter_reviews_service ON public.waiter_reviews;
CREATE POLICY waiter_reviews_service ON public.waiter_reviews FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS waiter_reviews_select_own ON public.waiter_reviews;
CREATE POLICY waiter_reviews_select_own ON public.waiter_reviews FOR SELECT TO authenticated
  USING (waiter_id = public.current_waiter_id());
GRANT SELECT ON public.waiter_reviews TO authenticated;
GRANT ALL ON public.waiter_reviews TO service_role;

-- ── 3. График смен ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_schedule (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  waiter_id     uuid NOT NULL REFERENCES public.waiters(id) ON DELETE CASCADE,
  work_date     date NOT NULL,
  start_time    time NOT NULL,
  end_time      time NOT NULL,
  note          text CHECK (note IS NULL OR length(note) <= 200),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, waiter_id, work_date)
);
CREATE INDEX IF NOT EXISTS staff_schedule_day_idx ON public.staff_schedule (restaurant_id, work_date);

ALTER TABLE public.staff_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_schedule_service ON public.staff_schedule;
CREATE POLICY staff_schedule_service ON public.staff_schedule FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS staff_schedule_select_own ON public.staff_schedule;
CREATE POLICY staff_schedule_select_own ON public.staff_schedule FOR SELECT TO authenticated
  USING (waiter_id = public.current_waiter_id());
GRANT SELECT ON public.staff_schedule TO authenticated;
GRANT ALL ON public.staff_schedule TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
