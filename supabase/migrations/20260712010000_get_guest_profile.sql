-- ============================================================
-- get_guest_profile — чтение профиля гостя для личного кабинета.
--
-- ЗАЧЕМ: PersonalCabinet читал public.guests напрямую через anon-ключ
-- (.from('guests').select(...).eq('id', guestId)) — единственное место
-- в проекте, где клиент обращается к guests не через RPC. Прямой SELECT
-- упирался в RLS (весь остальной доступ к guests идёт через SECURITY
-- DEFINER функции), из-за чего profile молча оставался null и кнопка
-- сохранения в личном кабинете никогда не становилась активной.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260712010000_get_guest_profile.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_guest_profile(p_device_id text)
RETURNS TABLE(
  name           text,
  phone          text,
  points         integer,
  birthday_day   smallint,
  birthday_month smallint,
  dislikes       text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT g.name, g.phone, g.points, g.birthday_day, g.birthday_month, g.dislikes
  FROM public.guests g
  WHERE g.device_id = p_device_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_guest_profile(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
