-- ============================================================
-- Убрать ДЕМО-гостей из demo_guests.sql: гостей с устройствами
-- 'restai-demo-%', их посадки, заказы, отзывы и брони с телефонами
-- +7 999 000-00-0X. Реальные данные не трогает.
--
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < /tmp/demo_guests_cleanup.sql
-- ============================================================

BEGIN;
CREATE TEMP TABLE _demo_orders ON COMMIT DROP AS
  SELECT DISTINCT og.order_id AS id FROM public.order_guests og WHERE og.device_id LIKE 'restai-demo-%';
CREATE TEMP TABLE _demo_sessions ON COMMIT DROP AS
  SELECT DISTINCT o.table_session_id AS id FROM public.orders o
  WHERE o.id IN (SELECT id FROM _demo_orders) AND o.table_session_id IS NOT NULL;
CREATE TEMP TABLE _demo_guests ON COMMIT DROP AS
  SELECT g.id FROM public.guests g WHERE g.device_id LIKE 'restai-demo-%';

DELETE FROM public.reviews WHERE session_id IN (SELECT id::text FROM _demo_sessions);
DELETE FROM public.order_item_modifiers WHERE order_item_id IN (SELECT id FROM public.order_items WHERE order_id IN (SELECT id FROM _demo_orders));
DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM _demo_orders);
DELETE FROM public.order_guests WHERE order_id IN (SELECT id FROM _demo_orders);
DELETE FROM public.orders WHERE id IN (SELECT id FROM _demo_orders);
DELETE FROM public.table_sessions WHERE id IN (SELECT id FROM _demo_sessions);
DELETE FROM public.guest_restaurant_stats WHERE guest_id IN (SELECT id FROM _demo_guests);
DELETE FROM public.guest_devices WHERE guest_id IN (SELECT id FROM _demo_guests) OR device_id LIKE 'restai-demo-%';
DELETE FROM public.guests WHERE id IN (SELECT id FROM _demo_guests);
DELETE FROM public.table_reservations WHERE guest_phone LIKE '+799900000__';

COMMIT;

SELECT count(*) AS осталось_демо_гостей FROM public.guests WHERE device_id LIKE 'restai-demo-%';
