import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

// Ленивая инициализация — как и с OPENAI_API_KEY в openaiRealtime.js,
// отсутствие/опечатка в переменных окружения не должна ронять весь
// процесс при старте (тогда бы не отвечал даже /health), а только
// голосовую сессию конкретного гостя, когда до неё дойдёт дело.
let supabase = null;
function getSupabase() {
  if (!supabase) supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  return supabase;
}

// dish_id/last_computed_at не несут смысла для модели — то же решение,
// что уже принято в RestAI-клиенте (AIChatModal/useChatApi.js).
function stripForAI(topDishes) {
  return (topDishes || []).map(({ name, times }) => ({ name, times }));
}

// Тот же анонимный ключ и те же запросы, что уже делает текстовый чат
// с клиента (useChatApi.js) — guests.preferences и guest_restaurant_stats
// открыты на SELECT анониму именно для этого сценария, отдельный
// сервис-ключ Supabase здесь не нужен.
async function loadGuestContext(guestId, restaurantId) {
  if (!guestId) return { preferences: null, restaurantHistory: null };

  const { data: guestRow } = await getSupabase()
    .from('guests')
    .select('preferences, visit_count, avg_check')
    .eq('id', guestId)
    .single();

  const prefs = guestRow?.preferences || {};
  const preferences = {
    tags: prefs.tags,
    sections: prefs.sections,
    top_dishes: stripForAI(prefs.top_dishes),
    total_orders: prefs.total_orders,
    comments: prefs.comments,
    visit_count: guestRow?.visit_count || 0,
    avg_check: guestRow?.avg_check || 0,
  };

  let restaurantHistory = null;
  if (restaurantId) {
    const { data } = await getSupabase()
      .from('guest_restaurant_stats')
      .select('tags, top_dishes, avg_check, total_orders')
      .eq('guest_id', guestId)
      .eq('restaurant_id', restaurantId)
      .maybeSingle();
    if (data) restaurantHistory = { ...data, top_dishes: stripForAI(data.top_dishes) };
  }

  return { preferences, restaurantHistory };
}

// Тот же публичный, закэшированный на Vercel Edge эндпоинт, которым уже
// пользуется MenuPage.jsx — не бьём в Supabase отдельным запросом.
async function loadMenuSummary(restaurantId) {
  if (!restaurantId) return '';
  const res = await fetch(`${config.menuApiBaseUrl}/api/menu?restaurantId=${encodeURIComponent(restaurantId)}`);
  if (!res.ok) return '';
  const { items } = await res.json();

  // Сжатая версия для системного промпта: полные описания и состав блюда
  // сюда не тащим (лишние токены) — появятся отдельным тулом на этапе
  // синхронизации голоса с экраном.
  return (items || [])
    .map((i) => `${i.dish_name} — ${i.menu_section} — ${i.cost_rub}₽`)
    .join('\n');
}

const INSTRUCTIONS_TEMPLATE = `Ты — голосовой помощник ресторана RestAI. Говори по-русски, дружелюбно и
живо, короткими фразами (это голос, а не текст на экране). Помогай гостю
выбрать блюда, рассказывай о них с удовольствием, к месту — короткую
забавную историю. Никогда не выдумывай блюда и цены, которых нет в меню.

Меню ресторана:
{{menu}}

Профиль гостя (используй для персонализации мягко, не зачитывай как список):
{{profile}}`;

export async function buildSessionContext({ guestId, restaurantId }) {
  const [{ preferences, restaurantHistory }, menu] = await Promise.all([
    loadGuestContext(guestId, restaurantId),
    loadMenuSummary(restaurantId),
  ]);

  const instructions = INSTRUCTIONS_TEMPLATE
    .replace('{{menu}}', menu || '(меню недоступно)')
    .replace('{{profile}}', JSON.stringify({ preferences, restaurantHistory }));

  return { instructions };
}
