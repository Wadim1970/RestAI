import { createClient } from '@supabase/supabase-js'
import { mealAt, mealOfCart, roleOf, mealsFor, suitsMeal } from '../shared/mealCore.js'

// Меню ресторана одинаково для всех гостей и почти не меняется в течение дня,
// но раньше каждый гость грузил его напрямую из Supabase при каждом заходе.
// Эта функция кэшируется на Vercel Edge (Cache-Control ниже): в пределах
// s-maxage тысячи гостей одного ресторана получают ответ из CDN, а не бьют
// в Supabase каждый своим запросом.
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)

export default async function handler(req, res) {
  const { restaurantId } = req.query

  if (!restaurantId) {
    res.status(400).json({ error: 'restaurantId обязателен' })
    return
  }

  // description/ingredients/product_type/specific_details нужны карточке
  // блюда (DishModal). Отдаём их сразу вместе с меню, чтобы карточка НЕ
  // ходила отдельным запросом напрямую в Supabase из браузера — такой
  // прямой запрос падал по таймауту/CORS в сетях, где хост Supabase
  // недоступен, хотя /api (этот same-origin роут) работает.
  const BASE_COLS = 'id, dish_name, menu_section, section_order, cost_rub, image_url, image_url_thumbnail, nutritional_info, weight_g, cook_time_min, description, ingredients, product_type, specific_details'
  // stop_until / urgent_until — стоп-лист и «срочно продать» из раздела
  // «Кухня» админки (миграция 20261025010000_kitchen).
  // course_role / meal_times — ручная роль блюда и время подачи
  // (миграция 20261026010000_cart_advice); пусто — по разделу и названию.
  const query = (hideHidden, kitchen = true, meal = true) => {
    let q = supabase
      .from('menu_items')
      .select([BASE_COLS, kitchen && 'stop_until, urgent_until', meal && 'course_role, meal_times'].filter(Boolean).join(', '))
      .eq('restaurant_id', restaurantId)
    // is_hidden — «скрыто от гостя» (Лавка, комбо и т.п.): официант их видит,
    // гость — нет.
    if (hideHidden) q = q.eq('is_hidden', false)
    return q
      .order('section_order', { ascending: true })
      .order('dish_name', { ascending: true })
  }

  let { data, error } = await query(true)
  // Нет колонок ролей, «Кухни» или is_hidden (миграции не применены) — меню
  // всё равно работает, без ролей, без стопа или без скрытия.
  if (error && error.code === '42703') ({ data, error } = await query(true, true, false))
  if (error && error.code === '42703') ({ data, error } = await query(true, false, false))
  if (error && error.code === '42703') ({ data, error } = await query(false, false, false))

  if (error) {
    // Раньше отдавали только общий текст и глотали настоящую причину —
    // из-за этого сбой PostgREST (например, PGRST205 «таблицы нет в кэше
    // схемы» после reload) выглядел в консоли гостя одинаково загадочно.
    // Теперь пробрасываем code/message/hint, чтобы диагностировать сразу.
    console.error('menu_items query failed:', error)
    res.status(502).json({
      error: 'Не удалось загрузить меню',
      code: error.code || null,
      detail: error.message || null,
      hint: error.hint || null,
    })
    return
  }

  // stopped — «нет в наличии» (гость видит, но заказать не может, ИИ не
  // предлагает); priority 0–3 — рекомендовать в первую очередь.
  const now = Date.now()
  const active = (t) => !!t && (t === 'infinity' || new Date(t).getTime() > now)
  const [priorities, meal] = await Promise.all([loadPriorities(restaurantId), currentMeal(restaurantId)])
  const items = (data ?? []).map(({ stop_until, urgent_until, course_role, meal_times, ...it }) => {
    const ref = { name: it.dish_name, section: it.menu_section, productType: it.product_type, role: course_role, mealTimes: meal_times }
    return {
      ...it,
      stopped: active(stop_until),
      priority: Math.max(priorities.get(it.id) || 0, active(urgent_until) ? 3 : 0),
      // Роль блюда и когда его уместно предлагать (завтрак/обед/ужин/поздний
      // вечер) — для пар в меню и голосового ассистента.
      role: roleOf(ref),
      meals: mealsFor(ref),
    }
  })

  // Кэш — минута: на смене завтрака на обед подсказки поменяются почти сразу.
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  res.status(200).json({ items, meal, pairings: await loadPairings(restaurantId, items, meal) })
}

// Приём пищи сейчас — по часам ресторана: до 12 завтрак, до 17 обед, до 22
// ужин, позже — поздний вечер.
async function currentMeal(restaurantId) {
  const { data } = await supabase.from('restaurants').select('timezone').eq('id', restaurantId).maybeSingle()
  return mealAt(new Date(), data?.timezone || 'Europe/Moscow')
}

// Приоритет блюд в рекомендациях (раздел «Кухня»): только уровень, без маржи.
// Нет функции (миграция не применена) — без приоритетов.
async function loadPriorities(restaurantId) {
  const { data, error } = await supabase.rpc('guest_menu_priorities', { p_restaurant_id: restaurantId })
  if (error) return new Map()
  return new Map((data || []).map((r) => [r.dish_id, r.priority || 0]))
}

// Пары блюд для подсказки «к этому блюду отлично подходит…»: { <блюдо>:
// [{dishId, lead, why}] }, ручные пары менеджера первыми, не больше двух на
// блюдо. Составляет их сервер официанта (Waiter-app, api/pairings). Нет
// таблицы или пар — пустой объект: меню работает как раньше, без подсказок.
async function loadPairings(restaurantId, items = [], meal = null) {
  const { data, error } = await supabase
    .from('menu_pairings')
    .select('dish_id, pair_dish_id, rank, lead, reason, source')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'active')
  if (error) {
    if (error.code !== 'PGRST205' && error.code !== '42P01') console.error('menu_pairings query failed:', error)
    return {}
  }
  // Блюда в стопе гостю не предлагаем; неуместное по времени — тоже (утром к
  // сырникам — кофе, а не стейк; завтрак остаётся завтраком в любое время).
  // Приоритетные — первыми.
  const byId = new Map(items.map((i) => [i.id, i]))
  const fitsMeal = (p) => {
    const anchor = byId.get(p.dish_id)
    const pair = byId.get(p.pair_dish_id)
    if (!meal || !anchor || !pair) return true
    return suitsMeal({ mealTimes: pair.meals }, mealOfCart([anchor.role], meal))
  }
  const sorted = (data || [])
    .filter((p) => !byId.get(p.pair_dish_id)?.stopped && fitsMeal(p))
    .sort((x, y) => (byId.get(y.pair_dish_id)?.priority || 0) - (byId.get(x.pair_dish_id)?.priority || 0)
      || (x.source === 'manual' ? 0 : 1) - (y.source === 'manual' ? 0 : 1) || x.rank - y.rank)
  const out = {}
  for (const p of sorted) {
    const list = (out[p.dish_id] ||= [])
    if (list.length < 2) list.push({ dishId: p.pair_dish_id, lead: p.lead, why: p.reason })
  }
  return out
}
