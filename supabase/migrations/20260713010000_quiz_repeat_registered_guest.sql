-- ============================================================
-- Фикс: повторное прохождение викторины уже зарегистрированным
-- гостем не начисляло баллы и не давало сохранить изменения.
--
-- ПРИЧИНА: на верный ответ клиент ВСЕГДА открывал личный кабинет с
-- требованием SMS-регистрации (имя+телефон), даже если гость уже
-- зарегистрирован — единственный путь начисления баллов,
-- register_guest_and_credit_quiz, вызывается только после SMS-
-- подтверждения. Раз имя/телефон в форме совпадали с уже
-- сохранёнными (профиль подгружается из тех же guests), isDirty
-- оставался false, кнопка "Ок"/"Обновить" — неактивной, а баллы
-- физически было негде начислить.
--
-- ФИКС: новая credit_quiz_points — тот же пересчёт правильности
-- ответа на сервере, но БЕЗ SMS: если у гостя (по device_id) уже
-- есть подтверждённый телефон, личность уже доказана раньше и
-- повторно её проверять не нужно. Вызывается напрямую с клиента
-- (anon), как check_quiz_answer/get_random_quiz_question.
--
-- Заодно закрываем дыру: quiz_attempts не имел UNIQUE(guest_id,
-- question_id), так что один и тот же вопрос (например, при повторном
-- ответе после того как все 30 исчерпаны и get_random_quiz_question
-- начинает повторяться) мог начислить баллы больше одного раза.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260713010000_quiz_repeat_registered_guest.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Один и тот же вопрос засчитывается гостю не больше одного раза.
-- ------------------------------------------------------------
ALTER TABLE public.quiz_attempts
  ADD CONSTRAINT quiz_attempts_guest_question_unique UNIQUE (guest_id, question_id);

-- ------------------------------------------------------------
-- register_guest_and_credit_quiz: та же логика, плюс защита от
-- двойного начисления, если вопрос уже был засчитан раньше.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_guest_and_credit_quiz(
  p_device_id text,
  p_name text,
  p_phone text,
  p_question_id uuid DEFAULT NULL,
  p_selected_index integer DEFAULT NULL
)
RETURNS TABLE(ok boolean, phone_taken boolean, points integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guest_id        bigint;
  v_correct_index   integer;
  v_question_points integer;
  v_is_correct      boolean := false;
  v_row_count        integer;
BEGIN
  BEGIN
    UPDATE public.guests AS g
    SET name = p_name, phone = p_phone
    WHERE g.device_id = p_device_id
    RETURNING g.id INTO v_guest_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false, true, 0;
    RETURN;
  END;

  IF v_guest_id IS NULL THEN
    RETURN QUERY SELECT false, false, 0;
    RETURN;
  END IF;

  IF p_question_id IS NOT NULL THEN
    SELECT qq.correct_index, qq.points INTO v_correct_index, v_question_points
    FROM public.quiz_questions AS qq WHERE qq.id = p_question_id;

    v_is_correct := (v_correct_index IS NOT NULL AND v_correct_index = p_selected_index);

    IF v_is_correct THEN
      INSERT INTO public.quiz_attempts (guest_id, question_id, is_correct, points_awarded)
      VALUES (v_guest_id, p_question_id, true, v_question_points)
      ON CONFLICT (guest_id, question_id) DO NOTHING;

      GET DIAGNOSTICS v_row_count = ROW_COUNT;

      IF v_row_count > 0 THEN
        UPDATE public.guests AS g SET points = g.points + v_question_points WHERE g.id = v_guest_id;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT true, false, (SELECT g.points FROM public.guests AS g WHERE g.id = v_guest_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_guest_and_credit_quiz(text, text, text, uuid, integer) TO service_role;

-- ------------------------------------------------------------
-- Начислить баллы уже зарегистрированному гостю — без SMS, личность
-- уже подтверждена раньше. correct_index пересчитывается сама, не
-- доверяет более раннему check_quiz_answer.
-- ok=false означает "гость не найден или ещё не зарегистрирован
-- (нет телефона)" — в этом случае клиент должен идти обычным путём
-- через личный кабинет + SMS.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_quiz_points(
  p_device_id text,
  p_question_id uuid,
  p_selected_index integer
)
RETURNS TABLE(ok boolean, points integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guest_id        bigint;
  v_correct_index   integer;
  v_question_points integer;
  v_is_correct      boolean := false;
  v_row_count        integer;
BEGIN
  SELECT g.id INTO v_guest_id
  FROM public.guests AS g
  WHERE g.device_id = p_device_id AND g.phone IS NOT NULL;

  IF v_guest_id IS NULL THEN
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  SELECT qq.correct_index, qq.points INTO v_correct_index, v_question_points
  FROM public.quiz_questions AS qq WHERE qq.id = p_question_id;

  v_is_correct := (v_correct_index IS NOT NULL AND v_correct_index = p_selected_index);

  IF v_is_correct THEN
    INSERT INTO public.quiz_attempts (guest_id, question_id, is_correct, points_awarded)
    VALUES (v_guest_id, p_question_id, true, v_question_points)
    ON CONFLICT (guest_id, question_id) DO NOTHING;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;

    IF v_row_count > 0 THEN
      UPDATE public.guests AS g SET points = g.points + v_question_points WHERE g.id = v_guest_id;
    END IF;
  END IF;

  RETURN QUERY SELECT true, (SELECT g.points FROM public.guests AS g WHERE g.id = v_guest_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.credit_quiz_points(text, uuid, integer) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
