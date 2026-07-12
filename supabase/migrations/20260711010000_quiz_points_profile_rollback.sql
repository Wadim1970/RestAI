BEGIN;

DROP FUNCTION IF EXISTS public.register_guest_and_credit_quiz(text, text, text, uuid, integer);
DROP FUNCTION IF EXISTS public.update_guest_profile(text, text, smallint, smallint, text);
DROP FUNCTION IF EXISTS public.check_quiz_answer(uuid, integer);
DROP FUNCTION IF EXISTS public.get_random_quiz_question(bigint);

DROP TABLE IF EXISTS public.quiz_attempts;
DROP TABLE IF EXISTS public.quiz_questions;

ALTER TABLE public.guests DROP CONSTRAINT IF EXISTS guests_birthday_month_check;
ALTER TABLE public.guests DROP CONSTRAINT IF EXISTS guests_birthday_day_check;
ALTER TABLE public.guests DROP COLUMN IF EXISTS dislikes;
ALTER TABLE public.guests DROP COLUMN IF EXISTS birthday_month;
ALTER TABLE public.guests DROP COLUMN IF EXISTS birthday_day;
ALTER TABLE public.guests DROP COLUMN IF EXISTS points;

NOTIFY pgrst, 'reload schema';

COMMIT;
