BEGIN;

DROP TABLE IF EXISTS public.conversation_turns;

NOTIFY pgrst, 'reload schema';

COMMIT;
