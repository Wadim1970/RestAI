-- ============================================================
-- Официант сам выбирает столы: галочка в «Все столы» → стол в «Мои столы».
--
--   • waiter_table_assignments.source — кто закрепил стол: 'admin' (админка,
--     как раньше) или 'self' (сам официант галочкой). Все прежние строки —
--     'admin'.
--   • set_my_table(стол, true|false) — ставит или снимает галочку ТОЛЬКО для
--     самого вошедшего официанта и только для столов ресторанов, куда он
--     допущен (waiter_can_access_restaurant). Снимает только свои галочки
--     (source = 'self'): закрепление администратора остаётся. Прямую запись в
--     таблицу приложению не открываем (права на запись закрыты, как были).
--   • Срока у галочки нет: стоит, пока официант сам её не снимет.
--   • За стол могут быть закреплены несколько официантов. Вызовы гостей уже
--     работают так: за столом один закреплённый — вызов ему, иначе (нет
--     закреплённых или несколько) — всем в ресторане. Администратор может не
--     закреплять никого — всё продолжает работать.
--   • fn_assignment_guard использует общую проверку связи официанта с
--     рестораном (waiter_linked_to_restaurant): официант, попавший в ресторан
--     через закрепление, может отметить и другие столы.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261024140000_self_select_tables.sql
-- Откат: 20261024140000_self_select_tables_rollback.sql
-- ============================================================

BEGIN;

ALTER TABLE public.waiter_table_assignments
  ADD COLUMN source text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'self'));

COMMENT ON COLUMN public.waiter_table_assignments.source IS
  'Кто закрепил стол: admin — администратор (админка), self — сам официант галочкой.';

-- Одна «своя» галочка на пару официант + стол.
CREATE UNIQUE INDEX wta_self_unique_idx
  ON public.waiter_table_assignments (waiter_id, table_id) WHERE source = 'self';

-- Защита закрепления: связь официанта с рестораном стола — общая проверка.
CREATE OR REPLACE FUNCTION public.fn_assignment_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  r uuid;
BEGIN
  SELECT restaurant_id INTO r FROM public.tables WHERE id = NEW.table_id;
  IF r IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.waiter_linked_to_restaurant(NEW.waiter_id, r) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Официант не связан с рестораном этого стола (нет ни штатной записи, ни смены, ни брони, ни закрепления)'
    USING ERRCODE = 'check_violation';
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_assignment_guard() FROM PUBLIC, anon, authenticated;

-- Галочка «обслуживаю этот стол». Возвращает состояние стола для этого официанта:
--   selected — стоит ли его собственная галочка;
--   locked   — закреплён администратором (постоянно или на сегодня), снять нельзя.
CREATE OR REPLACE FUNCTION public.set_my_table(p_table_id uuid, p_selected boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me    uuid := public.current_waiter_id();
  v_rest  uuid;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Нужен вход официанта' USING ERRCODE = '42501';
  END IF;

  SELECT t.restaurant_id INTO v_rest FROM public.tables t WHERE t.id = p_table_id AND t.is_active;
  IF v_rest IS NULL THEN
    RAISE EXCEPTION 'Стол не найден' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT public.waiter_can_access_restaurant(v_rest) THEN
    RAISE EXCEPTION 'Нет допуска к этому ресторану' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(p_selected, false) THEN
    INSERT INTO public.waiter_table_assignments (waiter_id, table_id, is_permanent, assigned_date, source)
    VALUES (v_me, p_table_id, true, v_today, 'self')
    ON CONFLICT (waiter_id, table_id) WHERE source = 'self' DO NOTHING;
  ELSE
    DELETE FROM public.waiter_table_assignments
    WHERE waiter_id = v_me AND table_id = p_table_id AND source = 'self';
  END IF;

  RETURN jsonb_build_object(
    'selected', EXISTS (SELECT 1 FROM public.waiter_table_assignments a
                        WHERE a.waiter_id = v_me AND a.table_id = p_table_id AND a.source = 'self'),
    'locked',   EXISTS (SELECT 1 FROM public.waiter_table_assignments a
                        WHERE a.waiter_id = v_me AND a.table_id = p_table_id AND a.source = 'admin'
                          AND (a.is_permanent OR a.assigned_date = v_today))
  );
END $$;

REVOKE ALL ON FUNCTION public.set_my_table(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_table(uuid, boolean) TO authenticated, service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
