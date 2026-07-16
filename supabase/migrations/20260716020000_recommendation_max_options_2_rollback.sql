BEGIN;

UPDATE public.restaurant_ai_profiles
SET restaurant_policy = jsonb_set(restaurant_policy, '{recommendation_policy,max_options}', '3'),
    updated_at = now()
WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee';

COMMIT;
