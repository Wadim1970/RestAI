-- ============================================================
-- Phase 0 данных для AI-коуча официанта.
--
-- ЗАЧЕМ:
--   Ассистенту нужны три вещи, которых в БД нет:
--     1) menu_item_costing — себестоимость и МАРЖА блюда (чтобы «толкать»
--        выгодное). iiko/r_keeper отдают себестоимость (из техкарт), маржу
--        считаем сами → margin_* сделаны ГЕНЕРИРУЕМЫМИ колонками, БД держит
--        их согласованными. Поля повторяют то, что даёт POS (self_cost,
--        cost_method, source, external_id) — потом синк = маппинг, не переделка.
--     2) dish_daily_flags — «истекает / спец дня / стоп-лист (86)» на дату.
--     3) waiter_ai_suggestions — лог подсказок и исходов (аналитика,
--        «не повторять отказ»).
--
--   Данные — тестовые (ресторан Сыроварня). Себестоимость проставляется от
--   цены по реалистичному food-cost % на категорию (стейки ~38%, рыба ~34%,
--   салаты/овощи ~24%, сыры ~33%, десерты ~22%, кофе/чай ~12%, б/алк напитки
--   ~18%, алкоголь ~32%, прочее ~30%). push_priority — по абсолютной прибыли,
--   фирменные стейки подняты вручную.
--
--   Доступ к таблицам — серверный (бэкенд официанта под service_role, он же
--   обходит RLS). Клиент официанта себестоимость напрямую не читает.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260802010000_ai_waiter_costing.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Костинг блюда (1:1 к menu_items). margin_* — генерируемые.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.menu_item_costing (
  dish_id        uuid PRIMARY KEY REFERENCES public.menu_items(id) ON DELETE CASCADE,
  restaurant_id  uuid,                                   -- денормализация под быстрые выборки по ресторану
  self_cost      numeric(12,2) NOT NULL DEFAULT 0,       -- себестоимость порции (iiko ССС/СПП · r_keeper)
  cost_method    text NOT NULL DEFAULT 'manual'
                   CHECK (cost_method IN ('avg_weighted','last_receipt','manual','calc')),
  sale_price     numeric(12,2) NOT NULL DEFAULT 0,       -- цена продажи (снимок cost_rub)
  margin_abs     numeric(12,2) GENERATED ALWAYS AS (sale_price - self_cost) STORED,
  margin_pct     numeric(6,4)  GENERATED ALWAYS AS
                   (CASE WHEN sale_price > 0 THEN round((sale_price - self_cost) / sale_price, 4) END) STORED,
  food_cost_pct  numeric(6,4)  GENERATED ALWAYS AS
                   (CASE WHEN sale_price > 0 THEN round(self_cost / sale_price, 4) END) STORED,
  push_priority  smallint NOT NULL DEFAULT 0 CHECK (push_priority BETWEEN 0 AND 3), -- ручной оверрайд «толкать»
  push_reason    text,                                   -- зачем толкать (для скрипта официанту)
  source         text NOT NULL DEFAULT 'manual'
                   CHECK (source IN ('iiko','rkeeper','manual','calc')),
  external_id    text,                                   -- GUID номенклатуры iiko / id StoreHouse (для синка)
  synced_at      timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_costing_restaurant ON public.menu_item_costing(restaurant_id);
ALTER TABLE public.menu_item_costing ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE  public.menu_item_costing IS 'Себестоимость и маржа блюда для AI-апсейла. margin_* генерируемые. Заполняется вручную / синком с iiko/r_keeper.';
COMMENT ON COLUMN public.menu_item_costing.food_cost_pct IS 'self_cost / sale_price — ключевой KPI кухни.';

-- ------------------------------------------------------------
-- 2. Флаги дня: истекает / спец / стоп-лист (86).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dish_daily_flags (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id        uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  restaurant_id  uuid,
  day            date NOT NULL DEFAULT current_date,
  flag           text NOT NULL CHECK (flag IN ('expiring','special','stop')),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dish_id, day, flag)
);
CREATE INDEX IF NOT EXISTS idx_daily_flags_lookup ON public.dish_daily_flags(restaurant_id, day);
ALTER TABLE public.dish_daily_flags ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.dish_daily_flags IS 'Суточные флаги блюда: expiring (последний день), special (спец дня), stop (86, закончилось).';

