-- Откат 20261024120000_restaurants_id_rename.sql: id снова "restaurantId",
-- функции возвращены к прежним определениям.
BEGIN;

ALTER TABLE public.restaurants DROP COLUMN IF EXISTS "restaurantId";
ALTER TABLE public.restaurants RENAME COLUMN id TO "restaurantId";

CREATE OR REPLACE FUNCTION public.fn_calculate_restaurant_ratings()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF (TG_TABLE_NAME = 'staff_feedback') THEN
    UPDATE restaurants SET rating_staff = (
      SELECT COALESCE(AVG(rating_staff_overall),0) FROM staff_feedback
      WHERE restaurant_id = COALESCE(NEW.restaurant_id, OLD.restaurant_id))
    WHERE "restaurantId"::text = COALESCE(NEW.restaurant_id, OLD.restaurant_id)::text;
  ELSIF (TG_TABLE_NAME = 'reviews') THEN
    UPDATE restaurants SET
      rating_kitchen = (SELECT COALESCE(AVG(rating_food),0) FROM reviews
        WHERE restaurant_id = COALESCE(NEW.restaurant_id, OLD.restaurant_id)),
      rating_service = (SELECT COALESCE(AVG(rating_service),0) FROM reviews
        WHERE restaurant_id = COALESCE(NEW.restaurant_id, OLD.restaurant_id))
    WHERE "restaurantId"::text = COALESCE(NEW.restaurant_id, OLD.restaurant_id)::text;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_daily_tokens()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_pending_staff_review(p_worker_id uuid)
 RETURNS TABLE(booking_id uuid, restaurant_id uuid, restaurant_name text, shift_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_restaurant_details(p_restaurant_id uuid, p_shift_date date)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'restaurant', (
      SELECT json_build_object(
        'id', r."restaurantId",
        'name', r.name,
        'address', r.address,
        'rating_staff', r.rating_staff,
        'number_of_voters', r.number_of_voters,
        'photo_url', 'https://utdfzrpkoscyikitceow.supabase.co/storage/v1/object/public/foto_restaurants/foto_holl.png'
      )
      FROM restaurants r
      WHERE r."restaurantId" = p_restaurant_id
    ),
    'job', (
      SELECT json_build_object(
        'start_time', TO_CHAR(j.start_time, 'HH24:MI'),
        'end_time', TO_CHAR(j.end_time, 'HH24:MI'),
        'pay_amount', j.pay_amount,
        'dress_code', j.dress_code,
        'tips_distribution', j.tips_distribution,
        'nutrition', j.nutrition,
        'required_documents', j.required_documents,
        'responsibility_zone', j.responsibility_zone,
        'duties', j.duties,
        'required_technologies', j.required_technologies,
        'slots_available', j.slots_available
      )
      FROM jobs j
      WHERE j.restaurant_id = p_restaurant_id
        AND j.shift_date = p_shift_date
      LIMIT 1
    ),
    'reviews', (
      SELECT json_agg(
        json_build_object(
          'name', rw.name,
          'comment', rw.comment,
          'rating', rw.rating,
          'created_at', rw.created_at
        )
        ORDER BY rw.created_at DESC
      )
      FROM reviews_waiter rw
      WHERE rw.restaurant_id = p_restaurant_id
    )
  ) INTO result;
  
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.table_sessions_fill_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text;
BEGIN
  IF NEW.restaurant_id IS NULL THEN
    SELECT t.restaurant_id INTO NEW.restaurant_id FROM public.tables t WHERE t.id = NEW.table_id;
  END IF;

  IF NEW.waiter_id IS NULL THEN
    SELECT COALESCE(NULLIF(r.timezone, ''), 'Europe/Moscow') INTO v_tz
    FROM public.restaurants r WHERE r."restaurantId" = NEW.restaurant_id;

    SELECT a.waiter_id INTO NEW.waiter_id
    FROM public.waiter_table_assignments a
    WHERE a.table_id = NEW.table_id
      AND (a.is_permanent
           OR a.assigned_date = (now() AT TIME ZONE 'UTC')::date
           OR a.assigned_date = (now() AT TIME ZONE COALESCE(v_tz, 'Europe/Moscow'))::date)
    ORDER BY a.is_permanent ASC, a.created_at DESC
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_generate_qr()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Новый ресторан сразу получает токен на сегодня; дальше его меняет
  -- ночной планировщик (generate_daily_tokens).
  INSERT INTO restaurant_daily_tokens (restaurant_id, token, valid_date)
  VALUES (NEW."restaurantId", encode(gen_random_bytes(16), 'hex'), CURRENT_DATE)
  ON CONFLICT (restaurant_id, valid_date) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_restaurant_rating()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  avg_rating NUMERIC;
BEGIN
  -- Вычисляем средний рейтинг для ресторана
  SELECT AVG(rating)::NUMERIC(10,1) 
  INTO avg_rating
  FROM reviews_waiter
  WHERE restaurant_id = NEW.restaurant_id;
  
  -- Обновляем поле rating_staff в таблице restaurants
  UPDATE restaurants
  SET rating_staff = avg_rating
  WHERE "restaurantId" = NEW.restaurant_id;
  
  -- Логируем для отладки
  RAISE NOTICE 'Обновлён рейтинг ресторана % на %', NEW.restaurant_id, avg_rating;
  
  RETURN NEW;
END;
$function$;

COMMIT;
NOTIFY pgrst, 'reload schema';
