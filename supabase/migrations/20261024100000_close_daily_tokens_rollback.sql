-- Откат 20261024100000_close_daily_tokens.sql: возвращает прежние права.
BEGIN;
GRANT ALL ON public.restaurant_daily_tokens TO anon, authenticated;
COMMIT;
NOTIFY pgrst, 'reload schema';
