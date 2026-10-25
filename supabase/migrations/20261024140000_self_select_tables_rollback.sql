-- Откат 20261024140000_self_select_tables.sql.
-- Выбранные официантами столы (source = 'self') при откате удаляются.
BEGIN;

DROP FUNCTION IF EXISTS public.set_my_table(uuid, boolean);
DELETE FROM public.waiter_table_assignments WHERE source = 'self';
DROP INDEX IF EXISTS public.wta_self_unique_idx;
ALTER TABLE public.waiter_table_assignments DROP COLUMN IF EXISTS source;

-- Прежняя защита закрепления (20261024020000).
CREATE OR REPLACE FUNCTION public.fn_assignment_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  r uuid;
BEGIN
  SELECT restaurant_id INTO r FROM public.tables WHERE id = NEW.table_id;
  IF r IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.restaurant_staff s
              WHERE s.waiter_id = NEW.waiter_id AND s.restaurant_id = r AND s.dismissal_date IS NULL)
     OR EXISTS (SELECT 1 FROM public.staff_shifts sh
                 WHERE sh.waiter_id = NEW.waiter_id AND sh.restaurant_id = r)
     OR EXISTS (SELECT 1 FROM public.bookings b JOIN public.jobs j ON j.id = b.job_id
                 WHERE b.worker_id = NEW.waiter_id AND j.restaurant_id = r
                   AND b.status IN ('approved', 'confirmed'))
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Официант не связан с рестораном этого стола (нет ни штатной записи, ни смены, ни брони)'
    USING ERRCODE = 'check_violation';
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_assignment_guard() FROM PUBLIC, anon, authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
