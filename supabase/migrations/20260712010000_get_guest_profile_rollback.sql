BEGIN;

DROP FUNCTION IF EXISTS public.get_guest_profile(text);

NOTIFY pgrst, 'reload schema';

COMMIT;
