BEGIN;

DROP FUNCTION IF EXISTS public.cancel_waiter_call(uuid);

DO $do$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'waiter_calls'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%status%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.waiter_calls DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $do$;

ALTER TABLE public.waiter_calls
  ADD CONSTRAINT waiter_calls_status_check CHECK (status IN ('pending', 'acknowledged'));

COMMIT;
