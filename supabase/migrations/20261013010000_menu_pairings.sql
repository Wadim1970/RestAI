-- ============================================================
-- Пары блюд для гостевого меню: «к пицце Пепперони отлично подходит салат
-- с бурратой». Гость кладёт блюдо в заказ — снизу выезжает подсказка с парой.
--
-- menu_pairings       — сами пары. Составляет нейросеть раз в сутки / при
--                       изменении меню (Waiter-app: api/pairings/generate.js),
--                       менеджер правит в админке (api/pairings/admin.js).
--                       source: ai | manual; status: active | disabled.
--                       Выключенная менеджером пара при перерасчёте не вернётся.
-- menu_pairing_state  — по ресторану: хэш меню, когда и чем закончился расчёт.
-- ai_suggestion_events — + канал, устройство гостя и «к какому блюду» пара:
--                       показы/ответы гостя в меню идут в ту же таблицу
--                       самообучения, что и подсказки официанту.
--
-- Гостевое /api/menu читает активные пары анонимным ключом (пары и так видит
-- любой гость). Пишет только сервер под service_role.
--
-- Идемпотентно. Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20261013010000_menu_pairings.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.menu_pairings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  dish_id       uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  pair_dish_id  uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  rank          smallint NOT NULL DEFAULT 1,
  lead          text NOT NULL,   -- «К пицце Пепперони отлично подходит салат с бурратой»
  reason        text NOT NULL,   -- «Сливочная буррата смягчит остроту колбасок»
  source        text NOT NULL DEFAULT 'ai'     CHECK (source IN ('ai', 'manual')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_pairings_distinct CHECK (dish_id <> pair_dish_id),
  CONSTRAINT menu_pairings_uniq UNIQUE (dish_id, pair_dish_id)
);

CREATE INDEX IF NOT EXISTS menu_pairings_rest_idx ON public.menu_pairings (restaurant_id, status);

ALTER TABLE public.menu_pairings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS menu_pairings_read_active ON public.menu_pairings;
CREATE POLICY menu_pairings_read_active ON public.menu_pairings
  FOR SELECT TO anon, authenticated
  USING (status = 'active');

GRANT SELECT ON public.menu_pairings TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.menu_pairing_state (
  restaurant_id uuid PRIMARY KEY,
  status        text,            -- running | done | partial | error
  menu_hash     text,
  started_at    timestamptz,
  generated_at  timestamptz,
  pair_count    integer,
  error         text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.menu_pairing_state ENABLE ROW LEVEL SECURITY;

-- Показы подсказки гостю в меню — в общую таблицу самообучения.
ALTER TABLE public.ai_suggestion_events
  ADD COLUMN IF NOT EXISTS channel        text,   -- waiter | guest_menu
  ADD COLUMN IF NOT EXISTS anchor_dish_id uuid,   -- к какому блюду предложили пару
  ADD COLUMN IF NOT EXISTS device_id      text,   -- устройство гостя
  ADD COLUMN IF NOT EXISTS personal       boolean;-- текст подобран под гостя

CREATE INDEX IF NOT EXISTS ai_sugg_ev_pair_idx
  ON public.ai_suggestion_events (restaurant_id, anchor_dish_id, dish_id, outcome)
  WHERE channel = 'guest_menu';

-- accepted — «Добавить», rejected — «Нет, спасибо» или тап мимо шторки.
CREATE OR REPLACE FUNCTION public.log_menu_pairing_event(
  p_restaurant_id  uuid,
  p_device_id      text,
  p_anchor_dish_id uuid,
  p_dish_id        uuid,
  p_outcome        text,
  p_personal       boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('accepted', 'rejected', 'ignored') THEN
    RAISE EXCEPTION 'invalid outcome: %', p_outcome;
  END IF;
  -- Логируем только настоящие пары этого ресторана — чтобы таблицу нельзя
  -- было засорить произвольными строками с анонимного ключа.
  IF NOT EXISTS (
    SELECT 1 FROM public.menu_pairings
    WHERE restaurant_id = p_restaurant_id AND dish_id = p_anchor_dish_id AND pair_dish_id = p_dish_id
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.ai_suggestion_events (
    restaurant_id, dish_id, anchor_dish_id, device_id, channel, tag, technique,
    source, personal, outcome
  ) VALUES (
    p_restaurant_id, p_dish_id, p_anchor_dish_id, left(p_device_id, 200), 'guest_menu',
    'menu_pairing', 'taste_pairing', 'pairing', COALESCE(p_personal, false), p_outcome
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_menu_pairing_event(uuid, text, uuid, uuid, text, boolean)
  TO anon, authenticated, service_role;

COMMIT;
