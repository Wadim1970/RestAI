-- ============================================================
-- ОТКАТ.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.place_guest_order(uuid, text, text, jsonb, text);
ALTER TABLE public.order_guests DROP CONSTRAINT IF EXISTS order_guests_order_device_unique;
ALTER TABLE public.order_guests DROP COLUMN IF EXISTS device_id;

NOTIFY pgrst, 'reload schema';

COMMIT;