-- ------------------------------------------------------------
-- 3. Лог подсказок ассистента и их исходов.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.waiter_ai_suggestions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid,
  session_id     uuid,                 -- table_session
  order_id       uuid,
  seat_number    integer,
  worker_id      uuid,
  stage          text,                 -- S1..S6
  tag            text,                 -- по какому тегу предложено
  dish_id        uuid,
  pitch          text,                 -- сам скрипт, что показали
  outcome        text CHECK (outcome IS NULL OR outcome IN ('added','rejected','ignored')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_sugg_session    ON public.waiter_ai_suggestions(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_sugg_restaurant ON public.waiter_ai_suggestions(restaurant_id, created_at);
ALTER TABLE public.waiter_ai_suggestions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.waiter_ai_suggestions IS 'Что ассистент предложил и чем закончилось: аналитика конверсии + «не повторять отказ».';

-- ------------------------------------------------------------
-- 4. Сид костинга для Сыроварни (тестовые, но реалистичные данные).
--    Себестоимость = цена × food-cost% по категории (имя блюда + раздел +
--    product_type). ~* — регистронезависимый regex по кириллице.
-- ------------------------------------------------------------
INSERT INTO public.menu_item_costing (dish_id, restaurant_id, sale_price, self_cost, cost_method, source)
SELECT
  mi.id,
  mi.restaurant_id,
  mi.cost_rub,
  round(mi.cost_rub * (
    CASE
      WHEN COALESCE(mi.product_type,'') = 'alcohol'                                                     THEN 0.32
      WHEN (mi.dish_name || ' ' || COALESCE(mi.menu_section,'')) ~* '(стейк|рибай|миньон|говядин|мяс|бургер|ребра|каре|ягн|утк|телятин)' THEN 0.38
      WHEN (mi.dish_name || ' ' || COALESCE(mi.menu_section,'')) ~* '(рыб|сёмг|семг|лосос|форел|креветк|устриц|мидии|морепродукт|тунец|краб|осьминог)' THEN 0.34
      WHEN (mi.dish_name || ' ' || COALESCE(mi.menu_section,'')) ~* '(десерт|торт|чизкейк|мороженое|тирамису|пирог|панакота|наполеон)'  THEN 0.22
      WHEN (mi.dish_name || ' ' || COALESCE(mi.menu_section,'')) ~* '(суп|крем-суп|борщ|уха|солянк)'                                     THEN 0.26
      WHEN (mi.dish_name || ' ' || COALESCE(mi.menu_section,'')) ~* '(салат|овощ|веган|хумус|брускет|закуск)'                            THEN 0.24
      WHEN (mi.dish_name || ' ' || COALESCE(mi.menu_section,'')) ~* '(сыр|сыроварн|моцарел|халлуми|бри|качотт|страчател)'                THEN 0.33
      WHEN (mi.dish_name || ' ' || COALESCE(mi.menu_section,'')) ~* '(кофе|эспрессо|капучино|латте|раф|чай|какао)'                       THEN 0.12
      WHEN (mi.dish_name || ' ' || COALESCE(mi.menu_section,'')) ~* '(сок|лимонад|вода|морс|смузи|напиток|кола|тоник|компот)'            THEN 0.18
      ELSE 0.30
    END
  ), 2),
  'manual',
  'manual'
FROM public.menu_items mi
WHERE mi.restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee'
ON CONFLICT (dish_id) DO NOTHING;

-- push_priority по абсолютной прибыли (рубли с блюда)
UPDATE public.menu_item_costing c
SET push_priority = CASE
      WHEN c.margin_abs >= 900 THEN 3
      WHEN c.margin_abs >= 550 THEN 2
      WHEN c.margin_abs >= 300 THEN 1
      ELSE 0
    END,
    push_reason = CASE
      WHEN c.margin_abs >= 900 THEN 'Высокая прибыль с блюда'
      WHEN c.margin_abs >= 550 THEN 'Хорошая маржа'
      ELSE NULL
    END
WHERE c.restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee';

-- Фирменные стейки — толкаем всегда, с наставническим поводом
UPDATE public.menu_item_costing c
SET push_priority = 3,
    push_reason   = 'Фирменное, особенно хвалят гости'
FROM public.menu_items mi
WHERE mi.id = c.dish_id
  AND mi.restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee'
  AND mi.dish_name ~* '(рибай|миньон)';

-- ------------------------------------------------------------
-- 5. Пара флагов дня (тестовые). Вставятся, только если блюдо найдётся.
-- ------------------------------------------------------------
INSERT INTO public.dish_daily_flags (dish_id, restaurant_id, day, flag, note)
SELECT mi.id, mi.restaurant_id, current_date, 'expiring', 'Последний день реализации'
FROM public.menu_items mi
WHERE mi.restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee'
  AND mi.dish_name ~* '(сёмг|семг|лосос|форел)'
ON CONFLICT (dish_id, day, flag) DO NOTHING;

INSERT INTO public.dish_daily_flags (dish_id, restaurant_id, day, flag, note)
SELECT mi.id, mi.restaurant_id, current_date, 'special', 'Шеф рекомендует сегодня'
FROM public.menu_items mi
WHERE mi.restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee'
  AND mi.dish_name ~* 'рибай'
ON CONFLICT (dish_id, day, flag) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
