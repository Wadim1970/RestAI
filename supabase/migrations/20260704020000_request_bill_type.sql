-- ============================================================
-- request_bill + тип счёта (общий / раздельный).
--
-- ЗАЧЕМ:
--   Гость, когда зовёт официанта со счётом, теперь так же выбирает "за себя"
--   или "за весь стол" — официанту важно сразу знать, какой счёт нести:
--   общий (table) или раздельный (personal).
--
--   Тип кладём в table_sessions.bill_type; request_bill его проставляет вместе
--   со статусом 'bill_requested'. Вью столов отдаёт его официанту, карточка
--   показывает "Ждут счёт · общий/раздельный". Через Realtime — мгновенно.
--
-- ЗАТРАГИВАЕТ ОБЩУЮ СХЕМУ (та же БД, что у Waiter-app): колонку table_sessions
--   и вью tables_with_active_session (изначально из server/migrations/004).
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260704020000_request_bill_type.sql
-- ============================================================

BEGIN;

-- 1. Тип счёта на активной сессии стола ('personal' | 'table' | NULL)
ALTER TABLE public.table_sessions
  ADD COLUMN IF NOT EXISTS bill_type text;

-- 2. Вью столов — добавляем session_bill_type в конец (CREATE OR REPLACE
--    позволяет только дописывать колонки в хвост). security_invoker
--    сохраняем, иначе вью от суперюзера обходила бы RLS.
CREATE OR REPLACE VIEW public.tables_with_active_session
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.restaurant_id,
  t.number,
  t.zone,
  t.capacity,
  t.is_active AS table_is_active,
  ts.id AS session_id,
  ts.status AS session_status,
  ts.guest_count,
  ts.started_at,
  ts.waiter_id AS session_waiter_id,
  ts.bill_type AS session_bill_type
FROM public.tables t
LEFT JOIN public.table_sessions ts
  ON ts.table_id = t.id AND ts.is_active = true;

GRANT SELECT ON public.tables_with_active_session TO anon, authenticated, service_role;

-- 3. request_bill теперь принимает тип счёта. Старую 2-аргументную версию
--    убираем, чтобы не осталось перегрузки (клиент зовёт 3-аргументную).
DROP FUNCTION IF EXISTS public.request_bill(uuid, text);

CREATE OR REPLACE FUNCTION public.request_bill(
  p_restaurant_id uuid,
  p_table_number text,
  p_bill_type text DEFAULT NULL  -- 'personal' (раздельный) | 'table' (общий)
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_table_id uuid;
BEGIN
  IF p_table_number IS NULL OR btrim(p_table_number) = '' OR p_table_number = 'null' THEN
    RAISE EXCEPTION 'Не удалось определить номер стола';
  END IF;

  SELECT id INTO v_table_id
  FROM public.tables
  WHERE restaurant_id = p_restaurant_id
    AND number = p_table_number::integer
    AND is_active = true;

  IF v_table_id IS NULL THEN
    RAISE EXCEPTION 'Стол % не найден для этого ресторана', p_table_number;
  END IF;

  UPDATE public.table_sessions
  SET status = 'bill_requested',
      bill_type = NULLIF(p_bill_type, '')
  WHERE table_id = v_table_id AND is_active = true;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.request_bill(uuid, text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
