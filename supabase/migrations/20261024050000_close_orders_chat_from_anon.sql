-- ============================================================
-- Закрыть от публичного (anon) ключа заказы, позиции, отзывы и беседы с ИИ.
--
-- БЫЛО: публичным ключом из кода сайта читались orders, order_items,
-- reviews, conversation_turns, guest_restaurant_stats, restaurant_ai_profiles
-- ВСЕХ ресторанов (политики SELECT с условием true).
--
-- СТАЛО:
--   • orders, order_items: чтение остаётся только у authenticated (официанты).
--     Это всё ещё «все официанты видят заказы всех ресторанов» — следующий
--     шаг ограничит их по ресторану; здесь закрывается публичный ключ.
--   • reviews: чтение anon убрано (читают сервер и SECURITY DEFINER-функции).
--   • conversation_turns, guest_restaurant_stats, restaurant_ai_profiles:
--     чтение убрано совсем — приложения ходят через функции из
--     20261024040000_guest_read_functions.sql. Запись реплик (INSERT) остаётся.
--
-- ЗАПУСКАТЬ ТОЛЬКО ПОСЛЕ 20261024040000 и ПОСЛЕ выкладки приложения гостя
-- (RestAI) и голосового помощника (voice-relay): старые версии читают эти
-- таблицы напрямую и после закрытия перестанут получать данные.
--
-- СТРАХОВКА: если находится функция с правами вызывающего (SECURITY
-- INVOKER), доступная anon и читающая эти таблицы, миграция ничего не
-- меняет и называет её.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261024050000_close_orders_chat_from_anon.sql
-- Откат: 20261024050000_close_orders_chat_from_anon_rollback.sql
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_list text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_list
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT p.prosecdef
    AND p.prorettype <> 'trigger'::regtype
    AND p.prosrc ~* '(\morders\M|\morder_items\M|\mconversation_turns\M|\mguest_restaurant_stats\M|\mrestaurant_ai_profiles\M)'
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Ничего не изменено: эти функции работают с правами вызывающего и читают закрываемые таблицы: %', v_list;
  END IF;
END $$;

-- orders / order_items: убрать anon, оставить authenticated.
DROP POLICY IF EXISTS orders_select_anon ON public.orders;
ALTER POLICY orders_select ON public.orders TO authenticated;
ALTER POLICY order_items_select ON public.order_items TO authenticated;

-- reviews: чтение anon не нужно.
DROP POLICY IF EXISTS reviews_select ON public.reviews;
DROP POLICY IF EXISTS reviews_select_anon ON public.reviews;

-- Беседы, статистика гостя, профиль ИИ: только через функции.
DROP POLICY IF EXISTS conversation_turns_select ON public.conversation_turns;
DROP POLICY IF EXISTS guest_restaurant_stats_select ON public.guest_restaurant_stats;
DROP POLICY IF EXISTS restaurant_ai_profiles_select ON public.restaurant_ai_profiles;

COMMIT;
NOTIFY pgrst, 'reload schema';
