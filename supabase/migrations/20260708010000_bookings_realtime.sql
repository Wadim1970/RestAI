-- ============================================================
-- Реалтайм для bookings.
--
-- Бейдж "непросмотренные одобрения" (Waiter-app, Footer) подписан на
-- postgres_changes UPDATE по bookings, но таблица никогда не была
-- добавлена в публикацию supabase_realtime — Postgres в принципе не
-- отдаёт по ней события, независимо от фильтра. Поэтому бейдж
-- обновлялся только при повторном монтировании Footer (переход между
-- экранами/перезагрузка), а не мгновенно при одобрении.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260708010000_bookings_realtime.sql
-- ============================================================

BEGIN;

-- Нужно для фильтрованной Realtime-подписки (filter: worker_id=eq...)
-- на UPDATE — без REPLICA IDENTITY FULL старые значения строки могут
-- не попасть в WAL-запись.
ALTER TABLE public.bookings REPLICA IDENTITY FULL;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'bookings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
  END IF;
END $do$;

COMMIT;
