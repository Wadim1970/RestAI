-- ============================================================
-- Раздел «Зал» в админке: схема зала, брони столов и связность истории.
--
-- 1) tables — координаты стола на схеме зала (layout_*). NULL — стол ещё
--    не расставлен, админка раскладывает такие сеткой.
-- 2) table_reservations — брони столов (таблица bookings уже занята под
--    заявки официантов на смены). Только для сервера (service_role):
--    в брони — имя и телефон гостя.
-- 3) История стола: кто обслуживал посадку и что заказали.
--    БЫЛО: приложение официанта создаёт table_sessions без waiter_id и
--    restaurant_id, а заказ (orders) не знает своей посадки — orders.session_id
--    занят текстовым id чата гостя. Теперь:
--      • table_sessions при создании сама получает restaurant_id (по столу) и
--        waiter_id (кто закреплён за столом на сегодня или навсегда), если
--        их не передали;
--      • orders.table_session_id — посадка, к которой относится заказ:
--        ставится при создании заказа (активная посадка стола), а если
--        посадка открылась позже заказа — при её открытии;
--      • прошлые заказы привязываются к посадкам по столу и времени.
--
-- Запускать из-под supabase_admin (или в Supabase Studio → SQL Editor):
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20261023010000_hall_admin.sql
-- Откат: 20261023010000_hall_admin_rollback.sql
-- ============================================================

BEGIN;

-- ── 1) Схема зала ──
ALTER TABLE public.tables
  ADD COLUMN IF NOT EXISTS layout_x        numeric,   -- левый край, % ширины зала (0–100)
  ADD COLUMN IF NOT EXISTS layout_y        numeric,   -- верхний край, % высоты зала (0–100)
  ADD COLUMN IF NOT EXISTS layout_w        numeric,   -- ширина, % ширины зала
  ADD COLUMN IF NOT EXISTS layout_h        numeric,   -- высота, % высоты зала
  ADD COLUMN IF NOT EXISTS layout_shape    text,      -- round | square | rect
  ADD COLUMN IF NOT EXISTS layout_rotation integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tables_layout_shape_check') THEN
    ALTER TABLE public.tables
      ADD CONSTRAINT tables_layout_shape_check
      CHECK (layout_shape IS NULL OR layout_shape IN ('round', 'square', 'rect'));
  END IF;
END $$;

-- ── 2) Брони столов ──
CREATE TABLE IF NOT EXISTS public.table_reservations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  table_id      uuid REFERENCES public.tables(id) ON DELETE SET NULL,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  guest_count   integer NOT NULL CHECK (guest_count > 0),
  guest_name    text,
  guest_phone   text,
  comment       text,
  -- confirmed — ждём гостя; seated — пришли; cancelled — отменили; no_show — не пришли
  status        text NOT NULL DEFAULT 'confirmed'
                CHECK (status IN ('confirmed', 'seated', 'cancelled', 'no_show')),
  source        text NOT NULL DEFAULT 'admin',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS table_reservations_restaurant_time_idx
  ON public.table_reservations (restaurant_id, starts_at);
CREATE INDEX IF NOT EXISTS table_reservations_table_time_idx
  ON public.table_reservations (table_id, starts_at);

ALTER TABLE public.table_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.table_reservations FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.table_reservations_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS table_reservations_touch ON public.table_reservations;
CREATE TRIGGER table_reservations_touch
  BEFORE UPDATE ON public.table_reservations
  FOR EACH ROW EXECUTE FUNCTION public.table_reservations_touch();

-- ── 3) Связность истории ──
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS table_session_id uuid
  REFERENCES public.table_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_table_session_idx ON public.orders (table_session_id);
CREATE INDEX IF NOT EXISTS table_sessions_restaurant_started_idx
  ON public.table_sessions (restaurant_id, started_at);
CREATE INDEX IF NOT EXISTS table_sessions_table_started_idx
  ON public.table_sessions (table_id, started_at);
