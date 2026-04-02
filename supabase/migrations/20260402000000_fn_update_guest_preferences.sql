-- ============================================================
-- Функция: обновляет preferences гостя после оформления заказа
-- ============================================================
CREATE OR REPLACE FUNCTION update_guest_preferences_on_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_dish_ids   UUID[];
  v_all_tags   TEXT[];
  v_tag        TEXT;
  v_comment    TEXT;
  v_prefs      JSONB;
  v_tags_obj   JSONB;
  v_comments   JSONB;
  v_cur_count  INT;
BEGIN
  -- Если у заказа нет гостя — пропускаем
  IF NEW.guest_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 1. Извлекаем dish_id (UUID) из JSONB-массива items
  SELECT ARRAY(
    SELECT (item->>'dish_id')::UUID
    FROM jsonb_array_elements(NEW.items) AS item
    WHERE item->>'dish_id' IS NOT NULL
  ) INTO v_dish_ids;

  -- 2. Собираем все теги из menu_items для заказанных блюд
  SELECT ARRAY(
    SELECT UNNEST(mi.tags)
    FROM menu_items mi
    WHERE mi.id = ANY(v_dish_ids)
      AND array_length(mi.tags, 1) > 0
  ) INTO v_all_tags;

  -- 3. Читаем текущие preferences гостя
  --    Если там пустой массив [] или NULL — инициализируем объект
  SELECT
    CASE
      WHEN g.preferences IS NULL
        OR g.preferences = '[]'::jsonb
        OR jsonb_typeof(g.preferences) = 'array'
      THEN '{"tags": {}, "comments": []}'::jsonb
      ELSE g.preferences
    END
  INTO v_prefs
  FROM guests g
  WHERE g.id = NEW.guest_id;

  -- Страховка: если гость вдруг не найден
  IF v_prefs IS NULL THEN
    v_prefs := '{"tags": {}, "comments": []}'::jsonb;
  END IF;

  -- 4. Достаём вложенные объекты
  v_tags_obj := COALESCE(v_prefs->'tags', '{}'::jsonb);
  v_comments := COALESCE(v_prefs->'comments', '[]'::jsonb);

  -- 5. Увеличиваем счётчики тегов
  IF v_all_tags IS NOT NULL AND array_length(v_all_tags, 1) > 0 THEN
    FOREACH v_tag IN ARRAY v_all_tags LOOP
      -- Пропускаем пустые теги
      IF v_tag IS NOT NULL AND TRIM(v_tag) <> '' THEN
        v_cur_count := COALESCE((v_tags_obj->>v_tag)::INT, 0);
        v_tags_obj  := jsonb_set(v_tags_obj, ARRAY[v_tag], to_jsonb(v_cur_count + 1));
      END IF;
    END LOOP;
  END IF;

  -- 6. Сохраняем комментарий к заказу (если он не пустой)
  v_comment := TRIM(COALESCE(NEW.comment, ''));
  IF v_comment <> '' THEN
    v_comments := v_comments || to_jsonb(v_comment);
  END IF;

  -- 7. Собираем итоговый объект preferences
  v_prefs := jsonb_build_object(
    'tags',       v_tags_obj,
    'comments',   v_comments,
    'updated_at', to_jsonb(NOW()::TEXT)
  );

  -- 8. Записываем обратно в guests
  UPDATE guests
  SET preferences = v_prefs
  WHERE id = NEW.guest_id;

  RETURN NEW;
END;
$$;

-- ============================================================
-- Триггер: запускает функцию после каждого нового заказа
-- ============================================================
CREATE OR REPLACE TRIGGER trg_update_guest_preferences
AFTER INSERT ON orders
FOR EACH ROW
EXECUTE FUNCTION update_guest_preferences_on_order();
