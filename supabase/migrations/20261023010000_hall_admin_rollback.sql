-- Откат 20261023010000_hall_admin.sql.
-- ВНИМАНИЕ: удаляет брони столов и расстановку столов на схеме.
BEGIN;

DROP TRIGGER IF EXISTS table_sessions_adopt_orders ON public.table_sessions;
DROP FUNCTION IF EXISTS public.table_sessions_adopt_orders();
DROP TRIGGER IF EXISTS orders_fill_table_session ON public.orders;
DROP FUNCTION IF EXISTS public.orders_fill_table_session();
DROP TRIGGER IF EXISTS table_sessions_fill_defaults ON public.table_sessions;
DROP FUNCTION IF EXISTS public.table_sessions_fill_defaults();

DROP INDEX IF EXISTS public.waiter_calls_table_created_idx;
DROP INDEX IF EXISTS public.table_sessions_table_started_idx;
DROP INDEX IF EXISTS public.table_sessions_restaurant_started_idx;
DROP INDEX IF EXISTS public.orders_table_session_idx;
ALTER TABLE public.orders DROP COLUMN IF EXISTS table_session_id;

DROP TABLE IF EXISTS public.table_reservations;
DROP FUNCTION IF EXISTS public.table_reservations_touch();

ALTER TABLE public.tables
  DROP CONSTRAINT IF EXISTS tables_layout_shape_check,
  DROP COLUMN IF EXISTS layout_x,
  DROP COLUMN IF EXISTS layout_y,
  DROP COLUMN IF EXISTS layout_w,
  DROP COLUMN IF EXISTS layout_h,
  DROP COLUMN IF EXISTS layout_shape,
  DROP COLUMN IF EXISTS layout_rotation;

COMMIT;
