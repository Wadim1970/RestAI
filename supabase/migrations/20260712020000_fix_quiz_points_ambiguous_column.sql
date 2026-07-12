-- ============================================================
-- Фикс: register_guest_and_credit_quiz падала на каждом вызове
-- с правильным вопросом ("column reference \"points\" is ambiguous",
-- код 42702).
--
-- ПРИЧИНА: RETURNS TABLE(ok boolean, phone_taken boolean, points
-- integer) в PL/pgSQL неявно создаёт переменную points в теле
-- функции. Строка "UPDATE public.guests SET points = points +
-- v_question_points" не может понять, points справа — это выходной
-- параметр функции или столбец guests. Отсюда и ошибка 502 "Не
-- удалось сохранить регистрацию" в waiter-api при вводе SMS-кода —
-- код при этом уже помечался использованным, поэтому повторное
-- нажатие "Подтвердить" дальше отвечало "код не запрашивался или
-- уже использован".
--
-- ФИКС: везде, где "points" фигурирует рядом с guests/quiz_questions
-- внутри тела функции, явно квалифицируем через алиас таблицы.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260712020000_fix_quiz_points_ambiguous_column.sql
-- ============================================================

BEGIN;

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
      VALUES (v_guest_id, p_question_id, true, v_question_points);

      UPDATE public.guests AS g SET points = g.points + v_question_points WHERE g.id = v_guest_id;
    END IF;
  END IF;

  RETURN QUERY SELECT true, false, (SELECT g.points FROM public.guests AS g WHERE g.id = v_guest_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_guest_and_credit_quiz(text, text, text, uuid, integer) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
