import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { compileCharacterProfile, compileRestaurantPolicy } from './promptCompiler.js';

// Ленивая инициализация — как и с OPENAI_API_KEY в realtimeProvider.js,
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
  // сюда не тащим (лишние токены на десятки блюд, которые за разговор
  // почти никогда не спрашивают) — вместо этого ИИ достаёт их по запросу
  // через инструмент get_dish_details (см. lookupDishDetails ниже).
  // Калории/вес/время готовки остаются здесь — нужны сразу, для реальных
  // запросов гостя ("уложи меня в 600 ккал") и логики Restaurant Policy
  // по времени готовки.
  const text = (items || [])
    .map((i) => {
      const extras = [];
      if (i.weight_g) extras.push(`${i.weight_g}`);
      if (i.nutritional_info?.calories_kcal != null) extras.push(`${i.nutritional_info.calories_kcal} ккал`);
      if (i.cook_time_min != null) extras.push(`~${i.cook_time_min} мин готовка`);
      const suffix = extras.length ? `, ${extras.join(', ')}` : '';
      return `${i.dish_name} — ${i.menu_section} — ${i.cost_rub}₽${suffix}`;
    })
    .join('\n');

  menuCache.set(restaurantId, { text, expiresAt: Date.now() + MENU_CACHE_TTL_MS });
  return text;
}

// Общий поиск по требованию — используется и текстовым инструментом
// (get_dish_details), и показом карточки на экране (show_dish_card), а
// не при сборке контекста, поэтому не бьёт по токенам разговоров, где
// ни то ни другое вообще не просят. Ищем через ilike, а не точное
// совпадение — модель передаёт название так, как его произнёс гость
// («цезарь»), а не как оно записано в меню («Салат Цезарь с курицей»).
async function findMatchingDishes(restaurantId, dishName, selectFields) {
  if (!restaurantId || !dishName) return [];

  const { data, error } = await getSupabase()
    .from('menu_items')
    .select(selectFields)
    .eq('restaurant_id', restaurantId)
    .ilike('dish_name', `%${dishName}%`)
    .limit(5);

  return error || !data ? [] : data;
}

export async function lookupDishDetails(restaurantId, dishName) {
  const rows = await findMatchingDishes(
    restaurantId,
    dishName,
    'dish_name, description, ingredients, nutritional_info, weight_g, cost_rub, product_type, specific_details'
  );

  if (rows.length === 0) return { found: false };

  // Несколько совпадений («Цезарь с курицей» и «Цезарь с креветками») —
  // отдаём модели варианты, пусть переспросит гостя, а не гадает и не
  // озвучивает состав не того блюда (актуально в том числе для аллергий).
  if (rows.length > 1) {
    return { found: false, candidates: rows.map((d) => d.dish_name) };
  }

  const dish = rows[0];
  const ingredients = Array.isArray(dish.ingredients) ? dish.ingredients.join(', ') : dish.ingredients;

  return {
    found: true,
    dish_name: dish.dish_name,
    description: dish.description || null,
    ingredients: ingredients || null,
    weight: dish.nutritional_info?.weight_value || dish.weight_g || null,
    calories_kcal: dish.nutritional_info?.calories_kcal ?? null,
    protein_g: dish.nutritional_info?.protein_g ?? null,
    fat_g: dish.nutritional_info?.fat_g ?? null,
    carbs_g: dish.nutritional_info?.carbs_g ?? null,
    price_rub: dish.cost_rub,
    tasting_notes: dish.product_type === 'alcohol' ? (dish.specific_details || null) : undefined,
  };
}

// Для show_dish_card — та же логика поиска, но отдаёт сырую строку
// menu_items с полями, которые понимает DishModal (тот же компонент,
// что открывается тапом по блюду в меню), а не текстовое summary для речи.
const DISH_DISPLAY_FIELDS =
  'id, dish_name, cost_rub, image_url, image_url_thumbnail, description, ingredients, nutritional_info, weight_g, product_type, specific_details';

export async function findDishForDisplay(restaurantId, dishName) {
  const rows = await findMatchingDishes(restaurantId, dishName, DISH_DISPLAY_FIELDS);

  if (rows.length === 0) return { found: false };
  if (rows.length > 1) return { found: false, candidates: rows.map((d) => d.dish_name) };

  return { found: true, dish: rows[0] };
}

