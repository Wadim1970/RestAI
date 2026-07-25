-- ============================================================
-- ROLLBACK для 20260725020000_fix_sync_guest_cart_ambiguous.sql
--
-- Возвращает прежнюю (ДО фикса) версию sync_guest_cart из 20260725010000.
-- ВНИМАНИЕ: та версия падает с 42702 на каждом вызове (ради чего фикс и
-- делался) — откатывать имеет смысл только если сам фикс оказался проблемным.
--
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260725020000_fix_sync_guest_cart_ambiguous_rollback.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_guest_cart(
  p_restaurant_id uuid,
  p_table_number  text,
  p_device_id     text,
  p_items         jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (session_id uuid, seat_number integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_id   uuid;
  v_session_id uuid;
  v_seat       integer;
BEGIN
  IF p_table_number IS NULL OR btrim(p_table_number) = '' OR p_table_number = 'null' THEN
    RAISE EXCEPTION 'Не удалось определить номер стола';
  END IF;
  IF p_device_id IS NULL OR btrim(p_device_id) = '' THEN
    RAISE EXCEPTION 'Не удалось определить устройство гостя';
  END IF;

  SELECT t.id INTO v_table_id
  FROM public.tables t
  WHERE t.restaurant_id = p_restaurant_id
    AND t.number = p_table_number::integer
    AND t.is_active = true;
  IF v_table_id IS NULL THEN
    RAISE EXCEPTION 'Стол % не найден для этого ресторана', p_table_number;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_table_id::text, 0));

  SELECT ts.id INTO v_session_id
  FROM public.table_sessions ts
  WHERE ts.table_id = v_table_id AND ts.is_active = true
  LIMIT 1;
  IF v_session_id IS NULL THEN
    INSERT INTO public.table_sessions (table_id, restaurant_id, status, is_active, started_at)
    VALUES (v_table_id, p_restaurant_id, 'occupied', true, now())
    RETURNING id INTO v_session_id;
  END IF;

  SELECT d.seat_number INTO v_seat
  FROM public.guest_cart_drafts d
  WHERE d.session_id = v_session_id AND d.device_id = p_device_id;

  IF v_seat IS NULL THEN
    SELECT COALESCE(MAX(d.seat_number), 0) + 1 INTO v_seat
    FROM public.guest_cart_drafts d
    WHERE d.session_id = v_session_id;

    INSERT INTO public.guest_cart_drafts
      (session_id, table_id, restaurant_id, device_id, seat_number, items, updated_at)
    VALUES
      (v_session_id, v_table_id, p_restaurant_id, p_device_id, v_seat, COALESCE(p_items, '[]'::jsonb), now());
  ELSE
    UPDATE public.guest_cart_drafts
    SET items = COALESCE(p_items, '[]'::jsonb), updated_at = now()
    WHERE session_id = v_session_id AND device_id = p_device_id;
  END IF;

  UPDATE public.table_sessions
  SET guest_count = (SELECT COUNT(*) FROM public.guest_cart_drafts WHERE session_id = v_session_id)
  WHERE id = v_session_id;

  RETURN QUERY SELECT v_session_id, v_seat;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_guest_cart(uuid, text, text, jsonb) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
