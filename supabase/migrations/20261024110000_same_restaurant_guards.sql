-- ============================================================
-- Объекты разных ресторанов нельзя смешать: проверки на уровне базы.
--
-- ДО: каждая таблица хранит свой restaurant_id, но ничто не проверяло, что
-- связанные строки — одного ресторана: заказ мог ссылаться на стол или
-- посадку другого ресторана, блюдо чужого ресторана могло попасть в заказ,
-- официант без связи с рестораном — оказаться на его посадке.
-- (В данных на сегодня таких нарушений нет — проверено; это защита от них.)
--
-- ТЕПЕРЬ — триггеры (отказ с ошибкой check_violation и понятным текстом):
--   • тот же ресторан: orders (стол, посадка), waiter_calls и
--     table_reservations (стол), guest_cart_drafts (посадка), menu_items
--     (раздел, подраздел, подподраздел), menu_pairings (оба блюда),
--     menu_item_costing и dish_daily_flags (блюдо), staff_shifts (вакансия);
--   • позиция заказа: блюдо — того же ресторана, что и заказ
--     (order_items), модификатор — именно этого блюда (order_item_modifiers);
--   • закрепление за столом: смена — того же ресторана, что и стол;
--   • связь официанта с рестораном (штатная запись, смена, подтверждённая
--     бронь или закрепление): table_sessions.waiter_id, waiter_calls
--     (target_waiter_id, acknowledged_by);
--   • restaurant_id нельзя менять у столов, блюд, разделов меню, вакансий,
--     заказов, посадок, вызовов и смен: «перенос» строки в другой
--     ресторан молча сломал бы все связанные.
-- Существующие строки не проверяются и не меняются.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261024110000_same_restaurant_guards.sql
-- Откат: 20261024110000_same_restaurant_guards_rollback.sql
-- ============================================================

BEGIN;

-- ── Общая проверка «связанная строка — того же ресторана» ──
-- Аргументы триггера: колонка-ссылка, SQL ресторана родителя ($1 — значение
-- колонки), название родителя для сообщения.
CREATE OR REPLACE FUNCTION public.fn_same_restaurant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_own    uuid := NULLIF(to_jsonb(NEW) ->> 'restaurant_id', '')::uuid;
  v_ref    text := to_jsonb(NEW) ->> TG_ARGV[0];
  v_parent uuid;
BEGIN
  IF v_own IS NULL OR v_ref IS NULL THEN
    RETURN NEW;  -- нечего сравнивать; существование проверяет внешний ключ
  END IF;
  EXECUTE TG_ARGV[1] INTO v_parent USING v_ref;
  IF v_parent IS NOT NULL AND v_parent <> v_own THEN
    RAISE EXCEPTION '%: % относится к другому ресторану', TG_TABLE_NAME, TG_ARGV[2]
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ── Связь официанта с рестораном ──
-- «Когда-либо работал или допущен»: штатная запись (в т. ч. прошлая), смена,
-- подтверждённая бронь на вакансию, закрепление за столом.
CREATE OR REPLACE FUNCTION public.waiter_linked_to_restaurant(p_waiter uuid, p_restaurant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.restaurant_staff s
                 WHERE s.waiter_id = p_waiter AND s.restaurant_id = p_restaurant)
      OR EXISTS (SELECT 1 FROM public.staff_shifts sh
                 WHERE sh.waiter_id = p_waiter AND sh.restaurant_id = p_restaurant)
      OR EXISTS (SELECT 1 FROM public.bookings b JOIN public.jobs j ON j.id = b.job_id
                 WHERE b.worker_id = p_waiter AND j.restaurant_id = p_restaurant
                   AND b.status NOT IN ('applied', 'rejected', 'cancelled'))
      OR EXISTS (SELECT 1 FROM public.waiter_table_assignments a JOIN public.tables t ON t.id = a.table_id
                 WHERE a.waiter_id = p_waiter AND t.restaurant_id = p_restaurant);
$$;
REVOKE ALL ON FUNCTION public.waiter_linked_to_restaurant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waiter_linked_to_restaurant(uuid, uuid) TO service_role;

-- Аргументы триггера: колонки с id официанта.
CREATE OR REPLACE FUNCTION public.fn_waiter_linked()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_own uuid := NULLIF(to_jsonb(NEW) ->> 'restaurant_id', '')::uuid;
  v_col text;
  v_w   uuid;
