-- ============================================================
-- ROLLBACK для 20260803020000_take_guest_cart.sql
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260803020000_take_guest_cart_rollback.sql
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.take_guest_cart(uuid, integer);

NOTIFY pgrst, 'reload schema';

COMMIT;
