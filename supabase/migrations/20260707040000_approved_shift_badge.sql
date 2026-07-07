-- ============================================================
-- Notification badge для одобренных откликов официанта на вакансии.
--
-- Поток: ресторан одобряет отклик (bookings.status -> 'approved') ->
-- у официанта на иконке "Мои смены" в футере появляется бейдж с числом
-- непросмотренных одобрений -> официант открывает вкладку "ОДОБРЕНЫ" ->
-- бейдж обнуляется -> официант подтверждает одну из смен -> она
-- становится 'confirmed', а ВСЕ ОСТАЛЬНЫЕ его брони (applied/approved)
-- НА ТУ ЖЕ ДАТУ СМЕНЫ (не календарное "сегодня") автоматически
-- отменяются — официант не может выйти в двух местах одновременно.
--
-- seen_at сбрасывается в NULL триггером при любом переходе в 'approved',
-- независимо от того, какое приложение сделало UPDATE (Admin-restai
-- трогать не нужно).
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260707040000_approved_shift_badge.sql
-- ============================================================

BEGIN;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS seen_at timestamptz NULL;

CREATE OR REPLACE FUNCTION public.reset_booking_seen_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    NEW.seen_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_booking_seen_at ON public.bookings;
CREATE TRIGGER trg_reset_booking_seen_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_booking_seen_at();

-- ------------------------------------------------------------
-- Счётчик для бейджа
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_unseen_approved_count(p_worker_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.bookings
  WHERE worker_id = p_worker_id
    AND status = 'approved'
    AND seen_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_unseen_approved_count(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Отметить одобренные просмотренными (вкладка "ОДОБРЕНЫ" открыта)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_approved_seen(p_worker_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.bookings
  SET seen_at = now()
  WHERE worker_id = p_worker_id
    AND status = 'approved'
    AND seen_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_approved_seen(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Подтвердить смену + каскадно отменить остальные брони на ту же дату
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_shift(p_booking_id uuid, p_worker_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_date date;
BEGIN
  UPDATE public.bookings b
  SET status = 'confirmed', updated_at = now()
  FROM public.jobs j
  WHERE b.id = p_booking_id
    AND b.worker_id = p_worker_id
    AND b.status = 'approved'
    AND j.id = b.job_id
  RETURNING j.shift_date INTO v_shift_date;

  IF v_shift_date IS NULL THEN
    RAISE EXCEPTION 'Бронь не найдена, не принадлежит вам, или уже не в статусе "одобрено"';
  END IF;

  UPDATE public.bookings b
  SET status = 'cancelled', updated_at = now()
  FROM public.jobs j
  WHERE b.worker_id = p_worker_id
    AND b.id != p_booking_id
    AND b.status IN ('applied', 'approved')
    AND j.id = b.job_id
    AND j.shift_date = v_shift_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_shift(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
