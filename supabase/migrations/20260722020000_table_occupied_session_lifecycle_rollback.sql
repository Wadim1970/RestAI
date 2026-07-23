-- ============================================================
-- ОТКАТ: статус «Занят» + RPC жизненного цикла гостевой сессии.
-- Убирает три функции и возвращает CHECK-констрейнт table_sessions к
-- набору без 'occupied'. Открытые 'occupied'-сессии перед этим гасятся
-- (иначе новый констрейнт не встанет).
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260722020000_table_occupied_session_lifecycle_rollback.sql
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.release_table_if_occupied(uuid);
DROP FUNCTION IF EXISTS public.is_table_session_active(uuid);
DROP FUNCTION IF EXISTS public.mark_table_occupied(uuid, text);

-- Гасим оставшиеся 'occupied'-сессии, чтобы констрейнт без этого значения встал.
UPDATE public.table_sessions
SET is_active = false, ended_at = COALESCE(ended_at, now()), status = 'free'
WHERE status = 'occupied';

DO $do$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.table_sessions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.table_sessions DROP CONSTRAINT %I', c);
  END LOOP;
END $do$;

ALTER TABLE public.table_sessions
  ADD CONSTRAINT table_sessions_status_check
  CHECK (status IN ('free', 'preparing', 'resting', 'bill_requested', 'call'));

NOTIFY pgrst, 'reload schema';

COMMIT;
