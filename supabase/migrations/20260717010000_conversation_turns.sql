-- ============================================================
-- Общая история диалога гостя с ИИ-ассистентом — единая для голосового
-- (Grok, voice-relay) и текстового (DeepSeek, n8n) режимов. Оба режима
-- пишут сюда свои реплики и при входе один раз подгружают историю сессии,
-- чтобы контекст не терялся при переключении голос<->текст.
--
-- Ключ — session_id (тот же "sess_...", что живёт от первого открытия
-- чата до оплаты за стол). Читаем всегда по текущему session_id, поэтому
-- прошлые визиты не мешают и чистить таблицу не обязательно.
--
-- Чувствительность низкая (реплики о еде/меню, без PII) — как и у
-- guest_restaurant_stats, SELECT/INSERT открыты anon; правит историю
-- только код (клиент RestAI и voice-relay), UPDATE/DELETE анониму не даём.
-- session_id случайный — знание его и есть «пропуск» к своей истории,
-- фильтрацию по нему делает сам код при чтении.
--
-- Типы session_id/guest_id/restaurant_id — text: приходят из разных мест
-- (query WS, клиентский стейт) в разном виде, text принимает любой без
-- сюрпризов с приведением.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260717010000_conversation_turns.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.conversation_turns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    text NOT NULL,
  restaurant_id text,
  guest_id      text,
  role          text NOT NULL CHECK (role IN ('user', 'assistant')),
  content       text NOT NULL,
  source        text NOT NULL CHECK (source IN ('voice', 'text')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Основной паттерн чтения — «все реплики этой сессии по порядку» и
-- «реплики этой сессии новее момента X» (догрузка дельты при переключении
-- режима). Составной индекс покрывает оба.
CREATE INDEX IF NOT EXISTS conversation_turns_session_created_idx
  ON public.conversation_turns (session_id, created_at);

ALTER TABLE public.conversation_turns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_turns_select ON public.conversation_turns;
CREATE POLICY conversation_turns_select ON public.conversation_turns
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS conversation_turns_insert ON public.conversation_turns;
CREATE POLICY conversation_turns_insert ON public.conversation_turns
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

GRANT SELECT, INSERT ON public.conversation_turns TO anon, authenticated;
GRANT ALL ON public.conversation_turns TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
