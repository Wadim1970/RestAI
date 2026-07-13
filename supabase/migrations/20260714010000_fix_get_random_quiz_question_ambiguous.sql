-- ============================================================
-- Фикс: get_random_quiz_question падала на каждом вызове с
-- "column reference \"question_id\" is ambiguous" (код 42702).
--
-- ПРИЧИНА: та же ловушка, что уже чинилась для "points" в
-- register_guest_and_credit_quiz (20260712020000) — RETURNS
-- TABLE(question_id uuid, ...) неявно создаёт переменную question_id
-- в теле функции. "ON CONFLICT (guest_id, question_id)" не
-- поддерживает алиасы таблиц у списка колонок конфликта, так что
-- там нельзя явно квалифицировать question_id как quiz_attempts.
-- question_id — отсюда и неоднозначность.
--
-- ПОСЛЕДСТВИЕ: с момента миграции 20260713020000 выдача вопроса
-- падала на каждом вызове, ни разу не отрабатывая до конца — на
-- экране гость видел "Загрузка вопроса…" на мгновение и тут же
-- закрытие викторины (RPC-ошибка = status 'empty' = onDone()).
--
-- ФИКС: ON CONFLICT ON CONSTRAINT quiz_attempts_guest_question_unique
-- вместо списка колонок — обходит неоднозначность полностью, без
-- переименования параметра функции (не ломает клиентский код).
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260714010000_fix_get_random_quiz_question_ambiguous.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_random_quiz_question(p_guest_id bigint)
RETURNS TABLE(question_id uuid, question text, options jsonb, points integer, time_limit_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_answered_count integer;
  v_current_points integer;
  v_allowed_points integer[];
  v_time_limit     integer;
  v_question_id    uuid;
BEGIN
  SELECT COUNT(*) INTO v_answered_count
  FROM public.quiz_attempts
  WHERE guest_id = p_guest_id AND answered_at IS NOT NULL;

  SELECT g.points INTO v_current_points FROM public.guests g WHERE g.id = p_guest_id;
  v_current_points := COALESCE(v_current_points, 0);

  IF v_answered_count < 2 THEN
    v_allowed_points := ARRAY[10];
    v_time_limit := NULL;
  ELSIF v_current_points >= 50 THEN
    v_allowed_points := ARRAY[15, 20];
    v_time_limit := 20;
  ELSE
    v_allowed_points := ARRAY[10, 15, 20];
    v_time_limit := 20;
  END IF;

  SELECT qq.id INTO v_question_id
  FROM public.quiz_questions qq
  WHERE qq.is_active = true
    AND qq.points = ANY(v_allowed_points)
    AND NOT EXISTS (
      SELECT 1 FROM public.quiz_attempts qa
      WHERE qa.guest_id = p_guest_id AND qa.question_id = qq.id
    )
  ORDER BY random()
  LIMIT 1;

  IF v_question_id IS NULL THEN
    SELECT qq.id INTO v_question_id
    FROM public.quiz_questions qq
    WHERE qq.is_active = true
      AND qq.points = ANY(v_allowed_points)
    ORDER BY random()
    LIMIT 1;
  END IF;

  IF v_question_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.quiz_attempts (guest_id, question_id, issued_at, is_correct, answered_at, points_awarded)
  VALUES (p_guest_id, v_question_id, now(), NULL, NULL, 0)
  ON CONFLICT ON CONSTRAINT quiz_attempts_guest_question_unique DO UPDATE
    SET issued_at = now(), answered_at = NULL, is_correct = NULL, points_awarded = 0
    WHERE quiz_attempts.answered_at IS NOT NULL;

  RETURN QUERY
    SELECT qq.id, qq.question, qq.options, qq.points, v_time_limit
    FROM public.quiz_questions qq
    WHERE qq.id = v_question_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_random_quiz_question(bigint) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
