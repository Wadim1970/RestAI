-- ============================================================
-- Совет к корзине гостя и напоминание о десерте; время дня в советах.
--
-- 1) menu_items.course_role / meal_times — роль блюда (горячее, соус,
--    гарнир, суп, напиток…) и когда его уместно ПРЕДЛАГАТЬ (завтрак, обед,
--    ужин, поздний вечер). Пусто — сервер определяет сам по разделу и
--    названию; заполненное — ручная поправка, она важнее.
-- 2) waiter_calls.kind += 'dessert' — гость согласился, чтобы ему позже
--    предложили десерт: в нужный момент официант получает вызов (и пуш),
--    как обычный вызов с колокольчика.
-- 3) guest_dessert_reminders — согласие (или отказ) гостя на десерт и
--    судьба напоминания. Пишет и читает только сервер (service_role).
--
-- Запускать на сервере базы из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < /tmp/cart_advice.sql
-- Откат: 20261026010000_cart_advice_rollback.sql
-- ============================================================

BEGIN;

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS course_role text,
  ADD COLUMN IF NOT EXISTS meal_times  text[];

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_course_role_check' AND conrelid = 'public.menu_items'::regclass) THEN
    ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_course_role_check CHECK (
      course_role IS NULL OR course_role IN ('breakfast', 'soup', 'salad', 'starter', 'main', 'side', 'sauce', 'bread', 'soft', 'hot_drink', 'alco', 'dessert', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_meal_times_check' AND conrelid = 'public.menu_items'::regclass) THEN
    ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_meal_times_check CHECK (
      meal_times IS NULL OR meal_times <@ ARRAY['breakfast', 'lunch', 'dinner', 'late']::text[]);
  END IF;
END $do$;

ALTER TABLE public.waiter_calls DROP CONSTRAINT IF EXISTS waiter_calls_kind_check;
ALTER TABLE public.waiter_calls
  ADD CONSTRAINT waiter_calls_kind_check CHECK (kind IN ('service', 'age_check', 'dessert'));

CREATE TABLE IF NOT EXISTS public.guest_dessert_reminders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  device_id     text NOT NULL,
  table_id      uuid REFERENCES public.tables(id) ON DELETE SET NULL,
  table_number  text,
  seat_number   integer,
  meal          text,
  -- pending — ждём момента; called — официант вызван; declined — гость
  -- отказался (больше не спрашиваем); closed — гость ушёл или поздно.
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'called', 'declined', 'closed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  due_at        timestamptz,
  called_at     timestamptz,
  call_id       uuid,
  shown_at      timestamptz
);

CREATE INDEX IF NOT EXISTS guest_dessert_reminders_device_idx
  ON public.guest_dessert_reminders (restaurant_id, device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS guest_dessert_reminders_pending_idx
  ON public.guest_dessert_reminders (status, created_at) WHERE status = 'pending';

ALTER TABLE public.guest_dessert_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guest_dessert_reminders FROM anon, authenticated;
GRANT ALL ON public.guest_dessert_reminders TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
