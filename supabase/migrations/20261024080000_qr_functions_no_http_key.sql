-- ============================================================
-- Убрать из функций QR зашитый ключ service_role и мёртвый HTTP-вызов.
--
-- БЫЛО: generate_daily_tokens и trigger_generate_qr после создания токена
-- делали запрос к серверной функции generate-qr на supabase.insis.pro и для
-- этого носили в теле JWT с ролью service_role. Адрес больше не существует
-- (картинка QR последний раз создавалась 10.10.2026), так что вызов уходил
-- в пустоту, а ключ лежал открытым текстом в определениях функций и во всех
-- бэкапах базы.
--
-- СТАЛО:
--   • generate_daily_tokens — токены создаются как прежде (та же логика), но
--     без HTTP-запроса и без ключа;
--   • trigger_generate_qr — при создании ресторана сразу выдаёт ему токен на
--     сегодня (раньше только дёргал мёртвый адрес);
--   • картинку QR теперь рисует приложение: страница «QR-коды» в админке
--     (api/admin/qr, api/qr-image в Waiter-app), с токеном администратора.
--
-- ВАЖНО: ключ, который был в функциях, остаётся в старых бэкапах (pg_dump) и
-- в истории доступа к базе. Если это действующий ключ service_role вашего
-- сервера, его нужно перевыпустить; если ключ старого проекта insis.pro —
-- достаточно удалить старые бэкапы. Проверка (печатает только хэши):
--   sudo docker exec supabase-db psql -U supabase_admin -d postgres -Atc \
--     "select md5(substring(prosrc from 'Bearer ([A-Za-z0-9_.-]+)')) from pg_proc where proname in ('trigger_generate_qr','generate_daily_tokens')"
--   — выполнять ДО этой миграции; после неё ключа в функциях уже не будет.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261024080000_qr_functions_no_http_key.sql
-- Откат: 20261024080000_qr_functions_no_http_key_rollback.sql (прежние функции
-- с ключом не возвращает — ключ намеренно нигде не хранится).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_daily_tokens()
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  r RECORD;
  new_token text;
BEGIN
  FOR r IN
    SELECT "restaurantId", qr_reset_time, timezone
    FROM restaurants
    WHERE qr_reset_time IS NOT NULL
      AND (
        NOT EXISTS (
          SELECT 1 FROM restaurant_daily_tokens rdt
          WHERE rdt.restaurant_id = restaurants."restaurantId"
            AND rdt.valid_date = CURRENT_DATE
        )
        OR (
          (CURRENT_TIMESTAMP AT TIME ZONE timezone)::time >= qr_reset_time
          AND NOT EXISTS (
            SELECT 1 FROM restaurant_daily_tokens rdt
            WHERE rdt.restaurant_id = restaurants."restaurantId"
              AND rdt.valid_date = CURRENT_DATE
              AND rdt.created_at >= (CURRENT_DATE + qr_reset_time) AT TIME ZONE timezone
          )
        )
      )
  LOOP
    new_token := encode(gen_random_bytes(16), 'hex');

    DELETE FROM restaurant_daily_tokens
    WHERE restaurant_id = r."restaurantId"
      AND valid_date = CURRENT_DATE;

    INSERT INTO restaurant_daily_tokens (restaurant_id, token, valid_date)
    VALUES (r."restaurantId", new_token, CURRENT_DATE);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_generate_qr()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Новый ресторан сразу получает токен на сегодня; дальше его меняет
  -- ночной планировщик (generate_daily_tokens).
  INSERT INTO restaurant_daily_tokens (restaurant_id, token, valid_date)
  VALUES (NEW."restaurantId", encode(gen_random_bytes(16), 'hex'), CURRENT_DATE)
  ON CONFLICT (restaurant_id, valid_date) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Страховка: после замены в определениях функций не должно остаться JWT.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc
             WHERE proname IN ('generate_daily_tokens', 'trigger_generate_qr')
               AND prosrc ~ 'eyJ[A-Za-z0-9_-]{20,}\.') THEN
    RAISE EXCEPTION 'В функциях QR всё ещё есть зашитый ключ — миграция отменена';
  END IF;
END $$;

COMMIT;
NOTIFY pgrst, 'reload schema';
