-- ============================================================
-- ROLLBACK для 20260725030000_get_active_table_session.sql
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260725030000_get_active_table_session_rollback.sql
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_active_table_session(uuid, text);

NOTIFY pgrst, 'reload schema';

COMMIT;
