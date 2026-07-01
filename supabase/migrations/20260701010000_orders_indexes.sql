-- ============================================================
-- Индексы для orders под реальные паттерны запросов из кода.
--
-- Сейчас на orders есть только orders_pkey (по id) — любой фильтр по
-- restaurant_id/table_id/table_number/status/guest_id/session_id идёт
-- последовательным сканом всей таблицы, и будет медленнее с ростом
-- истории заказов.
--
-- Три индекса под три реально существующих в коде паттерна:
--   1. Waiter-app (getOrCreateOrder, TablesScreen.handleTableClick):
--      .eq('restaurant_id', ..).eq('table_id', ..).eq/not('status', ..)
--   2. RestAI (handleRequestBill):
--      .eq('restaurant_id', ..).eq('table_number', ..).in('status', ..)
--      — именно эта комбинация была прямо названа в исходном разборе.
--   3. RestAI (handleConfirmBillChoice):
--      .eq('guest_id', ..).eq('session_id', ..).in('status', ..)
--
-- Один составной индекс не может закрыть все три — Postgres использует
-- составной индекс строго по префиксу слева направо, а тут три разных
-- ведущих пары колонок (table_id / table_number / guest_id+session_id).
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260701010000_orders_indexes.sql
-- ============================================================

BEGIN;

CREATE INDEX IF NOT EXISTS orders_restaurant_table_id_status_idx
  ON public.orders (restaurant_id, table_id, status);

CREATE INDEX IF NOT EXISTS orders_restaurant_table_number_status_idx
  ON public.orders (restaurant_id, table_number, status);

CREATE INDEX IF NOT EXISTS orders_guest_session_status_idx
  ON public.orders (guest_id, session_id, status);

COMMIT;
