-- Откат 20261020020000: возвращает права по умолчанию Supabase (anon и
-- authenticated снова читают guests/guest_summary/guest_devices/order_guests).
-- Только если закрытие что-то сломало; get_guest_ai_context оставляем —
-- новый код приложений ей пользуется.
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20261020020000_close_guest_data_from_anon_rollback.sql

BEGIN;

GRANT ALL ON public.guests        TO anon, authenticated;
GRANT ALL ON public.guest_summary TO anon, authenticated;
GRANT ALL ON public.guest_devices TO anon, authenticated;
GRANT ALL ON public.order_guests  TO anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
