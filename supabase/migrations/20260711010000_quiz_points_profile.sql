-- ============================================================
-- Викторина + программа баллов + расширенный профиль гостя.
--
-- Поток: гость нажимает "Перейти к оплате" или "Позвать официанта со
-- счётом" -> видит вопрос (10 баллов, простой) -> если отвечает
-- верно -> должен зарегистрироваться (имя, телефон, SMS-код), иначе
-- результат НЕ сохраняется — это осознанное требование, не баг.
-- Сама регистрация/начисление баллов делает waiter-api (там же, где
-- уже есть отправка SMS для официантов) ПОСЛЕ проверки кода — клиенту
-- нельзя доверять "я ответил верно", поэтому register_and_credit_quiz
-- сама заново сверяет correct_index, а не полагается на более ранний
-- вызов check_quiz_answer.
--
-- correct_index никогда не отдаётся анонимному клиенту напрямую —
-- у quiz_questions нет SELECT-политики вообще, доступ только через
-- SECURITY DEFINER функции, которые не включают этот столбец в ответ.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260711010000_quiz_points_profile.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Расширение профиля гостя
-- ------------------------------------------------------------
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS points integer NOT NULL DEFAULT 0;
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS birthday_day smallint NULL;
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS birthday_month smallint NULL;
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS dislikes text NULL;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guests_birthday_day_check') THEN
    ALTER TABLE public.guests ADD CONSTRAINT guests_birthday_day_check
      CHECK (birthday_day IS NULL OR birthday_day BETWEEN 1 AND 31);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guests_birthday_month_check') THEN
    ALTER TABLE public.guests ADD CONSTRAINT guests_birthday_month_check
      CHECK (birthday_month IS NULL OR birthday_month BETWEEN 1 AND 12);
  END IF;
END $do$;

-- ------------------------------------------------------------
-- Банк вопросов
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quiz_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question      text NOT NULL,
  options       jsonb NOT NULL,
  correct_index integer NOT NULL,
  points        integer NOT NULL DEFAULT 10,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
-- Намеренно без SELECT-политик — correct_index не должен утекать
-- анониму. Всё чтение — через get_random_quiz_question/check_quiz_answer.

-- ------------------------------------------------------------
-- Попытки ответа (для истории и чтобы не повторять вопросы подряд)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id       bigint NOT NULL REFERENCES public.guests(id),
  question_id    uuid NOT NULL REFERENCES public.quiz_questions(id),
  is_correct     boolean NOT NULL,
  points_awarded integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS quiz_attempts_guest_id_idx ON public.quiz_attempts (guest_id);