CREATE INDEX IF NOT EXISTS waiter_calls_table_created_idx
  ON public.waiter_calls (table_id, created_at);

-- Новая посадка: ресторан — по столу; официант — закреплённый за столом
-- (на сегодня важнее, чем «навсегда»; при нескольких — последний назначенный).
-- Дата закрепления в приложении официанта — UTC-дата, поэтому сравниваем и с
-- ней, и с датой по времени ресторана.
CREATE OR REPLACE FUNCTION public.table_sessions_fill_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
BEGIN
  IF NEW.restaurant_id IS NULL THEN
    SELECT t.restaurant_id INTO NEW.restaurant_id FROM public.tables t WHERE t.id = NEW.table_id;
  END IF;

  IF NEW.waiter_id IS NULL THEN
    SELECT COALESCE(NULLIF(r.timezone, ''), 'Europe/Moscow') INTO v_tz
    FROM public.restaurants r WHERE r."restaurantId" = NEW.restaurant_id;

    SELECT a.waiter_id INTO NEW.waiter_id
    FROM public.waiter_table_assignments a
    WHERE a.table_id = NEW.table_id
      AND (a.is_permanent
           OR a.assigned_date = (now() AT TIME ZONE 'UTC')::date
           OR a.assigned_date = (now() AT TIME ZONE COALESCE(v_tz, 'Europe/Moscow'))::date)
    ORDER BY a.is_permanent ASC, a.created_at DESC
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS table_sessions_fill_defaults ON public.table_sessions;
CREATE TRIGGER table_sessions_fill_defaults
  BEFORE INSERT ON public.table_sessions
  FOR EACH ROW EXECUTE FUNCTION public.table_sessions_fill_defaults();

-- Новый заказ — к активной посадке своего стола.
CREATE OR REPLACE FUNCTION public.orders_fill_table_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.table_session_id IS NULL AND NEW.table_id IS NOT NULL THEN
    SELECT s.id INTO NEW.table_session_id
    FROM public.table_sessions s
    WHERE s.table_id = NEW.table_id AND s.is_active
    ORDER BY s.started_at DESC NULLS LAST
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_fill_table_session ON public.orders;
CREATE TRIGGER orders_fill_table_session
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_fill_table_session();

-- Посадка открылась после заказа (официант сначала завёл заказ) —
-- подбираем открытые заказы этого стола без посадки.
CREATE OR REPLACE FUNCTION public.table_sessions_adopt_orders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active THEN
    UPDATE public.orders o
    SET table_session_id = NEW.id
    WHERE o.table_id = NEW.table_id
      AND o.table_session_id IS NULL
      AND o.status IS DISTINCT FROM 'paid'
      AND o.created_at > now() - interval '6 hours';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS table_sessions_adopt_orders ON public.table_sessions;
CREATE TRIGGER table_sessions_adopt_orders
  AFTER INSERT ON public.table_sessions
  FOR EACH ROW EXECUTE FUNCTION public.table_sessions_adopt_orders();

-- Прошлое: ресторан у посадок без него; заказы — к посадке своего стола,
-- в окно которой попало время заказа (2 минуты запаса: заказ мог появиться
-- чуть раньше, чем приложение открыло посадку).
UPDATE public.table_sessions s
SET restaurant_id = t.restaurant_id
FROM public.tables t
WHERE s.restaurant_id IS NULL AND t.id = s.table_id;

UPDATE public.orders o
SET table_session_id = (
  SELECT s.id
  FROM public.table_sessions s
  WHERE s.table_id = o.table_id
    AND s.started_at <= o.created_at + interval '2 minutes'
    AND (s.ended_at IS NULL OR s.ended_at >= o.created_at)
  ORDER BY s.started_at DESC
  LIMIT 1
)
WHERE o.table_session_id IS NULL AND o.table_id IS NOT NULL;

COMMIT;
