-- Откат 20261101010000_table_tips.sql. Записанные чаевые удаляются без возврата.
BEGIN;
DROP FUNCTION IF EXISTS public.record_table_tip(uuid, text, integer[], text, integer);
DROP TABLE IF EXISTS public.table_tips;
COMMIT;