BEGIN
  IF v_own IS NULL THEN
    RETURN NEW;
  END IF;
  FOREACH v_col IN ARRAY TG_ARGV LOOP
    v_w := NULLIF(to_jsonb(NEW) ->> v_col, '')::uuid;
    IF v_w IS NOT NULL AND NOT public.waiter_linked_to_restaurant(v_w, v_own) THEN
      RAISE EXCEPTION '%: официант (%) не связан с рестораном (нет штатной записи, смены, брони или закрепления)',
        TG_TABLE_NAME, v_col USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

-- ── Позиция заказа: блюдо того же ресторана, что и заказ ──
CREATE OR REPLACE FUNCTION public.fn_order_item_same_restaurant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order uuid;
  v_dish  uuid;
BEGIN
  SELECT NULLIF(o.restaurant_id::text, '')::uuid INTO v_order FROM public.orders o WHERE o.id = NEW.order_id;
  SELECT m.restaurant_id INTO v_dish FROM public.menu_items m WHERE m.id = NEW.item_id;
  IF v_order IS NOT NULL AND v_dish IS NOT NULL AND v_order <> v_dish THEN
    RAISE EXCEPTION 'order_items: блюдо относится к другому ресторану, чем заказ'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ── Модификатор — именно этого блюда ──
CREATE OR REPLACE FUNCTION public.fn_order_item_modifier_same_item()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item  uuid;
  v_owner uuid;
BEGIN
  SELECT oi.item_id INTO v_item FROM public.order_items oi WHERE oi.id = NEW.order_item_id;
  SELECT g.item_id INTO v_owner
  FROM public.modifiers m JOIN public.modifier_groups g ON g.id = m.group_id
  WHERE m.id = NEW.modifier_id;
  IF v_item IS NOT NULL AND v_owner IS NOT NULL AND v_item <> v_owner THEN
    RAISE EXCEPTION 'order_item_modifiers: модификатор относится к другому блюду'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ── Закрепление за столом: смена того же ресторана, что и стол ──
CREATE OR REPLACE FUNCTION public.fn_assignment_shift_same_restaurant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_shift uuid;
  v_table uuid;
BEGIN
  IF NEW.shift_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT restaurant_id INTO v_shift FROM public.staff_shifts WHERE id = NEW.shift_id;
  SELECT restaurant_id INTO v_table FROM public.tables WHERE id = NEW.table_id;
  IF v_shift IS NOT NULL AND v_table IS NOT NULL AND v_shift <> v_table THEN
    RAISE EXCEPTION 'waiter_table_assignments: смена относится к другому ресторану, чем стол'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ── restaurant_id не меняется ──
CREATE OR REPLACE FUNCTION public.fn_restaurant_id_immutable()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id THEN
    RAISE EXCEPTION '%: нельзя перенести строку в другой ресторан', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- Триггерные функции вызывать напрямую не нужно.
REVOKE ALL ON FUNCTION public.fn_same_restaurant()                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_waiter_linked()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_order_item_same_restaurant()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_order_item_modifier_same_item()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_assignment_shift_same_restaurant() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_restaurant_id_immutable()        FROM PUBLIC, anon, authenticated;

-- ── Триггеры ──
DROP TRIGGER IF EXISTS trg_rc_orders_table_id ON public.orders;
CREATE TRIGGER trg_rc_orders_table_id
  BEFORE INSERT OR UPDATE OF table_id, restaurant_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_same_restaurant('table_id', 'SELECT restaurant_id FROM public.tables WHERE id = $1::uuid', 'стол');

DROP TRIGGER IF EXISTS trg_rc_orders_table_session_id ON public.orders;
CREATE TRIGGER trg_rc_orders_table_session_id
  BEFORE INSERT OR UPDATE OF table_session_id, restaurant_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_same_restaurant('table_session_id', 'SELECT restaurant_id FROM public.table_sessions WHERE id = $1::uuid', 'посадка');

DROP TRIGGER IF EXISTS trg_rc_waiter_calls_table_id ON public.waiter_calls;
CREATE TRIGGER trg_rc_waiter_calls_table_id
  BEFORE INSERT OR UPDATE OF table_id, restaurant_id ON public.waiter_calls
  FOR EACH ROW EXECUTE FUNCTION public.fn_same_restaurant('table_id', 'SELECT restaurant_id FROM public.tables WHERE id = $1::uuid', 'стол');

DROP TRIGGER IF EXISTS trg_rc_table_reservations_table_id ON public.table_reservations;
CREATE TRIGGER trg_rc_table_reservations_table_id
  BEFORE INSERT OR UPDATE OF table_id, restaurant_id ON public.table_reservations
  FOR EACH ROW EXECUTE FUNCTION public.fn_same_restaurant('table_id', 'SELECT restaurant_id FROM public.tables WHERE id = $1::uuid', 'стол');

