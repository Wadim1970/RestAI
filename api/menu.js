import { createClient } from '@supabase/supabase-js'

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

  const { data, error } = await supabase
    .from('menu_items')
    // description/ingredients/product_type/specific_details нужны карточке
    // блюда (DishModal). Отдаём их сразу вместе с меню, чтобы карточка НЕ
    // ходила отдельным запросом напрямую в Supabase из браузера — такой
    // прямой запрос падал по таймауту/CORS в сетях, где хост Supabase
    // недоступен, хотя /api (этот same-origin роут) работает.
    .select('id, dish_name, menu_section, section_order, cost_rub, image_url, image_url_thumbnail, nutritional_info, weight_g, cook_time_min, description, ingredients, product_type, specific_details')
    .eq('restaurant_id', restaurantId)
    .order('section_order', { ascending: true })
    .order('dish_name', { ascending: true })

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

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  res.status(200).json({ items: data ?? [], pairings: await loadPairings(restaurantId) })
}

// Пары блюд для подсказки «к этому блюду отлично подходит…»: { <блюдо>:
// [{dishId, lead, why}] }, ручные пары менеджера первыми, не больше двух на
// блюдо. Составляет их сервер официанта (Waiter-app, api/pairings). Нет
// таблицы или пар — пустой объект: меню работает как раньше, без подсказок.
async function loadPairings(restaurantId) {
  const { data, error } = await supabase
    .from('menu_pairings')
    .select('dish_id, pair_dish_id, rank, lead, reason, source')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'active')
  if (error) {
    if (error.code !== 'PGRST205' && error.code !== '42P01') console.error('menu_pairings query failed:', error)
    return {}
  }
  const sorted = (data || []).sort((x, y) =>
    (x.source === 'manual' ? 0 : 1) - (y.source === 'manual' ? 0 : 1) || x.rank - y.rank)
  const out = {}
  for (const p of sorted) {
    const list = (out[p.dish_id] ||= [])
    if (list.length < 2) list.push({ dishId: p.pair_dish_id, lead: p.lead, why: p.reason })
  }
  return out
}
