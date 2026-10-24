-- ============================================================
-- Убрать из waiters колонки, которые теперь живут в restaurant_staff:
-- employment_type, restaurant_id, role, hire_date, dismissal_date.
--
-- ЗАПУСКАТЬ ТОЛЬКО ПОСЛЕ 20261024020000_restaurant_staff.sql и ПОСЛЕ выкладки
-- Waiter-app (api/_lib/staffService.js, hallService.js, server/src/gotrue.js
-- перестают читать и писать эти колонки). Раньше — старая версия приложения
-- упадёт на запросах к удалённым колонкам.
-- Откат: 20261024030000_waiters_drop_legacy_columns_rollback.sql
-- ============================================================

BEGIN;

DO $$
BEGIN
  -- Ничего не терять: у всех, у кого ресторан был в waiters, должна быть запись в штате.
  IF EXISTS (
    SELECT 1 FROM public.waiters w
    WHERE w.restaurant_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.restaurant_staff s
                      WHERE s.waiter_id = w.id AND s.restaurant_id = w.restaurant_id)
  ) THEN
    RAISE EXCEPTION 'Есть официанты с рестораном в waiters, которых нет в restaurant_staff — сначала перенесите';
  END IF;
END $$;

ALTER TABLE public.waiters
  DROP COLUMN employment_type,
  DROP COLUMN restaurant_id,
  DROP COLUMN role,
  DROP COLUMN hire_date,
  DROP COLUMN dismissal_date;

COMMIT;
NOTIFY pgrst, 'reload schema';
