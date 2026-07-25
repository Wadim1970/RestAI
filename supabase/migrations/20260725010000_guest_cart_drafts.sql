-- ============================================================
-- Черновики корзины гостя: официант видит, что гости набирают, ещё ДО
-- отправки заказа на кухню.
--
-- ЗАЧЕМ:
--   Корзина гостя до «Отправить заказ» живёт только у него в браузере
--   (localStorage) — в БД её нет. Официант, открывая «занятый» стол, не
--   видит ничего, пока заказ не отправлен. Нужно:
--     1) хранить корзину каждого устройства-гостя (guest_cart_drafts);
--     2) гость шлёт её по мере набора (sync_guest_cart);
--     3) официант читает корзины по столу (get_table_cart_drafts);
--     4) при авто-освобождении стола черновики чистятся.
--
--   Черновики — ОТДЕЛЬНО от order_items, чтобы не портить суммы/счёт: в
--   order_items попадают только реально отправленные блюда (place_guest_order,
--   status='sent'). Отправив заказ, гость обнуляет корзину → sync_guest_cart
--   с пустым списком очищает его черновик, а сами блюда уже в order_items.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260725010000_guest_cart_drafts.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Таблица черновиков: одна строка на устройство-гостя в рамках сессии
--    стола. items — массив {item_id, quantity, comment?, modifiers?[uuid...]}
--    (та же форма, что p_items в place_guest_order).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_cart_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE CASCADE,
  table_id      uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  device_id     text NOT NULL,
  seat_number   integer NOT NULL,
  items         jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_guest_cart_drafts_table   ON public.guest_cart_drafts(table_id);
CREATE INDEX IF NOT EXISTS idx_guest_cart_drafts_session ON public.guest_cart_drafts(session_id);

-- Прямого доступа к таблице нет ни у кого — только через SECURITY DEFINER
-- функции ниже (они выполняются от владельца и обходят RLS).
ALTER TABLE public.guest_cart_drafts ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 2. sync_guest_cart — гость шлёт текущую корзину. Регистрирует устройство
--    как гостя (даже с пустой корзиной — сразу после скана QR), обновляет
--    содержимое и держит table_sessions.guest_count = числу устройств.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_guest_cart(
  p_restaurant_id uuid,
  p_table_number  text,
  p_device_id     text,
  p_items         jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (session_id uuid, seat_number integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_id   uuid;
  v_session_id uuid;
  v_seat       integer;
BEGIN
  IF p_table_number IS NULL OR btrim(p_table_number) = '' OR p_table_number = 'null' THEN
    RAISE EXCEPTION 'Не удалось определить номер стола';
  END IF;
  IF p_device_id IS NULL OR btrim(p_device_id) = '' THEN
    RAISE EXCEPTION 'Не удалось определить устройство гостя';
  END IF;

  SELECT t.id INTO v_table_id
  FROM public.tables t
  WHERE t.restaurant_id = p_restaurant_id
    AND t.number = p_table_number::integer
    AND t.is_active = true;
  IF v_table_id IS NULL THEN
    RAISE EXCEPTION 'Стол % не найден для этого ресторана', p_table_number;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_table_id::text, 0));

  -- get-or-create активную сессию (как mark_table_occupied)
  SELECT ts.id INTO v_session_id
  FROM public.table_sessions ts
  WHERE ts.table_id = v_table_id AND ts.is_active = true
  LIMIT 1;
  IF v_session_id IS NULL THEN
    INSERT INTO public.table_sessions (table_id, restaurant_id, status, is_active, started_at)
    VALUES (v_table_id, p_restaurant_id, 'occupied', true, now())
    RETURNING id INTO v_session_id;
  END IF;

  -- upsert черновика этого устройства
  SELECT d.seat_number INTO v_seat
  FROM public.guest_cart_drafts d
  WHERE d.session_id = v_session_id AND d.device_id = p_device_id;

  IF v_seat IS NULL THEN
    SELECT COALESCE(MAX(d.seat_number), 0) + 1 INTO v_seat
    FROM public.guest_cart_drafts d
    WHERE d.session_id = v_session_id;

    INSERT INTO public.guest_cart_drafts
      (session_id, table_id, restaurant_id, device_id, seat_number, items, updated_at)
    VALUES
      (v_session_id, v_table_id, p_restaurant_id, p_device_id, v_seat, COALESCE(p_items, '[]'::jsonb), now());
  ELSE
    UPDATE public.guest_cart_drafts
    SET items = COALESCE(p_items, '[]'::jsonb), updated_at = now()
    WHERE session_id = v_session_id AND device_id = p_device_id;
  END IF;

  -- guest_count = число зарегистрированных устройств (гостей) в сессии
  UPDATE public.table_sessions
  SET guest_count = (SELECT COUNT(*) FROM public.guest_cart_drafts WHERE session_id = v_session_id)
  WHERE id = v_session_id;

  RETURN QUERY SELECT v_session_id, v_seat;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_guest_cart(uuid, text, text, jsonb) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 3. get_table_cart_drafts — официант читает корзины гостей активной сессии
--    стола. Возвращает JSON: по одному объекту на место (гостя) с непустой
--    корзиной; блюда/модификаторы уже разрешены (имя, цена).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_table_cart_drafts(p_table_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id uuid;
  v_result     jsonb;
BEGIN
  SELECT id INTO v_session_id
  FROM public.table_sessions
  WHERE table_id = p_table_id AND is_active = true
  LIMIT 1;
  IF v_session_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(seat ORDER BY (seat->>'seat_number')::int), '[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'seat_number', d.seat_number,
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'item_id',   elem->>'item_id',
          'dish_name', mi.dish_name,
          'image_url', mi.image_url,
          'unit_price', mi.cost_rub,
          'quantity',  GREATEST(COALESCE((elem->>'quantity')::int, 1), 1),
          'comment',   NULLIF(elem->>'comment', ''),
          'modifiers', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('name', m.name, 'price_delta', COALESCE(m.price_delta, 0)))
            FROM jsonb_array_elements_text(COALESCE(elem->'modifiers', '[]'::jsonb)) AS mid
            JOIN public.modifiers m ON m.id = mid::uuid
          ), '[]'::jsonb)
        ))
        FROM jsonb_array_elements(d.items) AS elem
        JOIN public.menu_items mi ON mi.id = (elem->>'item_id')::uuid
      ), '[]'::jsonb)
    ) AS seat
    FROM public.guest_cart_drafts d
    WHERE d.session_id = v_session_id
      AND jsonb_array_length(d.items) > 0
  ) seats;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_table_cart_drafts(uuid) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 4. release_table_if_occupied — как раньше, но дополнительно чистит
--    черновики корзин при авто-освобождении «занятого» стола по таймеру.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_table_if_occupied(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done boolean := false;
BEGIN
  UPDATE public.table_sessions
  SET is_active = false, ended_at = now(), status = 'free'
  WHERE id = p_session_id
    AND is_active = true
    AND status = 'occupied';
  GET DIAGNOSTICS v_done = ROW_COUNT;

  IF v_done THEN
    DELETE FROM public.guest_cart_drafts WHERE session_id = p_session_id;
  END IF;

  RETURN v_done;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_table_if_occupied(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
