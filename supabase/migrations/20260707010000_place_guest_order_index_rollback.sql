BEGIN;

DROP INDEX IF EXISTS public.orders_table_id_status_created_idx;
DROP INDEX IF EXISTS public.table_sessions_table_id_active_idx;

COMMIT;
