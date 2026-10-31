-- ============================================================
-- Чаевые в окне оплаты гостя.
--
--  1. table_tips — выбранные гостем чаевые: за какие места стола, от какого
--     чека, какой вариант (рубли или % от чека) и какая итоговая сумма.
--     Сумму и чек считает СЕРВЕР по get_table_bill — клиенту не доверяем.
--  2. waiter_ids — официанты, закреплённые за столом на момент записи
--     (waiter_table_assignments: постоянные или назначенные на сегодня).
--     Пустой массив — за столом никто не закреплён.
--  3. is_test — пока оплата в приложении заглушка («Я оплатил (тест)»),
--     деньги не движутся, и запись — это НАМЕРЕНИЕ гостя, а не полученные
--     чаевые. Когда подключат реальную оплату, новые записи пишутся с
--     is_test = false, а в отчётах по чаевым нужно брать только их.
--  4. record_table_tip — вызывается ДО pay_table_seats (после оплаты заказ
--     уже не активен). Повторный вызов за те же места заменяет запись.
--     Допустимые значения (рубли 100/200/300/500/1000, % 3/5/10/15) должны
--     совпадать с src/lib/tip.js.
--
-- Запускать на сервере базы из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261101010000_table_tips.sql
-- Откат: 20261101010000_table_tips_rollback.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.table_tips (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_id      uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  table_number  text NOT NULL,
  seat_numbers  integer[] NOT NULL,
  seat_key      text NOT NULL,
  waiter_ids    uuid[] NOT NULL DEFAULT '{}',
  bill_amount   integer NOT NULL CHECK (bill_amount >= 0),
  tip_kind      text NOT NULL CHECK (tip_kind IN ('fixed', 'percent')),
  tip_value     integer NOT NULL CHECK (tip_value > 0),
  tip_amount    integer NOT NULL CHECK (tip_amount > 0),
  is_test       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, seat_key)
);

CREATE INDEX IF NOT EXISTS table_tips_restaurant_idx ON public.table_tips (restaurant_id, created_at DESC);

COMMENT ON TABLE public.table_tips IS
  'Чаевые, выбранные гостем в окне оплаты. is_test = true — оплата была заглушкой, это намерение, а не полученные деньги.';

-- Прямой доступ закрыт: пишет только record_table_tip, читает сервер (service_role).
ALTER TABLE public.table_tips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.table_tips FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_table_tip(
  p_restaurant_id uuid,
  p_table_number  text,
  p_seat_numbers  integer[],
  p_kind          text,
  p_value         integer
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_table_id uuid;
  v_seats    integer[];
  v_bill     integer;
  v_tip      integer;
  v_waiters  uuid[];
BEGIN
  IF p_seat_numbers IS NULL OR array_length(p_seat_numbers, 1) IS NULL THEN
    RAISE EXCEPTION 'Не выбрано ни одного места';
  END IF;

  IF p_kind = 'fixed' THEN
    IF p_value IS NULL OR p_value NOT IN (100, 200, 300, 500, 1000) THEN
      RAISE EXCEPTION 'Недопустимая сумма чаевых';
    END IF;
  ELSIF p_kind = 'percent' THEN
    IF p_value IS NULL OR p_value NOT IN (3, 5, 10, 15) THEN
      RAISE EXCEPTION 'Недопустимый процент чаевых';
    END IF;
  ELSE
    RAISE EXCEPTION 'Недопустимый вид чаевых';
  END IF;

  SELECT id, table_id INTO v_order_id, v_table_id
  FROM public.orders
  WHERE restaurant_id = p_restaurant_id
    AND table_number = p_table_number
    AND status IN ('new', 'cooking')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Активный заказ для этого стола не найден';
  END IF;

  SELECT array_agg(DISTINCT s ORDER BY s) INTO v_seats FROM unnest(p_seat_numbers) AS s;

  -- Чек выбранных мест — по данным сервера, а не из браузера.
  SELECT COALESCE(sum(b.line_total), 0)::integer INTO v_bill
  FROM public.get_table_bill(p_restaurant_id, p_table_number) b
  WHERE b.seat_number = ANY (v_seats);

  IF v_bill <= 0 THEN
    RAISE EXCEPTION 'По выбранным местам нет позиций к оплате';
  END IF;

  v_tip := CASE WHEN p_kind = 'fixed' THEN p_value ELSE round(v_bill * p_value / 100.0)::integer END;
  IF v_tip <= 0 THEN
    RAISE EXCEPTION 'Чаевые получились нулевыми';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT a.waiter_id), '{}') INTO v_waiters
  FROM public.waiter_table_assignments a
  WHERE a.table_id = v_table_id
    AND (a.is_permanent OR a.assigned_date = current_date);

  INSERT INTO public.table_tips
    (restaurant_id, order_id, table_number, seat_numbers, seat_key, waiter_ids,
     bill_amount, tip_kind, tip_value, tip_amount)
  VALUES
    (p_restaurant_id, v_order_id, p_table_number, v_seats, array_to_string(v_seats, ','), v_waiters,
     v_bill, p_kind, p_value, v_tip)
  ON CONFLICT (order_id, seat_key) DO UPDATE SET
    waiter_ids  = EXCLUDED.waiter_ids,
    bill_amount = EXCLUDED.bill_amount,
    tip_kind    = EXCLUDED.tip_kind,
    tip_value   = EXCLUDED.tip_value,
    tip_amount  = EXCLUDED.tip_amount,
    created_at  = now();

  RETURN v_tip;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_table_tip(uuid, text, integer[], text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_table_tip(uuid, text, integer[], text, integer) TO anon, authenticated, service_role;

COMMIT;