-- ------------------------------------------------------------
-- Выдать вопрос: предпочитаем ещё не показанные этому гостю,
-- если все 30 уже видел — берём любой активный (повтор допустим).
-- correct_index в ответе НЕТ.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- Проверить ответ (без начисления баллов — только правильно/неправильно
-- + текст верного варианта, для окна "Упс, ошиблись"). Начисление
-- баллов только в register_and_credit_quiz, после SMS-подтверждения.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- Обновление профиля (имя/день рождения/нелюбимые продукты) —
-- НЕ трогает телефон, для него отдельный путь через SMS-подтверждение
-- (register_and_credit_quiz, вызывается только из waiter-api).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_guest_profile(
  p_device_id text,
  p_name text,
  p_birthday_day smallint DEFAULT NULL,
  p_birthday_month smallint DEFAULT NULL,
  p_dislikes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.guests
  SET name = p_name,
      birthday_day = p_birthday_day,
      birthday_month = p_birthday_month,
      dislikes = p_dislikes
  WHERE device_id = p_device_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_guest_profile(text, text, smallint, smallint, text) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Регистрация (имя+телефон) + начисление баллов за правильный ответ —
-- вызывается ТОЛЬКО waiter-api, ПОСЛЕ успешной проверки SMS-кода.
-- Сама пересчитывает правильность ответа — не доверяет более раннему
-- вызову check_quiz_answer (клиент мог его не делать вовсе).
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
BEGIN
  BEGIN
    UPDATE public.guests
    SET name = p_name, phone = p_phone
    WHERE device_id = p_device_id
    RETURNING id INTO v_guest_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false, true, 0;
    RETURN;
  END;

  IF v_guest_id IS NULL THEN
    RETURN QUERY SELECT false, false, 0;
    RETURN;
  END IF;

  IF p_question_id IS NOT NULL THEN
    SELECT correct_index, points INTO v_correct_index, v_question_points
    FROM public.quiz_questions WHERE id = p_question_id;

    v_is_correct := (v_correct_index IS NOT NULL AND v_correct_index = p_selected_index);

    IF v_is_correct THEN
      INSERT INTO public.quiz_attempts (guest_id, question_id, is_correct, points_awarded)
      VALUES (v_guest_id, p_question_id, true, v_question_points);

      UPDATE public.guests SET points = points + v_question_points WHERE id = v_guest_id;
    END IF;
  END IF;

  RETURN QUERY SELECT true, false, (SELECT points FROM public.guests WHERE id = v_guest_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_guest_and_credit_quiz(text, text, text, uuid, integer) TO service_role;

-- ------------------------------------------------------------
-- Банк вопросов (30 шт, все по 10 баллов)
-- ------------------------------------------------------------
INSERT INTO public.quiz_questions (question, options, correct_index) VALUES
('Какая страна считается родиной пиццы?', '["Франция", "Италия", "Испания", "Греция"]', 1),
('Как называется популярный японский суп на основе соевой пасты?', '["Рамен", "Удон", "Мисо", "Карри"]', 2),
('Из чего традиционно готовят классический борщ (главный овощ)?', '["Морковь", "Тыква", "Кабачок", "Свёкла"]', 3),
('Какой напиток традиционно подают к суши в Японии?', '["Кофе", "Зелёный чай", "Морс", "Компот"]', 1),
('Как называется итальянское блюдо из риса, готовящееся с постепенным добавлением бульона?', '["Паста", "Лазанья", "Ризотто", "Пицца"]', 2),
('Какой основной ингредиент в гуакамоле?', '["Огурец", "Помидор", "Авокадо", "Тыква"]', 2),
('Из какой страны родом блюдо паэлья?', '["Португалия", "Италия", "Испания", "Мексика"]', 2),
('Как называется французский десерт из заварного теста с кремом внутри?', '["Круассан", "Багет", "Тирамису", "Эклер"]', 3),
('Какой сыр традиционно используют в пицце «Маргарита»?', '["Пармезан", "Моцарелла", "Чеддер", "Гауда"]', 1),
('Какая специя часто придаёт плову золотистый цвет?', '["Корица", "Чёрный перец", "Шафран", "Паприка"]', 2),
('Как называется мексиканская лепёшка, в которую заворачивают начинку?', '["Пита", "Лаваш", "Наан", "Тортилья"]', 3),
('Какой молочный продукт — основа классического тирамису?', '["Творог", "Маскарпоне", "Сметана", "Йогурт"]', 1),
('Какой чай традиционно подают в Англии в пять часов вечера?', '["Зелёный чай", "Чёрный чай", "Травяной чай", "Улун"]', 1),
('Как называется французский луковый суп с сыром и гренками?', '["Буйабес", "Минестроне", "Луковый суп", "Гаспачо"]', 2),
('Из сырой рыбы и риса готовят это японское блюдо. Как оно называется?', '["Темпура", "Якитори", "Суши", "Сукияки"]', 2),
('Из чего традиционно делают хумус?', '["Фасоль", "Горох", "Чечевица", "Нут"]', 3),
('Какая страна считается родиной какао и шоколада?', '["Швейцария", "Мексика", "Бельгия", "Франция"]', 1),
('Как называется греческий салат с сыром фета?', '["Оливье", "Цезарь", "Греческий салат", "Винегрет"]', 2),
('Какой продукт — основа классического соуса песто?', '["Петрушка", "Укроп", "Мята", "Базилик"]', 3),
('Из какого теста готовят классический наполеон?', '["Бисквитное", "Слоёное", "Песочное", "Дрожжевое"]', 1),
('Какой напиток готовят из обжаренных зёрен и подают горячим?', '["Какао", "Кофе", "Чай", "Компот"]', 1),
('Как называется итальянский десерт из кофе и маскарпоне?', '["Панна-котта", "Канноли", "Тирамису", "Профитроли"]', 2),
('Какая приправа обычно входит в классический салат оливье?', '["Кетчуп", "Горчица", "Майонез", "Соевый соус"]', 2),
('Как называется австрийское блюдо — отбивная в панировке?', '["Гуляш", "Штрудель", "Айсбайн", "Шницель"]', 3),
('Какой цитрус используют в коктейле «Маргарита»?', '["Лимон", "Апельсин", "Лайм", "Грейпфрут"]', 2),
('Из чего готовят классическое ирландское рагу?', '["Говядина и рис", "Баранина и картофель", "Курица и грибы", "Рыба и овощи"]', 1),
('Какой ингредиент обязателен для классической пасты карбонара?', '["Сливки", "Грибы", "Томаты", "Яйцо"]', 3),
('Как называется корейское блюдо из квашеной острой капусты?', '["Мисо", "Терияки", "Кимбап", "Кимчи"]', 3),
('Какой из этих продуктов НЕ является сыром?', '["Пармезан", "Тофу", "Чеддер", "Бри"]', 1),
('Из какой страны родом суп том-ям?', '["Вьетнам", "Китай", "Таиланд", "Индия"]', 2);

NOTIFY pgrst, 'reload schema';

COMMIT;
