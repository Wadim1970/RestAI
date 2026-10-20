-- ============================================================
-- Закрываем данные гостей от публичного (anon) ключа.
--
-- БЫЛО: публичным ключом, который лежит в бандле приложения гостя и
-- доступен любому, читались:
--   • guests — имена, телефоны, баллы, предпочтения, device_id;
--   • guest_summary — визиты, любимые блюда, device_id;
--   • order_guests — заметки официанта о госте (пол, возраст, внешность),
--     device_id.
-- device_id — фактически пароль гостя: по нему функции отдают профиль
-- (get_guest_profile) и меняют его (update_guest_profile).
--
-- Приложениям эти таблицы напрямую не нужны: гость работает через
-- SECURITY DEFINER-функции, официант — под своим входом (authenticated) и
-- order_guests ему оставляем. Единственное прямое чтение guests (контекст
-- для ИИ: предпочтения, визиты, средний чек — текстовый чат и голосовой
-- помощник) переезжает в get_guest_ai_context — по device_id, без имени и
-- телефона.
--
-- СТРАХОВКА: если в базе есть функция с правами вызывающего (SECURITY
-- INVOKER), которая читает эти таблицы и доступна anon/authenticated, после
-- отзыва прав она бы сломалась. Такие функции миграция ищет сама и, если
-- находит, ничего не меняет и называет их — пришлите вывод.
--
-- Запускать из-под supabase_admin (или в Supabase Studio → SQL Editor):
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20261020020000_close_guest_data_from_anon.sql
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_list text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_list
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT p.prosecdef
    AND p.prosrc ~* '(\mguests\M|\morder_guests\M|\mguest_summary\M)'
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Ничего не изменено: эти функции работают с правами вызывающего и читают данные гостей — их сначала нужно перевести на SECURITY DEFINER: %', v_list;
  END IF;
END $$;

-- Контекст гостя для ИИ — только по своему устройству и без личных данных.
CREATE OR REPLACE FUNCTION public.get_guest_ai_context(p_device_id text)
RETURNS TABLE (guest_id bigint, preferences jsonb, visit_count integer, avg_check numeric)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT g.id, g.preferences::jsonb, g.visit_count::integer, g.avg_check::numeric
  FROM public.guests g
  WHERE g.id = public.guest_id_for_device(p_device_id);
$$;
GRANT EXECUTE ON FUNCTION public.get_guest_ai_context(text) TO anon, authenticated, service_role;

REVOKE ALL ON public.guests        FROM anon, authenticated;
REVOKE ALL ON public.guest_summary FROM anon, authenticated;
REVOKE ALL ON public.guest_devices FROM anon, authenticated;
REVOKE ALL ON public.order_guests  FROM anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
