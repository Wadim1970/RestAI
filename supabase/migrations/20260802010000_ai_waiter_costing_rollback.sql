-- ============================================================
-- ROLLBACK для 20260802010000_ai_waiter_costing.sql
--   Удаляет три таблицы Phase 0 целиком (вместе с сидом костинга и флагов).
--
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260802010000_ai_waiter_costing_rollback.sql
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS public.waiter_ai_suggestions;
DROP TABLE IF EXISTS public.dish_daily_flags;
DROP TABLE IF EXISTS public.menu_item_costing;

NOTIFY pgrst, 'reload schema';

COMMIT;
