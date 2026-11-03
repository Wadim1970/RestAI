-- Откат 20261101020000_trainer_facts.sql. Факты и журнал удаляются без возврата.
BEGIN;
DROP TABLE IF EXISTS public.trn_fact_audit_log;
DROP TABLE IF EXISTS public.trn_dish_facts;
COMMIT;
