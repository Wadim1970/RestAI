-- ============================================================
-- ROLLBACK для 20260726010000_staff_review_prompts.sql
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260726010000_staff_review_prompts_rollback.sql
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.submit_staff_feedback(uuid, uuid, uuid, integer, text, text);
DROP FUNCTION IF EXISTS public.get_pending_staff_review(uuid);
DROP TABLE IF EXISTS public.staff_review_prompts;

NOTIFY pgrst, 'reload schema';

COMMIT;
