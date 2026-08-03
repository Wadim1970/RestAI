-- ============================================================
-- Кэш предрасчёта подсказок AI-коуча официанта (/warm).
--
-- ЗАЧЕМ:
--   Vercel-функция без состояния, поэтому «тёплый» кэш держим в БД. При
--   открытии гостя фронт зовёт /api/waiter/warm — функция заранее считает
--   подсказки по тегам стадии и кладёт сюда. Тап по тегу (/suggest) сначала
--   смотрит кэш → мгновенный ответ вместо живого вызова DeepSeek.
--
--   cache_key — sha1 от нормализованного набора входных данных
--   (ресторан + стадия + тег + атрибуты гостя + состав корзины). Свежесть —
--   по expires_at. Доступ только серверный (service_role обходит RLS).
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260803010000_waiter_ai_cache.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.waiter_ai_cache (
  cache_key   text PRIMARY KEY,
  suggestions jsonb NOT NULL,
  source      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_waiter_ai_cache_expires ON public.waiter_ai_cache(expires_at);

ALTER TABLE public.waiter_ai_cache ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.waiter_ai_cache IS
  'Тёплый кэш подсказок AI-коуча (/warm пишет, /suggest читает). Ключ — sha1 входных данных, свежесть по expires_at. Только серверный доступ.';

NOTIFY pgrst, 'reload schema';

COMMIT;
