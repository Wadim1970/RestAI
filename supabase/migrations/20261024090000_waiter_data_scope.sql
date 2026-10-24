-- ============================================================
-- Смены, закрепления, столы и посадки — только своего ресторана.
--
-- БЫЛО:
--   • staff_shifts — RLS не было вообще: публичный ключ читал все смены
--     (с чаевыми), любой вошедший официант читал и менял чужие;
--   • waiter_table_assignments, tables — читали все, включая публичный ключ;
--   • table_sessions — публичный ключ читал все посадки;
--   • у anon и authenticated были права на запись в tables и
--     waiter_table_assignments (держала только RLS).
--
-- СТАЛО:
--   • staff_shifts: RLS включён; официант читает только свои смены, запись —
--     только серверу (service_role). Экран «Доход» читает свои — работает.
--   • waiter_table_assignments, tables: публичный ключ — ничего; вошедший
--     официант — только рестораны, куда допущен (waiter_can_access_restaurant).
--     Запись — только серверу.
--   • table_sessions: публичный ключ — ничего; для официантов правила прежние.
--   • check_shift_token(token) — для сканера QR: возвращает ресторан, если
--     токен сегодняшний. Нужна, чтобы закрыть restaurant_daily_tokens
--     (20261024100000): сканер больше не читает таблицу токенов напрямую.
--
-- НЕ затронуто (по решению владельца): waiter_calls.
--
-- Приложения менять для этой миграции не нужно: гостевое приложение этих
-- таблиц напрямую не читает (проверено по коду), официант читает под входом.
-- Эта миграция только добавляет check_shift_token и ужесточает доступ.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261024090000_waiter_data_scope.sql
-- Откат: 20261024090000_waiter_data_scope_rollback.sql
-- ============================================================

BEGIN;

-- Страховка: функции с правами вызывающего, доступные anon, которые читают
-- закрываемые таблицы, после миграции перестали бы работать.
DO $$
DECLARE
  v_list text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_list
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT p.prosecdef
    AND p.prorettype <> 'trigger'::regtype
    AND p.proname NOT IN ('generate_daily_tokens', 'claude_schema')
    AND p.prosrc ~* '(\mstaff_shifts\M|\mwaiter_table_assignments\M|\mtable_sessions\M|\mtables\M)'
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Ничего не изменено: эти функции работают с правами вызывающего и читают закрываемые таблицы: %', v_list;
  END IF;
END $$;

-- ── Проверка токена смены (для сканера QR) ──
-- «Сегодня» по UTC — так же, как считал сканер (valid_date = сегодня UTC).
CREATE OR REPLACE FUNCTION public.check_shift_token(p_token text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.restaurant_id
  FROM public.restaurant_daily_tokens t
  WHERE p_token IS NOT NULL AND t.token = p_token
    AND t.valid_date = (now() AT TIME ZONE 'UTC')::date
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.check_shift_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_shift_token(text) TO authenticated, service_role;

-- ── staff_shifts ──
ALTER TABLE public.staff_shifts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_shifts FROM anon, authenticated;
GRANT SELECT ON public.staff_shifts TO authenticated;
CREATE POLICY staff_shifts_select_own ON public.staff_shifts FOR SELECT TO authenticated
  USING (waiter_id = public.current_waiter_id());

-- ── waiter_table_assignments ──
DROP POLICY IF EXISTS wta_select ON public.waiter_table_assignments;
REVOKE ALL ON public.waiter_table_assignments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.waiter_table_assignments FROM authenticated;
CREATE POLICY wta_select_waiter ON public.waiter_table_assignments FOR SELECT TO authenticated
  USING (public.waiter_can_access_restaurant(
    (SELECT t.restaurant_id FROM public.tables t WHERE t.id = table_id)));

-- ── tables ──
DROP POLICY IF EXISTS tables_select ON public.tables;
REVOKE ALL ON public.tables FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.tables FROM authenticated;
CREATE POLICY tables_select_waiter ON public.tables FOR SELECT TO authenticated
  USING (public.waiter_can_access_restaurant(restaurant_id));

-- ── table_sessions: публичный ключ больше не читает ──
DROP POLICY IF EXISTS ts_select_anon ON public.table_sessions;
REVOKE ALL ON public.table_sessions FROM anon;

COMMIT;
NOTIFY pgrst, 'reload schema';
