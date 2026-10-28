-- ============================================================
-- Билеты на голосовой разговор: защита голосового помощника от посторонних.
--
-- Было: сервер голоса пускал любого по адресу /voice, ресторан, стол и
-- устройство брал из ссылки без проверки. Каждая минута разговора — деньги у
-- провайдера ИИ.
--
-- Стало: перед разговором телефон просит у базы одноразовый билет
-- (voice_ticket_issue). База выдаёт его, только если стол есть в этом
-- ресторане и за ним идёт посадка, и не чаще лимитов:
--   • устройство — не больше 6 билетов за 10 минут;
--   • стол       — не больше 20 билетов за 10 минут;
--   • ресторан   — не больше 300 билетов в час.
-- Билет живёт 2 минуты и гасится при первом же использовании. Сервер голоса
-- (voice_ticket_consume) принимает разговор только по билету и берёт ресторан,
-- стол и устройство из него, а не из ссылки.
--
-- Честно о границах: вход за стол у гостя без QR-токена (любой, кто знает
-- ресторан и номер стола, может открыть посадку), поэтому билет не доказывает,
-- что человек в ресторане. Он делает три другие вещи: отсекает случайные и
-- подделанные подключения, привязывает разговор к настоящему ресторану и столу
-- и даёт базе жёсткие потолки по числу разговоров.
--
-- В базе хранится только хэш билета (sha256), сам билет знает телефон.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261029010000_voice_tickets.sql
-- Откат: 20261029010000_voice_tickets_rollback.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.voice_tickets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text NOT NULL UNIQUE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  table_id      uuid NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
  table_number  text NOT NULL,
  device_id     text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz
);

CREATE INDEX IF NOT EXISTS voice_tickets_restaurant_created_idx ON public.voice_tickets (restaurant_id, created_at);
CREATE INDEX IF NOT EXISTS voice_tickets_table_created_idx      ON public.voice_tickets (table_id, created_at);
CREATE INDEX IF NOT EXISTS voice_tickets_device_created_idx     ON public.voice_tickets (device_id, created_at);

-- Таблицу читают и пишут только функции ниже (SECURITY DEFINER).
ALTER TABLE public.voice_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_tickets FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Выдать билет.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voice_ticket_issue(
  p_restaurant_id uuid, p_table_number text, p_device_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_table_id uuid;
  v_token    text;
BEGIN
  IF p_table_number IS NULL OR btrim(p_table_number) !~ '^[0-9]{1,6}$' THEN
    RAISE EXCEPTION 'Не удалось определить номер стола';
  END IF;
  IF p_device_id IS NULL OR btrim(p_device_id) = '' OR length(p_device_id) > 120 THEN
    RAISE EXCEPTION 'Не удалось определить устройство гостя';
  END IF;

  SELECT t.id INTO v_table_id
  FROM public.tables t
  WHERE t.restaurant_id = p_restaurant_id
    AND t.number = btrim(p_table_number)::integer
    AND t.is_active = true;
  IF v_table_id IS NULL THEN
    RAISE EXCEPTION 'Стол % не найден для этого ресторана', p_table_number;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.table_sessions ts WHERE ts.table_id = v_table_id AND ts.is_active) THEN
    RAISE EXCEPTION 'Стол закрыт: отсканируйте QR-код на столе заново';
  END IF;

  -- Потолки (считаем выданные билеты, в том числе неиспользованные).
  IF (SELECT count(*) FROM public.voice_tickets v
      WHERE v.device_id = p_device_id AND v.created_at > now() - interval '10 minutes') >= 6
     OR (SELECT count(*) FROM public.voice_tickets v
         WHERE v.table_id = v_table_id AND v.created_at > now() - interval '10 minutes') >= 20
     OR (SELECT count(*) FROM public.voice_tickets v
         WHERE v.restaurant_id = p_restaurant_id AND v.created_at > now() - interval '1 hour') >= 300
  THEN
    RAISE EXCEPTION 'Лимит голосовых разговоров исчерпан, попробуйте позже';
  END IF;

  -- Старые билеты не копим.
  DELETE FROM public.voice_tickets WHERE created_at < now() - interval '1 day';

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  INSERT INTO public.voice_tickets (token_hash, restaurant_id, table_id, table_number, device_id, expires_at)
  VALUES (encode(sha256(convert_to(v_token, 'utf8')), 'hex'), p_restaurant_id, v_table_id,
          btrim(p_table_number), p_device_id, now() + interval '2 minutes');

  RETURN v_token;
END $$;

-- ------------------------------------------------------------
-- Погасить билет (зовёт сервер голоса). Возвращает данные разговора или NULL.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voice_ticket_consume(p_ticket text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v record;
BEGIN
  IF p_ticket IS NULL OR p_ticket !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v
  FROM public.voice_tickets t
  WHERE t.token_hash = encode(sha256(convert_to(p_ticket, 'utf8')), 'hex')
    AND t.used_at IS NULL
    AND t.expires_at > now()
  FOR UPDATE;
  IF v.id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.voice_tickets SET used_at = now() WHERE id = v.id;

  RETURN jsonb_build_object(
    'restaurant_id', v.restaurant_id,
    'table_number',  v.table_number,
    'device_id',     v.device_id
  );
END $$;

REVOKE ALL ON FUNCTION public.voice_ticket_issue(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.voice_ticket_consume(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voice_ticket_issue(uuid, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.voice_ticket_consume(text) TO anon, authenticated, service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
