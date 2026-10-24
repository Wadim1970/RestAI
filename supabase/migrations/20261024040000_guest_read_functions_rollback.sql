-- Откат 20261024040000_guest_read_functions.sql.
BEGIN;
DROP FUNCTION IF EXISTS public.get_restaurant_ai_profile(uuid);
DROP FUNCTION IF EXISTS public.get_guest_restaurant_stats(text, uuid);
DROP FUNCTION IF EXISTS public.get_conversation_history(text, integer);
DROP FUNCTION IF EXISTS public.get_table_unpaid_total(uuid, text);
COMMIT;
NOTIFY pgrst, 'reload schema';
