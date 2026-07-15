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
    .select('id, dish_name, menu_section, section_order, cost_rub, image_url, image_url_thumbnail, nutritional_info, weight_g, cook_time_min')
    .eq('restaurant_id', restaurantId)
    .order('section_order', { ascending: true })
    .order('dish_name', { ascending: true })

  if (error) {
    res.status(502).json({ error: 'Не удалось загрузить меню' })
    return
  }

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  res.status(200).json({ items: data ?? [] })
}
