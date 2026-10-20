-- ============================================================
-- Фикс: register_guest_visit падала на КАЖДОМ повторном визите с
-- "column reference \"visit_count\" is ambiguous" (код 42702).
--
-- ПРИЧИНА: та же ловушка, что уже чинилась для викторины
-- (20260712020000, 20260714010000) — RETURNS TABLE(id, visit_count)
-- неявно заводит в теле функции переменные id и visit_count. В версии
-- из 20260831030000 (связка guest_devices) инкремент записан как
-- COALESCE(visit_count, 0) без имени таблицы — Postgres не знает,
-- столбец это или переменная. Первый визит устройства (ветка INSERT)
-- проходил, а повторный (ветка UPDATE) — нет.
--
-- ПОСЛЕДСТВИЕ: у всех вернувшихся гостей приложение не получало номер
-- гостя (guestId = null): молча пропускалась викторина при запросе
-- счёта, голосовой помощник не узнавал гостя (guestId "" в логах
-- voice-relay), не считались визиты.
--
-- ФИКС: столбцы — через псевдоним таблицы, плюс #variable_conflict
-- use_column на случай будущих правок. Логика та же.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20261020010000_fix_register_guest_visit_ambiguous.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.register_guest_visit(p_device_id text)
RETURNS TABLE (id bigint, visit_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_gid bigint;
BEGIN
  v_gid := public.guest_id_for_device(p_device_id);

  IF v_gid IS NULL THEN
    INSERT INTO public.guests AS g (device_id, visit_count, created_at, last_visit_at)
    VALUES (p_device_id, 1, now(), now())
    RETURNING g.id INTO v_gid;
    INSERT INTO public.guest_devices (device_id, guest_id)
    VALUES (p_device_id, v_gid)
    ON CONFLICT (device_id) DO NOTHING;
  ELSE
    UPDATE public.guests AS g
      SET visit_count = COALESCE(g.visit_count, 0) + 1, last_visit_at = now()
      WHERE g.id = v_gid;
  END IF;

  RETURN QUERY SELECT g.id, g.visit_count FROM public.guests g WHERE g.id = v_gid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_guest_visit(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
