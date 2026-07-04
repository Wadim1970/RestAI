-- ============================================================
-- request_bill — гость просит официанта принести счёт (без оплаты).
--
-- ЗАЧЕМ:
--   Раньше "Принести счёт" в гостевом приложении сразу помечал места
--   оплаченными (pay_table_seats) и слал вебхук на заглушку-URL — то есть
--   официант по факту не уведомлялся, а стол ошибочно "закрывался" без денег.
--
--   Теперь у гостя две ветки: "позвать официанта со счётом" (эта функция) и
--   "оплатить самому" (pay_table_seats после реальной оплаты). Здесь — только
--   меняем статус активной сессии стола на 'bill_requested'. У официанта в
--   приложении карточка стола мгновенно станет "Ждут счёт" через Realtime
--   (table_sessions уже в публикации supabase_realtime).
--
--   Оплату НЕ трогаем и заказ НЕ закрываем: гость расплатится с официантом,
--   тот закроет стол сам.
--
-- Гость — роль anon, поэтому SECURITY DEFINER (как place_guest_order и
-- pay_table_seats), цены/доступ клиенту не доверяем.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260704010000_request_bill.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.request_bill(
  p_restaurant_id uuid,
  p_table_number text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_id uuid;
BEGIN
  -- Та же защита от клиентского String(null) -> текст "null", что и в
  -- place_guest_order: без неё cast в integer падает сырой ошибкой 22P02.
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

  -- Активная сессия стола -> "ждут счёт". Официант увидит через Realtime.
  UPDATE public.table_sessions
  SET status = 'bill_requested'
  WHERE table_id = v_table_id AND is_active = true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_bill(uuid, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
