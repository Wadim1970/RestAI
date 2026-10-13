-- Откат 20261013010000_menu_pairings.sql
BEGIN;
DROP FUNCTION IF EXISTS public.log_menu_pairing_event(uuid, text, uuid, uuid, text, boolean);
DROP INDEX IF EXISTS public.ai_sugg_ev_pair_idx;
ALTER TABLE public.ai_suggestion_events
  DROP COLUMN IF EXISTS channel,
  DROP COLUMN IF EXISTS anchor_dish_id,
  DROP COLUMN IF EXISTS device_id,
  DROP COLUMN IF EXISTS personal;
DROP TABLE IF EXISTS public.menu_pairing_state;
DROP TABLE IF EXISTS public.menu_pairings;
COMMIT;
