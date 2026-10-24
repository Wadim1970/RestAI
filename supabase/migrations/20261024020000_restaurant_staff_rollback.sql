-- Откат 20261024020000_restaurant_staff.sql.
-- Удалённые при очистке рестораны и заказы он НЕ возвращает — только из бэкапа.
-- Данные restaurant_staff теряются: перед откатом перенесите их в waiters
-- (restaurant_id, role, hire_date, dismissal_date), если там нужны штатные.
BEGIN;
DROP VIEW IF EXISTS public.waiter_restaurants;
DROP TRIGGER IF EXISTS trg_assignment_guard ON public.waiter_table_assignments;
DROP TRIGGER IF EXISTS trg_booking_guard ON public.bookings;
DROP FUNCTION IF EXISTS public.fn_assignment_guard();
DROP FUNCTION IF EXISTS public.fn_booking_guard();
DROP TABLE IF EXISTS public.restaurant_staff;
UPDATE public.waiters SET employment_type = 'freelance' WHERE employment_type IS NULL;
ALTER TABLE public.waiters ALTER COLUMN employment_type SET NOT NULL;
COMMIT;
NOTIFY pgrst, 'reload schema';
