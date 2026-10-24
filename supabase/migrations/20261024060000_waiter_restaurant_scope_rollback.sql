-- Откат 20261024060000_waiter_restaurant_scope.sql: возвращает прежние
-- (без ограничения по ресторану) политики для authenticated.
BEGIN;
DROP POLICY IF EXISTS ts_update_waiter ON public.table_sessions;
DROP POLICY IF EXISTS ts_insert_waiter ON public.table_sessions;
DROP POLICY IF EXISTS ts_select_waiter ON public.table_sessions;
DROP POLICY IF EXISTS ts_select_anon   ON public.table_sessions;
CREATE POLICY ts_select ON public.table_sessions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY ts_insert ON public.table_sessions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY ts_update ON public.table_sessions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS oim_select_waiter ON public.order_item_modifiers;
CREATE POLICY oim_select ON public.order_item_modifiers FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS order_guests_delete_waiter ON public.order_guests;
DROP POLICY IF EXISTS order_guests_update_waiter ON public.order_guests;
DROP POLICY IF EXISTS order_guests_insert_waiter ON public.order_guests;
DROP POLICY IF EXISTS order_guests_select_waiter ON public.order_guests;
ALTER TABLE public.order_guests DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_items_delete_waiter ON public.order_items;
DROP POLICY IF EXISTS order_items_update_waiter ON public.order_items;
DROP POLICY IF EXISTS order_items_insert_waiter ON public.order_items;
DROP POLICY IF EXISTS order_items_select_waiter ON public.order_items;
CREATE POLICY order_items_select ON public.order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY order_items_insert ON public.order_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY order_items_update ON public.order_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY order_items_delete ON public.order_items FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS orders_update_waiter ON public.orders;
DROP POLICY IF EXISTS orders_insert_waiter ON public.orders;
DROP POLICY IF EXISTS orders_select_waiter ON public.orders;
CREATE POLICY orders_select ON public.orders FOR SELECT TO authenticated USING (true);
CREATE POLICY orders_insert ON public.orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY orders_update ON public.orders FOR UPDATE TO authenticated USING (true);

DROP FUNCTION IF EXISTS public.waiter_can_access_order(uuid);
DROP FUNCTION IF EXISTS public.waiter_can_access_restaurant(text);
COMMIT;
NOTIFY pgrst, 'reload schema';
