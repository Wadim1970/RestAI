-- ============================================================
-- Ограничить рекомендации ИИ двумя блюдами за раз (было 3), по просьбе
-- пользователя. Механизм уже существовал (recommendation_policy.max_options
-- в restaurant_ai_profiles, компилируется в промт в promptCompiler.js) —
-- меняется только значение, не сама логика.
--
-- jsonb_set трогает только recommendation_policy.max_options, остальные
-- поля не затрагиваются — на случай, если что-то уже правили вручную в
-- Supabase Studio с момента исходного seed.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260716020000_recommendation_max_options_2.sql
-- ============================================================

BEGIN;

UPDATE public.restaurant_ai_profiles
SET restaurant_policy = jsonb_set(restaurant_policy, '{recommendation_policy,max_options}', '2'),
    updated_at = now()
WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee';

COMMIT;
