-- ============================================================
-- Сид модификаторов для стейков Сыроварни.
--
-- ЗАЧЕМ:
--   У блюд «Стейк Рибай» и «Медальоны филе-миньон» должны быть модификаторы:
--     • Прожарка (обязательный выбор, без наценки),
--     • Соус (не обязательно, с наценкой),
--     • Гарнир (не обязательно, с наценкой).
--   Таблицы modifier_groups / modifiers уже существуют (их читают приложение
--   официанта и get_restaurant_modifiers для гостя), но данных по этим блюдам
--   нет. Заполняем.
--
-- ЗАЩИТНО:
--   • Все колонки, которые заполняем, гарантированно есть — их выбирает
--     рабочая функция get_restaurant_modifiers (id, item_id/group_id, name,
--     type, required, is_available, price_delta, sort_order).
--   • id задаём явно (gen_random_uuid) — не зависим от DEFAULT.
--   • Значение type определяем по факту: если колонка nullable — пишем NULL
--     (так не нарушим возможный CHECK и это функционально всё равно не важно,
--     приложение трактует все группы как выбор одной опции); если NOT NULL —
--     ставим 'single'.
--   • Идемпотентно: если у блюда уже есть группа с таким именем — пропускаем.
--   • Всё в транзакции: любая неожиданность откатит миграцию целиком.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260728010000_seed_modifiers.sql
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_rest          uuid := 'dd89773c-0952-4fd1-9510-514094a928ee'; -- Сыроварня
  v_type_nullable boolean;
  v_type          text;
  v_dishes        text[] := ARRAY['Стейк Рибай', 'Медальоны филе-миньон'];
  v_dish          text;
  v_dish_id       uuid;
  v_group         jsonb;
  v_group_id      uuid;
  v_opt           jsonb;
  v_sort          integer;
  -- Спецификация групп и опций (name, required, options[name, price]).
  v_spec jsonb := '[
    {"name": "Прожарка", "required": true, "options": [
      {"name": "С кровью (Rare)",              "price": 0},
      {"name": "Слабая (Medium Rare)",         "price": 0},
      {"name": "Средняя (Medium)",             "price": 0},
      {"name": "Почти прожаренный (Medium Well)", "price": 0},
      {"name": "Прожаренный (Well Done)",      "price": 0}
    ]},
    {"name": "Соус", "required": false, "options": [
      {"name": "Перечный",   "price": 150},
      {"name": "Грибной",    "price": 150},
      {"name": "Чимичурри",  "price": 150},
      {"name": "Барбекю",    "price": 120}
    ]},
    {"name": "Гарнир", "required": false, "options": [
      {"name": "Картофель фри",       "price": 200},
      {"name": "Овощи гриль",         "price": 250},
      {"name": "Картофельное пюре",   "price": 180},
      {"name": "Свежий салат",        "price": 200}
    ]}
  ]'::jsonb;
BEGIN
  -- Безопасное значение type: NULL, если колонка допускает NULL.
  SELECT (is_nullable = 'YES') INTO v_type_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'modifier_groups' AND column_name = 'type';

  v_type := CASE WHEN COALESCE(v_type_nullable, true) THEN NULL ELSE 'single' END;

  FOREACH v_dish IN ARRAY v_dishes LOOP
    SELECT id INTO v_dish_id
    FROM public.menu_items
    WHERE restaurant_id = v_rest
      AND lower(btrim(dish_name)) = lower(v_dish)
    LIMIT 1;

    IF v_dish_id IS NULL THEN
      RAISE EXCEPTION 'Блюдо "%" не найдено в ресторане % — проверьте название/ресторан', v_dish, v_rest;
    END IF;

    FOR v_group IN SELECT * FROM jsonb_array_elements(v_spec) LOOP
      -- Идемпотентность: если группа с таким именем у блюда уже есть — пропускаем.
      IF EXISTS (
        SELECT 1 FROM public.modifier_groups
        WHERE item_id = v_dish_id AND lower(btrim(name)) = lower(v_group->>'name')
      ) THEN
        CONTINUE;
      END IF;

      v_group_id := gen_random_uuid();
      INSERT INTO public.modifier_groups (id, item_id, name, type, required, sort_order)
      VALUES (
        v_group_id,
        v_dish_id,
        v_group->>'name',
        v_type,
        (v_group->>'required')::boolean,
        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.modifier_groups WHERE item_id = v_dish_id)
      );

      v_sort := 0;
      FOR v_opt IN SELECT * FROM jsonb_array_elements(v_group->'options') LOOP
        v_sort := v_sort + 1;
        INSERT INTO public.modifiers (id, group_id, name, price_delta, is_available, sort_order)
        VALUES (
          gen_random_uuid(),
          v_group_id,
          v_opt->>'name',
          (v_opt->>'price')::numeric,
          true,
          v_sort
        );
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
