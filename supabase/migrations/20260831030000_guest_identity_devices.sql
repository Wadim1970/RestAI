-- ============================================================
-- Личность гостя = телефон, устройства ПРИВЯЗЫВАЮТСЯ к ней (а не наоборот).
--
-- БЫЛО: строка guests опознавалась по device_id (уникальный ключ). На новом
-- телефоне — новый device_id → новый «гость», баллы/кабинет не переезжают.
--
-- СТАЛО (Фаза 1, только плумбинг — поведение для существующих устройств НЕ
-- меняется): вводим таблицу-связку guest_devices(device_id → guest_id).
-- Ядровые функции резолвят устройство → личность ЧЕРЕЗ связку. guests остаётся
-- «личностью» (имя/телефон/баллы/предпочтения/ДР, FK от quiz_attempts). Столбец
-- guests.device_id сохраняем как «первое устройство» для обратной совместимости
-- периферийных функций (отзывы/статистика), но истина о принадлежности —
-- в guest_devices.
--
-- Кросс-девайс вход по номеру (слияние анонимных баллов, привязка нового
-- устройства) добавляется отдельной миграцией Фазы 2 (login_by_phone).
--
-- Идемпотентно и обратносовместимо: после бэкфилла связка покрывает все
-- существующие устройства, резолв даёт тот же результат, что и раньше.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260831030000_guest_identity_devices.sql
-- ============================================================

BEGIN;

-- 1) Связка «устройство → личность». Много устройств → одна личность.
CREATE TABLE IF NOT EXISTS public.guest_devices (
  device_id  text PRIMARY KEY,
  guest_id   bigint NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  linked_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guest_devices_guest_idx ON public.guest_devices (guest_id);
ALTER TABLE public.guest_devices ENABLE ROW LEVEL SECURITY;

-- 2) Бэкфилл из существующих строк guests (device_id → эта строка).
INSERT INTO public.guest_devices (device_id, guest_id)
SELECT device_id, id FROM public.guests WHERE device_id IS NOT NULL
ON CONFLICT (device_id) DO NOTHING;

-- 3) Резолвер «устройство → личность» (истина — связка).
CREATE OR REPLACE FUNCTION public.guest_id_for_device(p_device_id text)
RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT guest_id FROM public.guest_devices WHERE device_id = p_device_id;
$$;

-- 4) Регистрация визита: нет связки → создаём личность + связку; есть → инкремент.
CREATE OR REPLACE FUNCTION public.register_guest_visit(p_device_id text)
RETURNS TABLE (id bigint, visit_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_gid bigint;
BEGIN
  v_gid := public.guest_id_for_device(p_device_id);

  IF v_gid IS NULL THEN
    INSERT INTO public.guests (device_id, visit_count, created_at, last_visit_at)
    VALUES (p_device_id, 1, now(), now())
    RETURNING guests.id INTO v_gid;
    INSERT INTO public.guest_devices (device_id, guest_id)
    VALUES (p_device_id, v_gid)
    ON CONFLICT (device_id) DO NOTHING;
  ELSE
    UPDATE public.guests
      SET visit_count = COALESCE(visit_count, 0) + 1, last_visit_at = now()
      WHERE guests.id = v_gid;
  END IF;

  RETURN QUERY SELECT g.id, g.visit_count FROM public.guests g WHERE g.id = v_gid;
END;
$$;

-- 5) Профиль для кабинета — через связку.
CREATE OR REPLACE FUNCTION public.get_guest_profile(p_device_id text)
RETURNS TABLE(
  name text, phone text, points integer,
  birthday_day smallint, birthday_month smallint, dislikes text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT g.name, g.phone, g.points, g.birthday_day, g.birthday_month, g.dislikes
  FROM public.guests g
  WHERE g.id = public.guest_id_for_device(p_device_id);
$$;

-- 6) Обновление профиля (имя/ДР/нелюбимое) — по личности устройства.
CREATE OR REPLACE FUNCTION public.update_guest_profile(
  p_device_id text, p_name text,
  p_birthday_day smallint DEFAULT NULL,
  p_birthday_month smallint DEFAULT NULL,
  p_dislikes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.guests
  SET name = p_name, birthday_day = p_birthday_day,
      birthday_month = p_birthday_month, dislikes = p_dislikes
  WHERE id = public.guest_id_for_device(p_device_id);
END;
$$;

-- 7) Регистрация (имя+телефон) + баллы за верный ответ — по личности устройства.
--    Логику phone_taken пока сохраняем (меняется в Фазе 2 на вход/слияние).
CREATE OR REPLACE FUNCTION public.register_guest_and_credit_quiz(
  p_device_id text, p_name text, p_phone text,
  p_question_id uuid DEFAULT NULL, p_selected_index integer DEFAULT NULL
)
RETURNS TABLE(ok boolean, phone_taken boolean, points integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_guest_id        bigint;
  v_correct_index   integer;
  v_question_points integer;
  v_is_correct      boolean := false;
BEGIN
  v_guest_id := public.guest_id_for_device(p_device_id);
  IF v_guest_id IS NULL THEN
    RETURN QUERY SELECT false, false, 0;
    RETURN;
  END IF;

  BEGIN
    UPDATE public.guests AS g
    SET name = p_name, phone = p_phone
    WHERE g.id = v_guest_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false, true, 0;
    RETURN;
  END;

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

GRANT EXECUTE ON FUNCTION public.guest_id_for_device(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_guest_visit(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_guest_profile(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_guest_profile(text, text, smallint, smallint, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_guest_and_credit_quiz(text, text, text, uuid, integer) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
