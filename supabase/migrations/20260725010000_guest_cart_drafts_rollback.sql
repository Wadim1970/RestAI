-- ============================================================
-- ROLLBACK для 20260725010000_guest_cart_drafts.sql
--
-- Убирает черновики корзин: функции sync_guest_cart/get_table_cart_drafts,
-- таблицу guest_cart_drafts, и возвращает release_table_if_occupied к версии
-- без чистки черновиков (как в 20260722020000).
--
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260725010000_guest_cart_drafts_rollback.sql
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.sync_guest_cart(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.get_table_cart_drafts(uuid);
DROP TABLE IF EXISTS public.guest_cart_drafts;

CREATE OR REPLACE FUNCTION public.release_table_if_occupied(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done boolean := false;
BEGIN
  UPDATE public.table_sessions
  SET is_active = false, ended_at = now(), status = 'free'
  WHERE id = p_session_id
    AND is_active = true
    AND status = 'occupied';
  GET DIAGNOSTICS v_done = ROW_COUNT;
  RETURN v_done;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_table_if_occupied(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
