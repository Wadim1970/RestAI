-- Откат 20261031010000_zones_staff.sql: убирает залы, отзывы ресторана о
-- фрилансерах и график смен. Столы из своих залов возвращаются в main,
-- прежнее ограничение «main / veranda / banquet» восстанавливается.

BEGIN;

DROP TABLE IF EXISTS public.staff_schedule;
DROP TABLE IF EXISTS public.waiter_reviews;
DROP TABLE IF EXISTS public.restaurant_zones;

UPDATE public.tables SET zone = 'main' WHERE zone IS NULL OR zone NOT IN ('main', 'veranda', 'banquet');
ALTER TABLE public.tables DROP CONSTRAINT IF EXISTS tables_zone_check;
ALTER TABLE public.tables ADD CONSTRAINT tables_zone_check CHECK (zone = ANY (ARRAY['main'::text, 'veranda'::text, 'banquet'::text]));

NOTIFY pgrst, 'reload schema';

COMMIT;