// Голосовой вызов официанта — то же самое действие, что кнопка с
// колокольчиком в MenuFooter (call_waiter RPC), плюс необязательная
// причина. В отличие от остальных функций этого файла — это не чтение
// контекста, а действие; лежит здесь, потому что использует тот же
// getSupabase() и тот же паттерн похода во внешний API, что и
// loadMenuSummary.
export async function callWaiter(restaurantId, tableNumber, reason) {
  if (!restaurantId || !tableNumber) {
    return { success: false, error: 'номер стола неизвестен' };
  }

  const { data: callId, error } = await getSupabase().rpc('call_waiter', {
    p_restaurant_id: restaurantId,
    p_table_number: String(tableNumber),
    p_reason: reason || null,
  });

  if (error) return { success: false, error: error.message };

  // Push — тот же дополнительный канал, что и у ручной кнопки в
  // MenuFooter (App.jsx), на случай свёрнутого приложения официанта.
  // Best-effort: живой Realtime-канал у официанта отработает и без него.
  if (config.waiterApiUrl) {
    fetch(`${config.waiterApiUrl.replace(/\/$/, '')}/api/send-waiter-call-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId }),
    }).catch(() => {});
  }

  return { success: true };
}

async function loadRestaurantName(restaurantId) {
  if (!restaurantId) return '';
  // Внимание: PK этой таблицы называется "restaurantId" (camelCase) — в
  // отличие от snake_case restaurant_id везде в остальной схеме.
  const { data } = await getSupabase()
    .from('restaurants')
    .select('name')
    .eq('restaurantId', restaurantId)
    .maybeSingle();
  return data?.name || '';
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
- В списке меню нет состава и описания блюд — если гость спрашивает,
  из чего сделано блюдо, есть ли в нём что-то конкретное, или просит
  подробное описание, вызови инструмент get_dish_details, а не
  придумывай и не отвечай "не знаю" сразу.
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

Вызов официанта:
- Если гость прямо просит позвать/пригласить официанта — используй
  инструмент call_waiter. Если гость назвал причину (убрать посуду,
  принести приборы и т.п.) — передай её. После вызова скажи, что
  официант уже в пути, не называя точное время.

Показ фото блюда на экране:
- Гость спрашивает, как выглядит блюдо — вызови show_dish_card.
- Ты сам рекомендуешь блюдо, в том числе отвечая на просьбу вроде
  "посоветуй что-нибудь" — не жди отдельного запроса на фото, сразу
  вызови show_dish_card для блюда, которое называешь. Гость должен
  видеть то, что ты предлагаешь, а не только слышать.
- Рекомендуешь несколько блюд подряд — показывай карточку для каждого
  по очереди, по одной за раз, пока о нём говоришь, не все сразу.
- Когда переходишь к другому блюду или тема уходит от еды — вызови
  hide_dish_card. Гость тоже может закрыть карточку сам в любой момент.

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
  const [{ preferences, restaurantHistory }, menu, aiProfile, restaurantName] = await Promise.all([
    loadGuestContext(guestId, restaurantId),
    loadMenuSummary(restaurantId),
    loadAiProfile(restaurantId),
    loadRestaurantName(restaurantId),
  ]);

  const restaurantLine = restaurantName ? `Ты работаешь в ресторане «${restaurantName}».` : '';
  const characterText = compileCharacterProfile(aiProfile?.character_profile);
  const policyText = compileRestaurantPolicy(aiProfile?.restaurant_policy);
  const philosophy = aiProfile?.philosophy || '';

  const dynamicContext = `Меню ресторана:\n${menu || '(меню недоступно)'}\n\n` +
    `Статистика и предпочтения гостя (JSON, только для персонализации — см. правила выше):\n` +
    JSON.stringify({ preferences, restaurantHistory });

  const instructions = [SYSTEM_PROMPT, restaurantLine, characterText, policyText, philosophy, dynamicContext]
    .filter(Boolean)
    .join('\n\n---\n\n');

  // Имена голосов не переносятся между провайдерами (alloy у OpenAI ничего
  // не значит для Grok и наоборот) — профиль ресторана может задать голос
  // под каждого провайдера отдельно, полем voice.<provider>_voice.
  const voiceField = config.voiceProvider === 'grok' ? 'grok_voice' : 'openai_voice';
  const voice = aiProfile?.character_profile?.voice?.[voiceField] || null;

  return { instructions, voice };
}
