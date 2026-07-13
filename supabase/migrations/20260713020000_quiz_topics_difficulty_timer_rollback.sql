BEGIN;

-- ------------------------------------------------------------
-- Контент: убрать 9 новых тем целиком, вернуть "Кухни народов мира"
-- к исходному виду (30 вопросов, все по 10 баллов, без topic).
-- ------------------------------------------------------------
DELETE FROM public.quiz_questions WHERE topic IN (
  'География', 'История', 'Кино и сериалы', 'Музыка', 'Наука и технологии',
  'Спорт', 'Напитки и застолье', 'Литература и искусство', 'Общая эрудиция'
);

DELETE FROM public.quiz_questions WHERE topic = 'Кухни народов мира' AND question IN (
  'Как называется французская техника медленного томления мяса в собственном жире при низкой температуре?',
  'Какой из этих соусов входит в пятёрку «материнских соусов» классической французской кухни?',
  'В каком регионе Италии придумали ризотто по-милански с шафраном?',
  'Как называется марокканская смесь специй, которая может включать более 20 ингредиентов?',
  'Какой французский термин обозначает нарезку овощей мелкими кубиками 2-3 мм?',
  'Как называется грузинский кисло-острый соус из недозрелой алычи?',
  'Какое блюдо — национальный символ Перу, сырая рыба в соке цитрусовых?',
  'Как называется индийское топлёное сливочное масло, ключевое в аюрведической кухне?',
  'Как называется аргентинский соус из петрушки, чеснока, уксуса и масла к мясу с гриля?',
  'Как называются испанские закуски небольшими порциями, давшие имя целой культуре застолья?'
);

UPDATE public.quiz_questions SET points = 10
WHERE topic = 'Кухни народов мира' AND question IN (
  'Как называется популярный японский суп на основе соевой пасты?',
  'Как называется итальянское блюдо из риса, готовящееся с постепенным добавлением бульона?',
  'Из какой страны родом блюдо паэлья?',
  'Как называется французский десерт из заварного теста с кремом внутри?',
  'Какая специя часто придаёт плову золотистый цвет?',
  'Как называется мексиканская лепёшка, в которую заворачивают начинку?',
  'Какой молочный продукт — основа классического тирамису?',
  'Из чего традиционно делают хумус?',
  'Какой продукт — основа классического соуса песто?',
  'Из какого теста готовят классический наполеон?'
);

INSERT INTO public.quiz_questions (topic, question, options, correct_index, points) VALUES
('Кухни народов мира', 'Какая страна считается родиной какао и шоколада?', '["Швейцария", "Мексика", "Бельгия", "Франция"]', 1, 10),
('Кухни народов мира', 'Какой напиток готовят из обжаренных зёрен и подают горячим?', '["Какао", "Кофе", "Чай", "Компот"]', 1, 10),
('Кухни народов мира', 'Как называется итальянский десерт из кофе и маскарпоне?', '["Панна-котта", "Канноли", "Тирамису", "Профитроли"]', 2, 10),
('Кухни народов мира', 'Как называется австрийское блюдо — отбивная в панировке?', '["Гуляш", "Штрудель", "Айсбайн", "Шницель"]', 3, 10),
('Кухни народов мира', 'Какой цитрус используют в коктейле «Маргарита»?', '["Лимон", "Апельсин", "Лайм", "Грейпфрут"]', 2, 10),
('Кухни народов мира', 'Из чего готовят классическое ирландское рагу?', '["Говядина и рис", "Баранина и картофель", "Курица и грибы", "Рыба и овощи"]', 1, 10),
('Кухни народов мира', 'Какой ингредиент обязателен для классической пасты карбонара?', '["Сливки", "Грибы", "Томаты", "Яйцо"]', 3, 10),
('Кухни народов мира', 'Как называется корейское блюдо из квашеной острой капусты?', '["Мисо", "Терияки", "Кимбап", "Кимчи"]', 3, 10),
('Кухни народов мира', 'Какой из этих продуктов НЕ является сыром?', '["Пармезан", "Тофу", "Чеддер", "Бри"]', 1, 10),
('Кухни народов мира', 'Из какой страны родом суп том-ям?', '["Вьетнам", "Китай", "Таиланд", "Индия"]', 2, 10);

UPDATE public.quiz_questions SET topic = NULL WHERE topic = 'Кухни народов мира';

-- ------------------------------------------------------------
-- Схема: снять topic/CHECK, вернуть quiz_attempts к "лог только на
-- ответ, только когда есть исход".
-- ------------------------------------------------------------
DROP INDEX IF EXISTS public.quiz_questions_topic_points_idx;
ALTER TABLE public.quiz_questions DROP CONSTRAINT IF EXISTS quiz_questions_points_check;
ALTER TABLE public.quiz_questions DROP COLUMN IF EXISTS topic;

UPDATE public.quiz_attempts SET is_correct = false WHERE is_correct IS NULL;
ALTER TABLE public.quiz_attempts ALTER COLUMN is_correct SET NOT NULL;
ALTER TABLE public.quiz_attempts DROP COLUMN IF EXISTS issued_at;
ALTER TABLE public.quiz_attempts DROP COLUMN IF EXISTS answered_at;

-- ------------------------------------------------------------
-- Функции: вернуть версии без прогрессии сложности / таймера
-- (состояние на момент 20260713010000_quiz_repeat_registered_guest.sql).
-- Возвращаемый набор колонок тоже меняется (убираем time_limit_seconds) —
-- CREATE OR REPLACE этого не позволяет без явного DROP сначала.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_random_quiz_question(bigint);

CREATE OR REPLACE FUNCTION public.get_random_quiz_question(p_guest_id bigint)
RETURNS TABLE(question_id uuid, question text, options jsonb, points integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT qq.id, qq.question, qq.options, qq.points
    FROM public.quiz_questions qq
    WHERE qq.is_active = true
      AND qq.id NOT IN (
        SELECT qa.question_id FROM public.quiz_attempts qa WHERE qa.guest_id = p_guest_id
      )
    ORDER BY random()
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY
      SELECT qq.id, qq.question, qq.options, qq.points
      FROM public.quiz_questions qq
      WHERE qq.is_active = true
      ORDER BY random()
      LIMIT 1;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_random_quiz_question(bigint) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.check_quiz_answer(bigint, uuid, integer);

CREATE OR REPLACE FUNCTION public.check_quiz_answer(p_question_id uuid, p_selected_index integer)
RETURNS TABLE(is_correct boolean, correct_text text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    (correct_index = p_selected_index) AS is_correct,
    options ->> correct_index AS correct_text
  FROM public.quiz_questions
  WHERE id = p_question_id;
$$;

GRANT EXECUTE ON FUNCTION public.check_quiz_answer(uuid, integer) TO anon, authenticated, service_role;

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
  v_is_correct      boolean;
  v_row_count       integer;
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
  v_row_count       integer;
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

NOTIFY pgrst, 'reload schema';

COMMIT;
