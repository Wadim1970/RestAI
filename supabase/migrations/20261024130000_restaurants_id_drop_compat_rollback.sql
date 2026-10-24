-- Откат 20261024130000: вернуть переходную колонку.
BEGIN;
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS "restaurantId" uuid GENERATED ALWAYS AS (id) STORED;
COMMIT;
NOTIFY pgrst, 'reload schema';
