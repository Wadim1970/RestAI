-- Откат 20261024090000_waiter_data_scope.sql: возвращает прежнее (открытое)
-- состояние. check_shift_token остаётся, она безвредна.
BEGIN;

DROP POLICY IF EXISTS ts_select_anon ON public.table_sessions;
GRANT SELECT ON public.table_sessions TO anon;
CREATE POLICY ts_select_anon ON public.table_sessions FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS tables_select_waiter ON public.tables;
GRANT ALL ON public.tables TO anon, authenticated;
CREATE POLICY tables_select ON public.tables FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS wta_select_waiter ON public.waiter_table_assignments;
GRANT SELECT ON public.waiter_table_assignments TO anon;
GRANT INSERT, UPDATE, DELETE ON public.waiter_table_assignments TO authenticated;
CREATE POLICY wta_select ON public.waiter_table_assignments FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS staff_shifts_select_own ON public.staff_shifts;
ALTER TABLE public.staff_shifts DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.staff_shifts TO anon, authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
