import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { compileCharacterProfile, compileRestaurantPolicy } from './promptCompiler.js';

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
// пользуется MenuPage.jsx. Меню ресторана — самая тяжёлая часть промта
// (десятки блюд, килобайты текста) и почти не меняется в течение дня, а
// сеть до Vercel — заметная доля задержки перед первой репликой ИИ.
// Держим свой, ещё более короткоживущий кэш поверх edge-кэша: пока он не
// протух, открытие голосовой сессии вообще не ходит в сеть за меню.
const MENU_CACHE_TTL_MS = 60_000; // совпадает с s-maxage у /api/menu
const menuCache = new Map(); // restaurantId -> { text, expiresAt }

async function loadMenuSummary(restaurantId) {
  if (!restaurantId) return '';

  const cached = menuCache.get(restaurantId);
  if (cached && cached.expiresAt > Date.now()) return cached.text;

  const res = await fetch(`${config.menuApiBaseUrl}/api/menu?restaurantId=${encodeURIComponent(restaurantId)}`);
  // Сеть/эндпоинт подвели — лучше отдать протухший, но живой кэш, чем
  // оставить ИИ вовсе без меню на этот разговор.
  if (!res.ok) return cached?.text ?? '';
  const { items } = await res.json();

  // Сжатая версия для системного промпта: полные описания и состав блюда
  // сюда не тащим (лишние токены) — появятся отдельным тулом на этапе
  // синхронизации голоса с экраном. Калории/вес/время готовки — нужны
  // ИИ для реальных запросов гостя ("уложи меня в 600 ккал") и для уже
  // прописанной в Restaurant Policy логики по времени готовки.
  const text = (items || [])
    .map((i) => {
      const extras = [];
      if (i.weight_g) extras.push(`${i.weight_g}`);
      if (i.nutritional_info?.calories != null) extras.push(`${i.nutritional_info.calories} ккал`);
      if (i.cook_time_min != null) extras.push(`~${i.cook_time_min} мин готовка`);
      const suffix = extras.length ? `, ${extras.join(', ')}` : '';
      return `${i.dish_name} — ${i.menu_section} — ${i.cost_rub}₽${suffix}`;
    })
    .join('\n');

  menuCache.set(restaurantId, { text, expiresAt: Date.now() + MENU_CACHE_TTL_MS });
  return text;
}

// character_profile/restaurant_policy/philosophy — структурированный профиль
// ресторана (restaurant_ai_profiles), редактируется напрямую в Supabase.
async function loadAiProfile(restaurantId) {
  if (!restaurantId) return null;
  const { data } = await getSupabase()
    .from('restaurant_ai_profiles')
    .select('character_profile, restaurant_policy, philosophy')
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  return data;
}

// Платформенные правила — общие для ВСЕХ ресторанов, поэтому здесь, в
// коде, а не в базе: единственный слой с правилами безопасности, не
// должен редактироваться в обход код-ревью.
const SYSTEM_PROMPT = `Ты — голосовой ассистент ресторана, говоришь по-русски. Ты разговариваешь
с гостем вживую по телефону/приложению — отвечай короткими, живыми
фразами, а не текстовыми абзацами.

Правила данных:
- Меню, которое дано ниже — единственный источник истины. Никогда не
  выдумывай блюда, ингредиенты или цены, которых там нет.
- У тебя есть статистика и предпочтения гостя (что заказывал раньше,
  средний чек и т.д.) — используй это ТОЛЬКО для мягкой персонализации
  (посоветовать похожее на то, что нравилось раньше). НИКОГДА не
  озвучивай гостю сырые цифры, даты, историю визитов, суммы чеков и
  сам факт, что у тебя есть эта статистика — гость не должен ощущать,
  что за ним следят.

Правила границ:
- Обсуждай только ресторан, меню, заказ и застольную беседу. На
  посторонние темы — вежливо возвращай разговор к ресторану.
- Не давай медицинских советов и категоричных заявлений об аллергенах —
  при вопросах про аллергию порекомендуй уточнить у официанта.
- Не обсуждай политику ресторана, ценообразование, конкурентов.

Первая реплика разговора (гость только что открыл приложение, ты
говоришь первым):
- Поздоровайся, представься своим именем.
- Коротко скажи, чем можешь помочь: выбрать блюда, посчитать калории,
  подобрать вино или напиток.
- Упомяни, что вместо разговора с тобой гость может открыть меню
  кнопкой «Открыть меню» и посмотреть блюда самостоятельно.
- Скажи, что вернуться к разговору с тобой можно в любой момент кнопкой «Чат».
- Это не сценарий слово в слово — говори в своём характере и манере речи
  (см. ниже).`;

export async function buildSessionContext({ guestId, restaurantId }) {
  const [{ preferences, restaurantHistory }, menu, aiProfile] = await Promise.all([
    loadGuestContext(guestId, restaurantId),
    loadMenuSummary(restaurantId),
    loadAiProfile(restaurantId),
  ]);

  const characterText = compileCharacterProfile(aiProfile?.character_profile);
  const policyText = compileRestaurantPolicy(aiProfile?.restaurant_policy);
  const philosophy = aiProfile?.philosophy || '';

  const dynamicContext = `Меню ресторана:\n${menu || '(меню недоступно)'}\n\n` +
    `Статистика и предпочтения гостя (JSON, только для персонализации — см. правила выше):\n` +
    JSON.stringify({ preferences, restaurantHistory });

  const instructions = [SYSTEM_PROMPT, characterText, policyText, philosophy, dynamicContext]
    .filter(Boolean)
    .join('\n\n---\n\n');

  const voice = aiProfile?.character_profile?.voice?.openai_voice || null;

  return { instructions, voice };
}
