-- Откат 20261024030000_waiters_drop_legacy_columns.sql: колонки возвращаются
-- и заполняются из restaurant_staff (активная запись, иначе последняя).
BEGIN;
ALTER TABLE public.waiters
  ADD COLUMN employment_type text
    CHECK (employment_type = ANY (ARRAY['permanent', 'freelance'])),
  ADD COLUMN restaurant_id uuid,
  ADD COLUMN role text
    CHECK (role = ANY (ARRAY['waiter', 'senior_waiter', 'manager'])),
  ADD COLUMN hire_date date,
  ADD COLUMN dismissal_date date;

UPDATE public.waiters w
SET restaurant_id = s.restaurant_id, role = s.role, hire_date = s.hire_date, dismissal_date = s.dismissal_date,
    employment_type = 'permanent'
FROM (
  SELECT DISTINCT ON (waiter_id) waiter_id, restaurant_id, role, hire_date, dismissal_date
  FROM public.restaurant_staff
  ORDER BY waiter_id, dismissal_date IS NULL DESC, hire_date DESC
) s
WHERE s.waiter_id = w.id;

UPDATE public.waiters SET employment_type = 'freelance' WHERE employment_type IS NULL;
ALTER TABLE public.waiters ALTER COLUMN employment_type SET NOT NULL;
COMMIT;
NOTIFY pgrst, 'reload schema';
