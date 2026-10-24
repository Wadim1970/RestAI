-- Откат 20261024050000_close_orders_chat_from_anon.sql: возвращает прежние
-- (открытые) политики чтения.
BEGIN;
ALTER POLICY order_items_select ON public.order_items TO anon, authenticated;
ALTER POLICY orders_select ON public.orders TO anon, authenticated;
CREATE POLICY orders_select_anon ON public.orders FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY reviews_select ON public.reviews FOR SELECT TO anon USING (true);
CREATE POLICY reviews_select_anon ON public.reviews FOR SELECT TO anon USING (true);
CREATE POLICY conversation_turns_select ON public.conversation_turns FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY guest_restaurant_stats_select ON public.guest_restaurant_stats FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY restaurant_ai_profiles_select ON public.restaurant_ai_profiles FOR SELECT TO anon, authenticated USING (true);
COMMIT;
NOTIFY pgrst, 'reload schema';
