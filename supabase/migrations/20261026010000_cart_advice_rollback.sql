-- Откат 20261026010000_cart_advice.sql. Висящие вызовы «десерт» закрываются,
-- ручные роли блюд и согласия гостей на десерт будут потеряны.
BEGIN;
DROP TABLE IF EXISTS public.guest_dessert_reminders;
UPDATE public.waiter_calls SET status = 'cancelled' WHERE kind = 'dessert' AND status = 'pending';
DELETE FROM public.waiter_calls WHERE kind = 'dessert';
ALTER TABLE public.waiter_calls DROP CONSTRAINT IF EXISTS waiter_calls_kind_check;
ALTER TABLE public.waiter_calls ADD CONSTRAINT waiter_calls_kind_check CHECK (kind IN ('service', 'age_check'));
ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_course_role_check;
ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_meal_times_check;
ALTER TABLE public.menu_items DROP COLUMN IF EXISTS course_role, DROP COLUMN IF EXISTS meal_times;
COMMIT;
NOTIFY pgrst, 'reload schema';
