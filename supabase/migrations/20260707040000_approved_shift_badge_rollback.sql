BEGIN;

DROP FUNCTION IF EXISTS public.confirm_shift(uuid, uuid);
DROP FUNCTION IF EXISTS public.mark_approved_seen(uuid);
DROP FUNCTION IF EXISTS public.get_unseen_approved_count(uuid);
DROP TRIGGER IF EXISTS trg_reset_booking_seen_at ON public.bookings;
DROP FUNCTION IF EXISTS public.reset_booking_seen_at();
ALTER TABLE public.bookings DROP COLUMN IF EXISTS seen_at;

COMMIT;
