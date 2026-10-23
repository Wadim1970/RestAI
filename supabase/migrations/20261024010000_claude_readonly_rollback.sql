-- Закрыть доступ «только чтение» (20261024010000_claude_readonly.sql).
-- Уже выпущенный ключ перестаёт работать сразу: роли больше нет.
BEGIN;
DROP FUNCTION IF EXISTS public.claude_query(text);
DROP FUNCTION IF EXISTS public.claude_schema();
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM claude_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT ON TABLES FROM claude_reader;
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM claude_reader;
REVOKE USAGE ON SCHEMA public FROM claude_reader;
REVOKE claude_reader FROM authenticator;
DROP ROLE IF EXISTS claude_reader;
COMMIT;
NOTIFY pgrst, 'reload schema';
