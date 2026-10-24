-- Откат 20261024080000_qr_functions_no_http_key.sql.
-- Прежние функции содержали зашитый ключ service_role и вызов мёртвого адреса;
-- ключ намеренно нигде не хранится, поэтому вернуть их дословно нельзя и не
-- нужно. Откат переводит trigger_generate_qr в «ничего не делать» (как будто
-- вызов уходит в пустоту, как это было на деле), а generate_daily_tokens
-- оставляет без изменений (ночная выдача токенов продолжает работать).
BEGIN;
CREATE OR REPLACE FUNCTION public.trigger_generate_qr()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NEW;
END;
$$;
COMMIT;
NOTIFY pgrst, 'reload schema';
