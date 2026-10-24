-- ============================================================
-- Закрыть токены QR (restaurant_daily_tokens) от публичного ключа и от
-- официантов. Читает и пишет их только сервер (service_role) и ночной
-- планировщик базы (generate_daily_tokens).
--
-- БЫЛО: RLS не было, публичный ключ читал токены всех ресторанов, вошедший
-- официант мог ещё и перезаписать их.
--
-- ЗАПУСКАТЬ ТОЛЬКО ПОСЛЕ 20261024090000 и ПОСЛЕ выкладки Waiter-app: сканер
-- QR в новой версии проверяет токен функцией check_shift_token, а старая
-- читает таблицу напрямую и после закрытия перестанет пускать на смену.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261024100000_close_daily_tokens.sql
-- Откат: 20261024100000_close_daily_tokens_rollback.sql
-- ============================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'check_shift_token') THEN
    RAISE EXCEPTION 'Сначала примените 20261024090000 (нет функции check_shift_token)';
  END IF;
END $$;

REVOKE ALL ON public.restaurant_daily_tokens FROM anon, authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
