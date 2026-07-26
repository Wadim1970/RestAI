-- ============================================================
-- Отзыв официанта о ресторане по окончании смены.
--
-- ЗАЧЕМ:
--   По завершении смены (+8ч) официанту нужно предложить оценить ресторан
--   (1–5) и оставить комментарий — пишем в существующую staff_feedback
--   (rating_staff_overall пересчитывает restaurants.rating_staff триггером).
--   Но в staff_feedback нет привязки к смене, поэтому «не спрашивать повторно»
--   не отследить. Заводим трекер staff_review_prompts (worker_id + booking_id
--   + статус submitted/declined) и две функции:
--     - get_pending_staff_review — самая ранняя подтверждённая смена, которая
--       завершилась >8ч назад и по которой ещё не ответили/не отказались;
--     - submit_staff_feedback — приём отзыва ('submit') или отказа ('decline').
--   «Пропустить» на сервере ничего не пишет — просто при следующем открытии
--   приложения смена снова попадёт в get_pending_staff_review.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/migrations/20260726010000_staff_review_prompts.sql
-- ============================================================

BEGIN;

-- 1. Трекер: по каким сменам официант уже ответил (или отказался).
CREATE TABLE IF NOT EXISTS public.staff_review_prompts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id     uuid NOT NULL,
  booking_id    uuid NOT NULL,
  restaurant_id uuid,
  status        text NOT NULL CHECK (status IN ('submitted', 'declined')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (worker_id, booking_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_review_prompts_worker ON public.staff_review_prompts(worker_id);

-- Доступ только через функции ниже (SECURITY DEFINER обходит RLS).
ALTER TABLE public.staff_review_prompts ENABLE ROW LEVEL SECURITY;

-- 2. Самая ранняя смена, за которую пора предложить отзыв: подтверждённая,
--    завершилась >8ч назад (но не старше 7 дней — чтобы на старте не завалить
--    официанта древними сменами), и по ней ещё нет записи в трекере.
CREATE OR REPLACE FUNCTION public.get_pending_staff_review(p_worker_id uuid)
RETURNS TABLE (booking_id uuid, restaurant_id uuid, restaurant_name text, shift_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, j.restaurant_id, r.name, j.shift_date
  FROM public.bookings b
  JOIN public.jobs j ON j.id = b.job_id
  LEFT JOIN public.restaurants r ON r."restaurantId"::text = j.restaurant_id::text
  WHERE b.worker_id = p_worker_id
    AND b.status = 'confirmed'
    AND j.shift_date >= (current_date - interval '7 days')
    AND (j.shift_date + j.end_time::time + interval '8 hours') < now()
    AND NOT EXISTS (
      SELECT 1 FROM public.staff_review_prompts p
      WHERE p.worker_id = b.worker_id AND p.booking_id = b.id
    )
  ORDER BY j.shift_date ASC, j.end_time ASC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_staff_review(uuid) TO anon, authenticated, service_role;

-- 3. Приём отзыва ('submit' — пишем оценку/коммент в staff_feedback) либо
--    отказа ('decline'). В обоих случаях фиксируем факт в трекере, чтобы по
--    этой смене больше не спрашивать.
CREATE OR REPLACE FUNCTION public.submit_staff_feedback(
  p_worker_id     uuid,
  p_booking_id    uuid,
  p_restaurant_id uuid,
  p_rating        integer,
  p_comment       text,
  p_action        text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_action NOT IN ('submit', 'decline') THEN
    RAISE EXCEPTION 'Неизвестное действие: %', p_action;
  END IF;

  IF p_action = 'submit' AND COALESCE(p_rating, 0) BETWEEN 1 AND 5 THEN
    INSERT INTO public.staff_feedback (restaurant_id, worker_id, rating_staff_overall, comment)
    VALUES (p_restaurant_id, p_worker_id, p_rating, NULLIF(btrim(COALESCE(p_comment, '')), ''));
  END IF;

  INSERT INTO public.staff_review_prompts (worker_id, booking_id, restaurant_id, status)
  VALUES (
    p_worker_id, p_booking_id, p_restaurant_id,
    CASE WHEN p_action = 'submit' THEN 'submitted' ELSE 'declined' END
  )
  ON CONFLICT (worker_id, booking_id) DO UPDATE SET status = EXCLUDED.status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_staff_feedback(uuid, uuid, uuid, integer, text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
