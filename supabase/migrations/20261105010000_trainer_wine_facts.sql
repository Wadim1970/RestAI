-- ============================================================
-- Тренажёр: два новых типа фактов — сорта винограда и год урожая вина.
--
-- Расширяет допустимые значения trn_dish_facts.fact_type (CHECK). Данные не меняются.
-- ПОРЯДОК: применить ДО выкладки Waiter-app с поддержкой фактов вина — иначе
-- синхронизация контент-студии начнёт создавать факты, которых база не примет.
--
-- Запускать на сервере базы из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261105010000_trainer_wine_facts.sql
-- Откат: 20261105010000_trainer_wine_facts_rollback.sql (факты вина удаляются).
-- ============================================================

BEGIN;

DO $do$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.trn_dish_facts'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%fact_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.trn_dish_facts DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $do$;

ALTER TABLE public.trn_dish_facts ADD CONSTRAINT trn_dish_facts_fact_type_check CHECK (fact_type IN (
  'weight', 'cooking_time_min', 'ingredients', 'allergens', 'may_contain', 'sauce',
  'doneness_recommended', 'gluten_free_possible', 'dairy_free_possible',
  'modifications', 'wine_pairing', 'flavor_profile', 'guest_description',
  'wine_grape', 'wine_vintage'
));

COMMIT;
