-- ============================================================
-- restaurant_ai_profiles — структурированный профиль голосового ИИ
-- на ресторан: личность (character_profile) и коммерческая политика
-- (restaurant_policy) в JSONB, плюс философия ресторана текстом.
--
-- НЕ хранит платформенные правила безопасности — те живут в коде
-- (voice-relay/src/context.js, SYSTEM_PROMPT), не должны редактироваться
-- в обход код-ревью.
--
-- Пока редактирует только владелец платформы напрямую через Supabase
-- Studio — записи для anon/authenticated нет, только SELECT (voice-relay
-- читает тем же анонимным ключом, что и меню/профиль гостя).
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260715010000_restaurant_ai_profiles.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.restaurant_ai_profiles (
  restaurant_id      text PRIMARY KEY,
  character_profile  jsonb NOT NULL DEFAULT '{}',
  restaurant_policy  jsonb NOT NULL DEFAULT '{}',
  philosophy         text NOT NULL DEFAULT '',
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.restaurant_ai_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS restaurant_ai_profiles_select ON public.restaurant_ai_profiles;
CREATE POLICY restaurant_ai_profiles_select ON public.restaurant_ai_profiles
  FOR SELECT TO anon, authenticated
  USING (true);

GRANT SELECT ON public.restaurant_ai_profiles TO anon, authenticated;
GRANT ALL ON public.restaurant_ai_profiles TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
