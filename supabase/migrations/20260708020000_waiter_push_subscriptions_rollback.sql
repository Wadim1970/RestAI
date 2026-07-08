BEGIN;

DROP FUNCTION IF EXISTS public.get_call_target_waiters(uuid);
DROP FUNCTION IF EXISTS public.save_push_subscription(uuid, text, text, text);
DROP TABLE IF EXISTS public.waiter_push_subscriptions;

COMMIT;
