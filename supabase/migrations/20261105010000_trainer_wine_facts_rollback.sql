-- Откат 20261105010000_trainer_wine_facts.sql. Факты вина (сорта, год) удаляются без возврата.
BEGIN;

DELETE FROM public.trn_dish_facts WHERE fact_type IN ('wine_grape', 'wine_vintage');

ALTER TABLE public.trn_dish_facts DROP CONSTRAINT IF EXISTS trn_dish_facts_fact_type_check;
ALTER TABLE public.trn_dish_facts ADD CONSTRAINT trn_dish_facts_fact_type_check CHECK (fact_type IN (
  'weight', 'cooking_time_min', 'ingredients', 'allergens', 'may_contain', 'sauce',
  'doneness_recommended', 'gluten_free_possible', 'dairy_free_possible',
  'modifications', 'wine_pairing', 'flavor_profile', 'guest_description'
));

COMMIT;
