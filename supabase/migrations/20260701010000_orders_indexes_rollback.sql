-- ============================================================
-- ОТКАТ.
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS public.orders_restaurant_table_id_status_idx;
DROP INDEX IF EXISTS public.orders_restaurant_table_number_status_idx;
DROP INDEX IF EXISTS public.orders_guest_session_status_idx;

COMMIT;
