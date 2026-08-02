-- ============================================================
-- ROLLBACK для 20260728010000_seed_modifiers.sql
--   Удаляет только засеянные группы (Прожарка/Соус/Гарнир) и их опции
--   у блюд «Стейк Рибай» и «Медальоны филе-миньон» в Сыроварне. Чужих
--   модификаторов не трогает.
--
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260728010000_seed_modifiers_rollback.sql
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_rest  uuid := 'dd89773c-0952-4fd1-9510-514094a928ee'; -- Сыроварня
BEGIN
  -- Сначала опции (modifiers), затем сами группы.
  DELETE FROM public.modifiers m
  USING public.modifier_groups g, public.menu_items mi
  WHERE m.group_id = g.id
    AND g.item_id = mi.id
    AND mi.restaurant_id = v_rest
    AND lower(btrim(mi.dish_name)) IN (lower('Стейк Рибай'), lower('Медальоны филе-миньон'))
    AND lower(btrim(g.name)) = ANY (ARRAY['прожарка', 'соус', 'гарнир']);

  DELETE FROM public.modifier_groups g
  USING public.menu_items mi
  WHERE g.item_id = mi.id
    AND mi.restaurant_id = v_rest
    AND lower(btrim(mi.dish_name)) IN (lower('Стейк Рибай'), lower('Медальоны филе-миньон'))
    AND lower(btrim(g.name)) = ANY (ARRAY['прожарка', 'соус', 'гарнир']);
END $$;

COMMIT;
