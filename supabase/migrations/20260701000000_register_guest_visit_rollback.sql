-- ============================================================
-- ОТКАТ.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.register_guest_visit(text);

NOTIFY pgrst, 'reload schema';

COMMIT;
