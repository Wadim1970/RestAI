import { createClient } from '@supabase/supabase-js'

// Брендинг ресторана — та же логика кэширования, что и в menu.js:
// одинаков для всех гостей, меняется редко, но раньше грузился заново
// при каждом заходе каждого гостя.
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)

export default async function handler(req, res) {
  const { restaurantId } = req.query

  if (!restaurantId) {
    res.status(400).json({ error: 'restaurantId обязателен' })
    return
  }

  const { data, error } = await supabase
    .from('restaurants')
    .select(
      'name, branding_primary_color, branding_accent_color, branding_background_color, branding_price_bg_color, branding_heading_font, branding_body_font, font_url_header, font_url_body'
    )
    .eq('restaurantId', restaurantId)
    .single()

  if (error) {
    res.status(502).json({ error: 'Не удалось загрузить брендинг' })
    return
  }

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  res.status(200).json({ data })
}
