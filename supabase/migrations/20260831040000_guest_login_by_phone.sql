-- ============================================================
-- Кросс-девайс вход по номеру (Фаза 2): телефон = сквозная личность.
--
-- Раньше register_guest_and_credit_quiz на «чужой» телефон возвращал
-- phone_taken → сервер отдавал 409 «номер уже зарегистрирован», и на новом
-- устройстве гость не мог ни войти, ни увидеть свои баллы.
--
-- Теперь: телефон уже ПОДТВЕРЖДЁН SMS на стороне waiter-api, значит владение
-- доказано — это тот же гость на новом устройстве. Вместо отказа СЛИВАЕМ:
--   • переносим анонимные баллы и попытки викторины на существующую личность;
--   • привязываем текущее устройство к ней (guest_devices + guests.device_id);
--   • начисляем текущий верный ответ уже на неё.
-- Баллы живут в ОДНОЙ строке — не расходятся между телефонами.
--
-- БЕЗОПАСНОСТЬ: слияние по номеру = вход в аккаунт, поэтому функция теперь
-- доступна ТОЛЬКО service_role (её вызывает waiter-api ПОСЛЕ проверки SMS).
-- Прямой вызов анонимным клиентом (подстановка чужого номера без SMS =
-- угон аккаунта) закрыт отзывом грантов anon/authenticated. Клиент её и не
-- вызывал напрямую — только через /api/guest/verify-sms.
--
-- Сервер и клиент менять НЕ нужно: сигнатура та же, phone_taken просто больше
-- не возвращается (ветка 409 на сервере становится недостижимой).
--
-- Требует ранее применённую 20260831030000 (guest_devices + резолвер).
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260831040000_guest_login_by_phone.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.register_guest_and_credit_quiz(
  p_device_id text, p_name text, p_phone text,
  p_question_id uuid DEFAULT NULL, p_selected_index integer DEFAULT NULL
)
RETURNS TABLE(ok boolean, phone_taken boolean, points integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_gid             bigint;   -- личность текущего устройства (аноним/своя)
  v_target          bigint;   -- существующая личность с этим телефоном
  v_correct_index   integer;
  v_question_points integer;
  v_is_correct      boolean := false;
BEGIN
  v_gid := public.guest_id_for_device(p_device_id);
  IF v_gid IS NULL THEN
    RETURN QUERY SELECT false, false, 0;
    RETURN;
  END IF;

  -- Этот номер уже принадлежит ДРУГОЙ личности? → вход/слияние.
  SELECT g.id INTO v_target
  FROM public.guests g
  WHERE g.phone = p_phone AND g.id <> v_gid
  LIMIT 1;

  IF v_target IS NOT NULL THEN
    -- Переносим попытки викторины (без дублей по вопросу), затем суммируем
    -- баллы и подтягиваем имя/предпочтения/ДР, если у целевой пусто.
    UPDATE public.quiz_attempts qa
      SET guest_id = v_target
      WHERE qa.guest_id = v_gid
        AND qa.question_id NOT IN (
          SELECT qa2.question_id FROM public.quiz_attempts qa2 WHERE qa2.guest_id = v_target
        );

    UPDATE public.guests t SET
      points        = COALESCE(t.points, 0) + COALESCE((SELECT a.points FROM public.guests a WHERE a.id = v_gid), 0),
      name          = COALESCE(NULLIF(t.name, ''), p_name, t.name),
      dislikes      = COALESCE(t.dislikes, (SELECT a.dislikes FROM public.guests a WHERE a.id = v_gid)),
      birthday_day  = COALESCE(t.birthday_day, (SELECT a.birthday_day FROM public.guests a WHERE a.id = v_gid)),
      birthday_month= COALESCE(t.birthday_month, (SELECT a.birthday_month FROM public.guests a WHERE a.id = v_gid))
      WHERE t.id = v_target;

    -- Освобождаем device_id у анонимной строки (UNIQUE), привязываем устройство
    -- к целевой личности и в связке, и в guests.device_id (для функций,
    -- читающих по device_id). Анонимную строку оставляем осиротевшей (безопасно
    -- по FK); её баллы уже перенесены.
    UPDATE public.guests SET device_id = NULL WHERE id = v_gid;
    UPDATE public.guest_devices SET guest_id = v_target, linked_at = now() WHERE device_id = p_device_id;
    UPDATE public.guests SET device_id = p_device_id WHERE id = v_target;

    v_gid := v_target;  -- дальше начисляем на целевую личность
  ELSE
    -- Первая привязка номера к личности этого устройства.
    UPDATE public.guests g SET name = p_name, phone = p_phone WHERE g.id = v_gid;
  END IF;

  -- Начисляем текущий верный ответ.
  IF p_question_id IS NOT NULL THEN
    SELECT qq.correct_index, qq.points INTO v_correct_index, v_question_points
    FROM public.quiz_questions qq WHERE qq.id = p_question_id;

    v_is_correct := (v_correct_index IS NOT NULL AND v_correct_index = p_selected_index);

    IF v_is_correct AND NOT EXISTS (
      SELECT 1 FROM public.quiz_attempts qa WHERE qa.guest_id = v_gid AND qa.question_id = p_question_id
    ) THEN
      INSERT INTO public.quiz_attempts (guest_id, question_id, is_correct, points_awarded)
      VALUES (v_gid, p_question_id, true, v_question_points);
      UPDATE public.guests SET points = points + v_question_points WHERE id = v_gid;
    END IF;
  END IF;

  RETURN QUERY SELECT true, false, (SELECT g.points FROM public.guests g WHERE g.id = v_gid);
END;
$$;

-- Только сервер (после SMS). Закрываем прямой анонимный вызов = защита от угона.
REVOKE EXECUTE ON FUNCTION public.register_guest_and_credit_quiz(text, text, text, uuid, integer) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.register_guest_and_credit_quiz(text, text, text, uuid, integer) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