DROP TRIGGER IF EXISTS trg_rc_guest_cart_drafts_session_id ON public.guest_cart_drafts;
CREATE TRIGGER trg_rc_guest_cart_drafts_session_id
  BEFORE INSERT OR UPDATE OF session_id, restaurant_id ON public.guest_cart_drafts
  FOR EACH ROW EXECUTE FUNCTION public.fn_same_restaurant('session_id', 'SELECT restaurant_id FROM public.table_sessions WHERE id = $1::uuid', 'посадка');

DROP TRIGGER IF EXISTS trg_rc_menu_items_section_id ON public.menu_items;
CREATE TRIGGER trg_rc_menu_items_section_id
  BEFORE INSERT OR UPDATE OF section_id, restaurant_id ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_same_restaurant('section_id', 'SELECT restaurant_id FROM public.menu_sections WHERE id = $1::uuid', 'раздел меню');

DROP TRIGGER IF EXISTS trg_rc_menu_items_subsection_id ON public.menu_items;
CREATE TRIGGER trg_rc_menu_items_subsection_id
  BEFORE INSERT OR UPDATE OF subsection_id, restaurant_id ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_same_restaurant('subsection_id', 'SELECT s.restaurant_id FROM public.menu_subsections ss JOIN public.menu_sections s ON s.id = ss.section_id WHERE ss.id = $1::uuid', 'подраздел меню');

DROP TRIGGER IF EXISTS trg_rc_menu_items_sub_subsection_id ON public.menu_items;
CREATE TRIGGER trg_rc_menu_items_sub_subsection_id
  BEFORE INSERT OR UPDATE OF sub_subsection_id, restaurant_id ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_same_restaurant('sub_subsection_id', 'SELECT s.restaurant_id FROM public.menu_sub_subsections x JOIN public.menu_subsections ss ON ss.id = x.subsection_id JOIN public.menu_sections s ON s.id = ss.section_id WHERE x.id = $1::uuid', 'подподраздел меню');

DROP TRIGGER IF EXISTS trg_rc_menu_pairings_dish_id ON public.menu_pairings;
CREATE TRIGGER trg_rc_menu_pairings_dish_id
  BEFORE INSERT OR UPDATE OF dish_id, restaurant_id ON public.menu_pairings
  FOR EACH ROW EXECUTE FUNCTION public.fn_same_restaurant('dish_id', 'SELECT restaurant_id FROM public.menu_items WHERE id = $1::uuid', 'блюдо');

DROP TRIGGER IF EXISTS trg_rc_menu_pairings_pair_dish_id ON public.menu_pairings;
CREATE TRIGGER trg_rc_menu_pairings_pair_dish_id
  BEFORE INSERT OR UPDATE OF pair_dish_id, restaurant_id ON public.menu_pairings
  FOR EACH ROW EXECUTE FUNCTION public.fn_same_restaurant('pair_dish_id', 'SELECT restaurant_id FROM public.menu_items WHERE id = $1::uuid', 'парное блюдо');

DROP TRIGGER IF EXISTS trg_rc_menu_item_costing_dish_id ON public.menu_item_costing;
CREATE TRIGGER trg_rc_menu_item_costing_dish_id
  BEFORE INSERT OR UPDATE OF dish_id, restaurant_id ON public.menu_item_costing
  FOR EACH ROW EXECUTE FUNCTION public.fn_same_restaurant('dish_id', 'SELECT restaurant_id FROM public.menu_items WHERE id = $1::uuid', 'блюдо');

DROP TRIGGER IF EXISTS trg_rc_dish_daily_flags_dish_id ON public.dish_daily_flags;
CREATE TRIGGER trg_rc_dish_daily_flags_dish_id
  BEFORE INSERT OR UPDATE OF dish_id, restaurant_id ON public.dish_daily_flags
  FOR EACH ROW EXECUTE FUNCTION public.fn_same_restaurant('dish_id', 'SELECT restaurant_id FROM public.menu_items WHERE id = $1::uuid', 'блюдо');

DROP TRIGGER IF EXISTS trg_rc_staff_shifts_job_id ON public.staff_shifts;
CREATE TRIGGER trg_rc_staff_shifts_job_id
  BEFORE INSERT OR UPDATE OF job_id, restaurant_id ON public.staff_shifts
  FOR EACH ROW EXECUTE FUNCTION public.fn_same_restaurant('job_id', 'SELECT restaurant_id FROM public.jobs WHERE id = $1::uuid', 'вакансия');

