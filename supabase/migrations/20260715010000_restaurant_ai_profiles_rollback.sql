BEGIN;

DROP TABLE IF EXISTS public.restaurant_ai_profiles;

NOTIFY pgrst, 'reload schema';

COMMIT;
