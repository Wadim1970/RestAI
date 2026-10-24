-- ============================================================
-- Официант видит и меняет данные только тех ресторанов, куда допущен.
--
-- БЫЛО: после входа любой официант (authenticated) читал и менял заказы,
-- позиции и посадки ВСЕХ ресторанов — политики с условием true. Допуск к
-- «своему» ресторану проверялся только в браузере (hasConfirmedShiftToday).
--
-- СТАЛО: функция waiter_can_access_restaurant(ресторан) пускает официанта,
-- если выполняется одно из условий:
--   • он действующий сотрудник ресторана (restaurant_staff, не уволен);
--   • у него подтверждённая бронь на вакансию этого ресторана на сегодня
--     (допуск по дате с запасом в сутки: ночные смены и часовые пояса);
--   • у него открыта смена в этом ресторане сегодня (staff_shifts);
--   • он закреплён за столом этого ресторана (постоянно или на сегодня).
-- Это то же правило, что приложение проверяло у себя, плюс штат.
--
-- Затронуто: orders, order_items, order_guests (включается RLS),
-- order_item_modifiers, table_sessions (только для authenticated; чтение
-- для anon не меняется). Не затронуто: tables, waiter_calls,
-- waiter_table_assignments, staff_shifts — отдельным шагом.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < 20261024060000_waiter_restaurant_scope.sql
-- Откат: 20261024060000_waiter_restaurant_scope_rollback.sql
-- ============================================================

BEGIN;

-- ── Допуск официанта к ресторану ──
CREATE OR REPLACE FUNCTION public.waiter_can_access_restaurant(p_restaurant_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH me AS (SELECT public.current_waiter_id() AS id),
       r  AS (SELECT CASE WHEN p_restaurant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          THEN p_restaurant_id::uuid END AS id)
  SELECT COALESCE((
    SELECT me.id IS NOT NULL AND r.id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM public.restaurant_staff s
              WHERE s.waiter_id = me.id AND s.restaurant_id = r.id AND s.dismissal_date IS NULL)
      OR EXISTS (SELECT 1 FROM public.bookings b JOIN public.jobs j ON j.id = b.job_id
                 WHERE b.worker_id = me.id AND b.status = 'confirmed' AND j.restaurant_id = r.id
                   AND j.shift_date BETWEEN (now() AT TIME ZONE 'UTC')::date - 1
                                        AND (now() AT TIME ZONE 'UTC')::date + 1)
      OR EXISTS (SELECT 1 FROM public.staff_shifts sh
                 WHERE sh.waiter_id = me.id AND sh.restaurant_id = r.id
                   AND sh.shift_date BETWEEN (now() AT TIME ZONE 'UTC')::date - 1
                                         AND (now() AT TIME ZONE 'UTC')::date + 1)
      OR EXISTS (SELECT 1 FROM public.waiter_table_assignments a JOIN public.tables t ON t.id = a.table_id
                 WHERE a.waiter_id = me.id AND t.restaurant_id = r.id
                   AND (a.is_permanent OR a.assigned_date = (now() AT TIME ZONE 'UTC')::date))
    )
    FROM me, r
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.waiter_can_access_order(p_order_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT public.waiter_can_access_restaurant(o.restaurant_id)
                   FROM public.orders o WHERE o.id = p_order_id), false);
$$;

