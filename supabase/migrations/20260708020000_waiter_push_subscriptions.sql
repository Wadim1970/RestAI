-- ============================================================
-- Push-подписки официантов (Web Push).
--
-- Живой вызов официанта (waiter_calls) работает только пока приложение
-- открыто или недавно свёрнуто — как только его по-настоящему выгружают
-- из памяти, ни звук, ни вибро, ни Realtime-событие дойти не могут:
-- браузер останавливает выполнение JS. Это не чинится кодом внутри
-- страницы — единственный механизм, который работает и через это
-- ограничение, это push-уведомления (будит Service Worker сама ОС).
--
-- Таблица только для записи через SECURITY DEFINER функцию — никаких
-- прямых грантов на INSERT/UPDATE клиенту, как и у остальных таблиц
-- в этой схеме. Сами уведомления отправляет waiter-api (отдельный
-- бэкенд-сервис на VPS, единственное место, где хранится приватный
-- VAPID-ключ) — эта миграция только про хранение подписок.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260708020000_waiter_push_subscriptions.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.waiter_push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waiter_id    uuid NOT NULL REFERENCES public.waiters(id),
  endpoint     text NOT NULL UNIQUE,
  p256dh       text NOT NULL,
  auth         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS waiter_push_subscriptions_waiter_id_idx
  ON public.waiter_push_subscriptions (waiter_id);

ALTER TABLE public.waiter_push_subscriptions ENABLE ROW LEVEL SECURITY;
-- Политик нет специально — ни anon, ни authenticated не читают и не
-- пишут сюда напрямую. Запись — только через save_push_subscription
-- (SECURITY DEFINER), чтение — только waiter-api через service_role
-- (обходит RLS), при отправке push.

-- ------------------------------------------------------------
-- Сохранить/обновить подписку (клиент вызывает при включении
-- уведомлений). upsert по endpoint — один и тот же браузер/устройство
-- может переподписаться (например, при повторном входе другим
-- официантом на том же телефоне) — тогда просто переносим endpoint
-- на нового владельца, а не плодим дубликаты.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_push_subscription(
  p_waiter_id uuid,
  p_endpoint  text,
  p_p256dh    text,
  p_auth      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.waiter_push_subscriptions (waiter_id, endpoint, p256dh, auth)
  VALUES (p_waiter_id, p_endpoint, p_p256dh, p_auth)
  ON CONFLICT (endpoint) DO UPDATE
    SET waiter_id = EXCLUDED.waiter_id,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        last_seen_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_push_subscription(uuid, text, text, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Кому слать push по конкретному вызову. Целевой официант уже вычислен
-- и сохранён в waiter_calls.target_waiter_id самой call_waiter() —
-- здесь просто читаем его же, а для широковещательных вызовов (NULL)
-- разворачиваем в список официантов с подтверждённой сменой сегодня в
-- этом ресторане (тот же критерий, что hasConfirmedShiftToday на
-- клиенте). Если вызов уже не 'pending' (приняли/отменили, пока запрос
-- шёл сюда) — возвращаем пусто, слать уже некому.
-- Доступ только service_role — вызывает waiter-api, не клиенты.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_call_target_waiters(p_call_id uuid)
RETURNS TABLE(waiter_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_waiter_id uuid;
  v_restaurant_id uuid;
BEGIN
  SELECT target_waiter_id, restaurant_id
    INTO v_target_waiter_id, v_restaurant_id
  FROM public.waiter_calls
  WHERE id = p_call_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_target_waiter_id IS NOT NULL THEN
    RETURN QUERY SELECT v_target_waiter_id;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT DISTINCT b.worker_id
    FROM public.bookings b
    JOIN public.jobs j ON j.id = b.job_id
    WHERE b.status = 'confirmed'
      AND j.restaurant_id = v_restaurant_id
      AND j.shift_date = CURRENT_DATE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_call_target_waiters(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
