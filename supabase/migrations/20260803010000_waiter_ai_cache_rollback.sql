-- ============================================================
-- ROLLBACK для 20260803010000_waiter_ai_cache.sql
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260803010000_waiter_ai_cache_rollback.sql
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS public.waiter_ai_cache;

NOTIFY pgrst, 'reload schema';

COMMIT;
