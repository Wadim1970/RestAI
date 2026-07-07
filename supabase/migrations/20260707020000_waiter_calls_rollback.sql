BEGIN;

ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.waiter_calls;
DROP FUNCTION IF EXISTS public.acknowledge_waiter_call(uuid, uuid);
DROP FUNCTION IF EXISTS public.call_waiter(uuid, text);
DROP TABLE IF EXISTS public.waiter_calls;

COMMIT;
