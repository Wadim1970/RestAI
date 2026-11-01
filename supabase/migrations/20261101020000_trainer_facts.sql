-- ============================================================
-- Тренажёр официанта: факты о блюдах и журнал подтверждений
-- (контент-студия, этап 1 тренажёра).
--
--  1. trn_dish_facts — факт о блюде (масса, состав, аллергены, соус…).
--     Единица обучения — факт, а не блюдо. В тренажёр попадают только
--     status = 'confirmed'. Значение — jsonb, форма зависит от fact_type
--     (проверяет код: api/_lib/trainerFactsCore.js).
--       source        — откуда значение: menu (из menu_items), ai (черновик
--                       модели), manual (ввёл шеф).
--       source_hash   — отпечаток данных меню, из которых получен факт.
--                       Меню изменилось → отпечаток не совпал → подтверждённый
--                       факт возвращается в draft (review_note = 'menu_changed').
--       review_note   — почему факту нужна повторная проверка.
--       confirmed_by  — имя подтвердившего. ВНИМАНИЕ: пока в админке нет входа,
--                       это имя, введённое в студии, и оно не проверено.
--  2. trn_fact_audit_log — журнал: кто, когда, что и с каким значением
--     сделал с фактом. Только добавление строк (код не делает UPDATE/DELETE).
--  3. Доступ только у сервера (service_role) — как у остальных админских
--     таблиц; официант получит свой срез отдельными функциями позже.
--
-- Запускать на сервере базы из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261101020000_trainer_facts.sql
-- Откат: 20261101020000_trainer_facts_rollback.sql (данные фактов пропадут).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.trn_dish_facts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  dish_id       uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  fact_type     text NOT NULL CHECK (fact_type IN (
    'weight', 'cooking_time_min', 'ingredients', 'allergens', 'may_contain', 'sauce',
    'doneness_recommended', 'gluten_free_possible', 'dairy_free_possible',
    'modifications', 'wine_pairing', 'flavor_profile', 'guest_description'
  )),
  value         jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'rejected')),
  source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('menu', 'ai', 'manual')),
  source_hash   text,
  review_note   text,
  confirmed_by  text,
  confirmed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dish_id, fact_type),
  CHECK (status <> 'confirmed' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS trn_dish_facts_restaurant_idx ON public.trn_dish_facts (restaurant_id, status);

CREATE TABLE IF NOT EXISTS public.trn_fact_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  dish_id       uuid,
  fact_type     text NOT NULL,
  action        text NOT NULL CHECK (action IN (
    'seed', 'edit', 'confirm', 'reject', 'reset', 'ai_draft', 'menu_changed', 'menu_refresh', 'batch_confirm'
  )),
  actor         text NOT NULL,
  old_status    text,
  new_status    text,
  old_value     jsonb,
  new_value     jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trn_fact_audit_dish_idx ON public.trn_fact_audit_log (restaurant_id, dish_id, created_at DESC);

COMMENT ON TABLE public.trn_dish_facts IS
  'Факты о блюдах для тренажёра. В обучение идут только confirmed. Изменение меню возвращает факт в draft.';
COMMENT ON TABLE public.trn_fact_audit_log IS
  'Журнал подтверждений фактов (кто, когда, что). Только добавление.';

ALTER TABLE public.trn_dish_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trn_fact_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trn_dish_facts FROM anon, authenticated;
REVOKE ALL ON public.trn_fact_audit_log FROM anon, authenticated;

COMMIT;
