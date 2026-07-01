-- ============================================================
-- ОТКАТ.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.pay_table_seats(uuid, text, integer[]);
DROP FUNCTION IF EXISTS public.get_table_bill(uuid, text);

NOTIFY pgrst, 'reload schema';

COMMIT;