REVOKE ALL ON FUNCTION public.waiter_can_access_restaurant(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.waiter_can_access_order(uuid)      FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waiter_can_access_restaurant(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.waiter_can_access_order(uuid)      TO authenticated, service_role;

-- ── orders ──
DROP POLICY IF EXISTS orders_select      ON public.orders;
DROP POLICY IF EXISTS orders_insert      ON public.orders;
DROP POLICY IF EXISTS orders_insert_anon ON public.orders;
DROP POLICY IF EXISTS orders_update      ON public.orders;
DROP POLICY IF EXISTS orders_update_anon ON public.orders;
CREATE POLICY orders_select_waiter ON public.orders FOR SELECT TO authenticated
  USING (public.waiter_can_access_restaurant(restaurant_id));
CREATE POLICY orders_insert_waiter ON public.orders FOR INSERT TO authenticated
  WITH CHECK (public.waiter_can_access_restaurant(restaurant_id));
CREATE POLICY orders_update_waiter ON public.orders FOR UPDATE TO authenticated
  USING (public.waiter_can_access_restaurant(restaurant_id))
  WITH CHECK (public.waiter_can_access_restaurant(restaurant_id));

-- ── order_items ──
DROP POLICY IF EXISTS order_items_select ON public.order_items;
DROP POLICY IF EXISTS order_items_insert ON public.order_items;
DROP POLICY IF EXISTS order_items_update ON public.order_items;
DROP POLICY IF EXISTS order_items_delete ON public.order_items;
CREATE POLICY order_items_select_waiter ON public.order_items FOR SELECT TO authenticated
  USING (public.waiter_can_access_order(order_id));
CREATE POLICY order_items_insert_waiter ON public.order_items FOR INSERT TO authenticated
  WITH CHECK (public.waiter_can_access_order(order_id));
CREATE POLICY order_items_update_waiter ON public.order_items FOR UPDATE TO authenticated
  USING (public.waiter_can_access_order(order_id))
  WITH CHECK (public.waiter_can_access_order(order_id));
CREATE POLICY order_items_delete_waiter ON public.order_items FOR DELETE TO authenticated
  USING (public.waiter_can_access_order(order_id));

-- ── order_guests (RLS раньше не было) ──
ALTER TABLE public.order_guests ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_guests_select_waiter ON public.order_guests FOR SELECT TO authenticated
  USING (public.waiter_can_access_order(order_id));
CREATE POLICY order_guests_insert_waiter ON public.order_guests FOR INSERT TO authenticated
  WITH CHECK (public.waiter_can_access_order(order_id));
CREATE POLICY order_guests_update_waiter ON public.order_guests FOR UPDATE TO authenticated
  USING (public.waiter_can_access_order(order_id))
  WITH CHECK (public.waiter_can_access_order(order_id));
CREATE POLICY order_guests_delete_waiter ON public.order_guests FOR DELETE TO authenticated
  USING (public.waiter_can_access_order(order_id));

-- ── order_item_modifiers: читал anon без ограничений ──
DROP POLICY IF EXISTS oim_select ON public.order_item_modifiers;
CREATE POLICY oim_select_waiter ON public.order_item_modifiers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.order_items i
                 WHERE i.id = order_item_id AND public.waiter_can_access_order(i.order_id)));

-- ── table_sessions: для официантов — по ресторану; anon читает как раньше ──
DROP POLICY IF EXISTS ts_select ON public.table_sessions;
DROP POLICY IF EXISTS ts_insert ON public.table_sessions;
DROP POLICY IF EXISTS ts_update ON public.table_sessions;
CREATE POLICY ts_select_anon ON public.table_sessions FOR SELECT TO anon USING (true);
CREATE POLICY ts_select_waiter ON public.table_sessions FOR SELECT TO authenticated
  USING (public.waiter_can_access_restaurant(COALESCE(restaurant_id::text,
         (SELECT t.restaurant_id::text FROM public.tables t WHERE t.id = table_id))));
CREATE POLICY ts_insert_waiter ON public.table_sessions FOR INSERT TO authenticated
  WITH CHECK (public.waiter_can_access_restaurant(COALESCE(restaurant_id::text,
         (SELECT t.restaurant_id::text FROM public.tables t WHERE t.id = table_id))));
CREATE POLICY ts_update_waiter ON public.table_sessions FOR UPDATE TO authenticated
  USING (public.waiter_can_access_restaurant(COALESCE(restaurant_id::text,
         (SELECT t.restaurant_id::text FROM public.tables t WHERE t.id = table_id))))
  WITH CHECK (public.waiter_can_access_restaurant(COALESCE(restaurant_id::text,
         (SELECT t.restaurant_id::text FROM public.tables t WHERE t.id = table_id))));

COMMIT;
NOTIFY pgrst, 'reload schema';