DROP TRIGGER IF EXISTS trg_rc_table_sessions_waiter ON public.table_sessions;
CREATE TRIGGER trg_rc_table_sessions_waiter
  BEFORE INSERT OR UPDATE OF waiter_id, restaurant_id ON public.table_sessions
  FOR EACH ROW EXECUTE FUNCTION public.fn_waiter_linked('waiter_id');

DROP TRIGGER IF EXISTS trg_rc_waiter_calls_waiter ON public.waiter_calls;
CREATE TRIGGER trg_rc_waiter_calls_waiter
  BEFORE INSERT OR UPDATE OF target_waiter_id, acknowledged_by, restaurant_id ON public.waiter_calls
  FOR EACH ROW EXECUTE FUNCTION public.fn_waiter_linked('target_waiter_id', 'acknowledged_by');

DROP TRIGGER IF EXISTS trg_rc_tables_immutable ON public.tables;
CREATE TRIGGER trg_rc_tables_immutable
  BEFORE UPDATE OF restaurant_id ON public.tables
  FOR EACH ROW EXECUTE FUNCTION public.fn_restaurant_id_immutable();

DROP TRIGGER IF EXISTS trg_rc_menu_items_immutable ON public.menu_items;
CREATE TRIGGER trg_rc_menu_items_immutable
  BEFORE UPDATE OF restaurant_id ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_restaurant_id_immutable();

DROP TRIGGER IF EXISTS trg_rc_menu_sections_immutable ON public.menu_sections;
CREATE TRIGGER trg_rc_menu_sections_immutable
  BEFORE UPDATE OF restaurant_id ON public.menu_sections
  FOR EACH ROW EXECUTE FUNCTION public.fn_restaurant_id_immutable();

DROP TRIGGER IF EXISTS trg_rc_jobs_immutable ON public.jobs;
CREATE TRIGGER trg_rc_jobs_immutable
  BEFORE UPDATE OF restaurant_id ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.fn_restaurant_id_immutable();

DROP TRIGGER IF EXISTS trg_rc_orders_immutable ON public.orders;
CREATE TRIGGER trg_rc_orders_immutable
  BEFORE UPDATE OF restaurant_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_restaurant_id_immutable();

DROP TRIGGER IF EXISTS trg_rc_table_sessions_immutable ON public.table_sessions;
CREATE TRIGGER trg_rc_table_sessions_immutable
  BEFORE UPDATE OF restaurant_id ON public.table_sessions
  FOR EACH ROW EXECUTE FUNCTION public.fn_restaurant_id_immutable();

DROP TRIGGER IF EXISTS trg_rc_waiter_calls_immutable ON public.waiter_calls;
CREATE TRIGGER trg_rc_waiter_calls_immutable
  BEFORE UPDATE OF restaurant_id ON public.waiter_calls
  FOR EACH ROW EXECUTE FUNCTION public.fn_restaurant_id_immutable();

DROP TRIGGER IF EXISTS trg_rc_staff_shifts_immutable ON public.staff_shifts;
CREATE TRIGGER trg_rc_staff_shifts_immutable
  BEFORE UPDATE OF restaurant_id ON public.staff_shifts
  FOR EACH ROW EXECUTE FUNCTION public.fn_restaurant_id_immutable();

DROP TRIGGER IF EXISTS trg_rc_order_items ON public.order_items;
CREATE TRIGGER trg_rc_order_items
  BEFORE INSERT OR UPDATE OF order_id, item_id ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_order_item_same_restaurant();

DROP TRIGGER IF EXISTS trg_rc_order_item_modifiers ON public.order_item_modifiers;
CREATE TRIGGER trg_rc_order_item_modifiers
  BEFORE INSERT OR UPDATE OF order_item_id, modifier_id ON public.order_item_modifiers
  FOR EACH ROW EXECUTE FUNCTION public.fn_order_item_modifier_same_item();

DROP TRIGGER IF EXISTS trg_rc_waiter_table_assignments_shift ON public.waiter_table_assignments;
CREATE TRIGGER trg_rc_waiter_table_assignments_shift
  BEFORE INSERT OR UPDATE OF shift_id, table_id ON public.waiter_table_assignments
  FOR EACH ROW EXECUTE FUNCTION public.fn_assignment_shift_same_restaurant();

COMMIT;
NOTIFY pgrst, 'reload schema';
