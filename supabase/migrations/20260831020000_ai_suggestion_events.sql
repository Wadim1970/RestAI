-- ============================================================
-- Лог событий ИИ-подсказок официанту — фундамент самообучающейся модели.
--
-- Пишем ИСХОД каждой показанной подсказки: официант принял её («В корзину») или
-- отклонил («Другой вариант»), в каком контексте и КАКИМ приёмом продаж. На
-- этих данных дальше (Фаза C) обучается контекстный бандит: какой приём/блюдо
-- лучше конвертит для данного ресторана / официанта / сегмента гостя.
--
-- Поведение приложения не меняется — только сбор данных. Маржу тут НЕ храним
-- (она серверная, гостю/клиенту не видна) — при агрегации присоединим по
-- dish_id из menu_item_costing.
--
-- Пишет клиент официанта (анонимный ключ) через SECURITY DEFINER RPC — прямой
-- INSERT в таблицу закрыт RLS, как и у остальных вызовов (save_push_subscription).
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260831020000_ai_suggestion_events.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_suggestion_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  restaurant_id     uuid,
  waiter_id         uuid,
  order_id          uuid,
  seat              integer,
  dish_id           uuid,
  category          text,        -- main | alco | soft | dessert | null
  tag               text,        -- тег помощника (к заказу / закуски-салаты / …)
  stage             text,        -- S1 (корзина пуста) / S2 (есть заказ)
  technique         text,        -- taste_pairing | social_proof | choice_no_choice | scarcity
  source            text,        -- llm | fallback
  guest_gender      text,
  guest_age         text,
  guest_occasion    text,
  guest_party_size  integer,
  has_preferences   boolean,
  outcome           text NOT NULL -- accepted | rejected | ignored
);

CREATE INDEX IF NOT EXISTS ai_sugg_ev_rest_idx ON public.ai_suggestion_events (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_sugg_ev_tech_idx ON public.ai_suggestion_events (restaurant_id, technique, outcome);
CREATE INDEX IF NOT EXISTS ai_sugg_ev_waiter_idx ON public.ai_suggestion_events (restaurant_id, waiter_id, outcome);

-- Прямой доступ закрыт: пишем только через RPC ниже.
ALTER TABLE public.ai_suggestion_events ENABLE ROW LEVEL SECURITY;

-- Логирование исхода. Возвращает id вставленной строки (пригодится, если позже
-- захотим дописывать финальный сигнал — попало ли блюдо в отправленный заказ).
CREATE OR REPLACE FUNCTION public.log_ai_suggestion_event(
  p_restaurant_id uuid,
  p_waiter_id     uuid,
  p_order_id      uuid,
  p_seat          integer,
  p_dish_id       uuid,
  p_category      text,
  p_tag           text,
  p_stage         text,
  p_technique     text,
  p_source        text,
  p_guest         jsonb,
  p_outcome       text
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

  INSERT INTO public.ai_suggestion_events (
    restaurant_id, waiter_id, order_id, seat, dish_id, category, tag, stage,
    technique, source, guest_gender, guest_age, guest_occasion, guest_party_size,
    has_preferences, outcome
  ) VALUES (
    p_restaurant_id, p_waiter_id, p_order_id, p_seat, p_dish_id, p_category, p_tag, p_stage,
    NULLIF(p_technique, ''), NULLIF(p_source, ''),
    NULLIF(p_guest->>'gender', ''), NULLIF(p_guest->>'age', ''), NULLIF(p_guest->>'occasion', ''),
    NULLIF(p_guest->>'partySize', '')::int,
    COALESCE((p_guest->>'hasPreferences')::boolean, false),
    p_outcome
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_ai_suggestion_event(
  uuid, uuid, uuid, integer, uuid, text, text, text, text, text, jsonb, text
) TO anon, authenticated, service_role;

COMMIT;
