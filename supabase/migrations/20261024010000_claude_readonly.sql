-- ============================================================
-- Доступ «только чтение» для разработчика (Claude) к базе по HTTPS.
--
-- Роль claude_reader:
--   • видит ВСЕ строки всех таблиц public (BYPASSRLS — иначе RLS прятал бы
--     данные), но прав на запись в таблицы у неё нет никаких: только SELECT.
--     Функции, открытые всем (как register_guest_visit для гостей), ей
--     доступны так же, как публичному ключу приложения, — не больше;
--   • входить в базу паролем не может (NOLOGIN) — только через PostgREST
--     (supabase.restai.pro/rest/v1) с JWT, где role = claude_reader.
--     Ключ выпускает deploy/make-readonly-token.sh на сервере базы.
--
-- Две функции (вызывает только claude_reader):
--   • claude_schema()        — устройство базы: таблицы и колонки, функции
--                              с их кодом, триггеры, политики RLS, права;
--   • claude_query(q text)   — выполнить SELECT и вернуть строки в JSON
--                              (запись невозможна: у роли нет прав, а
--                              запрос подставляется подзапросом).
--
-- Запускать на сервере базы из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < /tmp/claude_readonly.sql
-- Закрыть доступ: 20261024010000_claude_readonly_rollback.sql
-- ============================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'claude_reader') THEN
    CREATE ROLE claude_reader NOLOGIN NOINHERIT BYPASSRLS;
  ELSE
    ALTER ROLE claude_reader NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

-- PostgREST переключается в роль из JWT — для этого authenticator должен в ней состоять.
GRANT claude_reader TO authenticator;

GRANT USAGE ON SCHEMA public TO claude_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO claude_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO claude_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO claude_reader;
ALTER ROLE claude_reader SET statement_timeout = '20s';

-- ── Устройство базы ──
CREATE OR REPLACE FUNCTION public.claude_schema()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'tables', (
      SELECT jsonb_agg(jsonb_build_object(
        'table', c.relname,
        'kind', CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview' WHEN 'p' THEN 'table' END,
        'rls', c.relrowsecurity,
        'rows_estimate', c.reltuples::bigint,
        'columns', (
          SELECT jsonb_agg(jsonb_build_object(
            'name', a.attname,
            'type', format_type(a.atttypid, a.atttypmod),
            'not_null', a.attnotnull,
            'default', pg_get_expr(d.adbin, d.adrelid)
          ) ORDER BY a.attnum)
          FROM pg_attribute a
          LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        ),
        'constraints', (
          SELECT jsonb_agg(pg_get_constraintdef(k.oid) ORDER BY k.conname)
          FROM pg_constraint k WHERE k.conrelid = c.oid
        ),
        'indexes', (
          SELECT jsonb_agg(pg_get_indexdef(i.indexrelid))
          FROM pg_index i WHERE i.indrelid = c.oid
        ),
        'view_definition', CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid) END,
        'grants', (
          SELECT jsonb_object_agg(g.grantee, g.privs)
          FROM (
            SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
            FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = c.relname
              AND grantee IN ('anon', 'authenticated', 'service_role')
            GROUP BY grantee
          ) g
        )
      ) ORDER BY c.relname)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
    ),
    'functions', (
      SELECT jsonb_agg(jsonb_build_object(
        'name', p.proname,
        'args', pg_get_function_identity_arguments(p.oid),
        'returns', pg_get_function_result(p.oid),
        'security_definer', p.prosecdef,
        'executable_by_anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
        'executable_by_authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
        'definition', pg_get_functiondef(p.oid)
      ) ORDER BY p.proname)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
    ),
    'triggers', (
      SELECT jsonb_agg(jsonb_build_object(
        'table', c.relname, 'name', t.tgname, 'definition', pg_get_triggerdef(t.oid)
      ) ORDER BY c.relname, t.tgname)
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
    ),
    'policies', (
      SELECT jsonb_agg(jsonb_build_object(
        'table', tablename, 'name', policyname, 'command', cmd, 'roles', roles,
        'using', qual, 'with_check', with_check
      ) ORDER BY tablename, policyname)
      FROM pg_policies WHERE schemaname = 'public'
    ),
    'extensions', (SELECT jsonb_agg(extname ORDER BY extname) FROM pg_extension)
  )
$$;

-- ── Запрос на чтение ──
-- Запрос подставляется подзапросом: «WITH … DELETE/UPDATE» в подзапросе
-- Postgres запрещает, а записи у роли нет в принципе.
CREATE OR REPLACE FUNCTION public.claude_query(q text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Транзакция только на чтение: даже функции с правами владельца
  -- (SECURITY DEFINER) внутри запроса ничего не смогут записать.
  SET LOCAL transaction_read_only = on;
  IF q ~ ';\s*\S' THEN
    RAISE EXCEPTION 'Один запрос без «;» внутри';
  END IF;
  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (%s) t', regexp_replace(q, ';\s*$', ''))
    INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.claude_schema() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claude_query(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claude_schema() TO claude_reader;
GRANT EXECUTE ON FUNCTION public.claude_query(text) TO claude_reader;

COMMIT;

-- PostgREST должен узнать о новых функциях.
NOTIFY pgrst, 'reload schema';
