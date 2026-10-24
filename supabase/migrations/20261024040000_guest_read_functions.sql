-- ============================================================
-- Чтение для гостя и голосового помощника — через функции, а не таблицы.
--
-- Сейчас публичным (anon) ключом, который лежит в коде сайта, читаются
-- заказы, позиции заказов, отзывы и беседы с ИИ ВСЕХ ресторанов. Чтобы их
-- можно было закрыть (миграция 20261024050000), приложениям нужны функции,
-- которые отдают только своё:
--   • get_table_unpaid_total  — сумма неоплаченных заказов СВОЕГО стола;
--   • get_conversation_history — история беседы по номеру сессии;
--   • get_guest_restaurant_stats — статистика гостя в ресторане, по device_id;
--   • get_restaurant_ai_profile — профиль ИИ ресторана.
--
-- Эта миграция только ДОБАВЛЯЕТ функции — старые приложения продолжают
-- работать, запускать можно в любой момент.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261024040000_guest_read_functions.sql
-- Откат: 20261024040000_guest_read_functions_rollback.sql
-- ============================================================

BEGIN;

-- Сумма неоплаченных заказов стола (как раньше считал клиент: последние 20).
CREATE OR REPLACE FUNCTION public.get_table_unpaid_total(p_restaurant_id uuid, p_table_number text)
RETURNS numeric
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT COALESCE(sum(t.total_amount), 0)
  FROM (
    SELECT o.total_amount
    FROM public.orders o
    WHERE o.restaurant_id = p_restaurant_id::text
      AND o.table_number = p_table_number
      AND o.status IN ('new', 'cooking')
    LIMIT 20
  ) t;
$$;

-- История беседы (текст и голос) по номеру сессии: последние p_limit реплик,
-- от новых к старым — как отдавала прямая выборка.
CREATE OR REPLACE FUNCTION public.get_conversation_history(p_session_id text, p_limit integer DEFAULT 40)
RETURNS TABLE (role text, content text, source text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT c.role, c.content, c.source, c.created_at
  FROM public.conversation_turns c
  WHERE p_session_id IS NOT NULL AND c.session_id = p_session_id
  ORDER BY c.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 40), 1), 100);
$$;

-- Статистика гостя в ресторане — только по своему устройству.
CREATE OR REPLACE FUNCTION public.get_guest_restaurant_stats(p_device_id text, p_restaurant_id uuid)
RETURNS TABLE (tags jsonb, top_dishes jsonb, avg_check numeric, total_orders integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT s.tags, s.top_dishes, s.avg_check::numeric, s.total_orders
  FROM public.guest_restaurant_stats s
  WHERE s.guest_id = public.guest_id_for_device(p_device_id)
    AND s.restaurant_id = p_restaurant_id::text;
$$;

-- Профиль ИИ конкретного ресторана.
CREATE OR REPLACE FUNCTION public.get_restaurant_ai_profile(p_restaurant_id uuid)
RETURNS TABLE (character_profile jsonb, restaurant_policy jsonb, philosophy text)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT p.character_profile, p.restaurant_policy, p.philosophy
  FROM public.restaurant_ai_profiles p
  WHERE p.restaurant_id = p_restaurant_id::text;
$$;

REVOKE ALL ON FUNCTION public.get_table_unpaid_total(uuid, text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_conversation_history(text, integer)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_guest_restaurant_stats(text, uuid)    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_restaurant_ai_profile(uuid)           FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_table_unpaid_total(uuid, text)      TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_conversation_history(text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_guest_restaurant_stats(text, uuid)  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_restaurant_ai_profile(uuid)         TO anon, authenticated, service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
