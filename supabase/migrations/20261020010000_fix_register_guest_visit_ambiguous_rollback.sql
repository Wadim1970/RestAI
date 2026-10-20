-- Откат 20261020010000: возвращает версию register_guest_visit из
-- 20260831030000 (с ошибкой на повторном визите — откатывать только если
-- новая версия чем-то мешает).
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20261020010000_fix_register_guest_visit_ambiguous_rollback.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.register_guest_visit(p_device_id text)
RETURNS TABLE (id bigint, visit_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_gid bigint;
BEGIN
  v_gid := public.guest_id_for_device(p_device_id);

  IF v_gid IS NULL THEN
    INSERT INTO public.guests (device_id, visit_count, created_at, last_visit_at)
    VALUES (p_device_id, 1, now(), now())
    RETURNING guests.id INTO v_gid;
    INSERT INTO public.guest_devices (device_id, guest_id)
    VALUES (p_device_id, v_gid)
    ON CONFLICT (device_id) DO NOTHING;
  ELSE
    UPDATE public.guests
      SET visit_count = COALESCE(visit_count, 0) + 1, last_visit_at = now()
      WHERE guests.id = v_gid;
  END IF;

  RETURN QUERY SELECT g.id, g.visit_count FROM public.guests g WHERE g.id = v_gid;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
