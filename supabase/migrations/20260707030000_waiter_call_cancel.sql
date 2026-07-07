-- ============================================================
-- Отмена вызова официанта повторным нажатием той же кнопки.
--
-- Статус 'cancelled' добавляется в CHECK через DO-блок, который сам
-- находит имя constraint'а по определению (а не по угаданному имени) —
-- предыдущая миграция не давала constraint'у явного имени.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260707030000_waiter_call_cancel.sql
-- ============================================================

BEGIN;

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
  ADD CONSTRAINT waiter_calls_status_check CHECK (status IN ('pending', 'acknowledged', 'cancelled'));

CREATE OR REPLACE FUNCTION public.cancel_waiter_call(
  p_call_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated boolean;
BEGIN
  UPDATE public.waiter_calls
  SET status = 'cancelled'
  WHERE id = p_call_id
    AND status = 'pending';

  v_updated := FOUND;
  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_waiter_call(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
