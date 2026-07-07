-- ============================================================
-- Индекс под внутренний запрос place_guest_order.
--
-- ПРИЧИНА: place_guest_order ищет активный заказ стола так:
--   SELECT id FROM orders WHERE table_id = ... AND status IN ('new','cooking')
--   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
--
-- Индексы из 20260701010000_orders_indexes.sql все ведут с restaurant_id
-- (под запросы Waiter-app/RestAI через supabase-js) — ни один не покрывает
-- этот конкретный запрос, у которого restaurant_id в фильтре нет вообще.
-- Составной индекс Postgres использует по префиксу слева направо, так что
-- запрос идёт последовательным сканом всей orders — и чем больше истории
-- заказов накопилось, тем медленнее. Отсюда "стало подтормаживать" именно
-- со временем, а не после конкретного изменения кода.
--
-- Заодно — тот же паттерн (table_id без restaurant_id, растущая история)
-- в table_sessions, там place_guest_order делает INSERT..WHERE NOT EXISTS
-- и UPDATE по (table_id, is_active).
--
-- Перед применением можно проверить план запроса:
--   EXPLAIN ANALYZE
--   SELECT id FROM public.orders
--   WHERE table_id = (SELECT id FROM public.tables WHERE restaurant_id = '<id>' AND number = <N>)
--     AND status IN ('new', 'cooking')
--   ORDER BY created_at DESC LIMIT 1;
--   -- До индекса: "Seq Scan on orders". После: "Index Scan using orders_table_id_status_created_idx".
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260707010000_place_guest_order_index.sql
-- ============================================================

BEGIN;

CREATE INDEX IF NOT EXISTS orders_table_id_status_created_idx
  ON public.orders (table_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS table_sessions_table_id_active_idx
  ON public.table_sessions (table_id, is_active);

COMMIT;
