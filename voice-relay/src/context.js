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
  // Дедуп по названию+цене: одно блюдо часто заведено несколькими
  // строками ради попадания в разные разделы меню (напр. «Борщ» и в
  // «Популярное», и в «Супы») — в промте это дубль, из-за которого ИИ
  // думает, что таких блюд несколько. Оставляем первое вхождение.
  const seen = new Set();
  const text = (items || [])
    .filter((i) => {
      const key = `${i.dish_name}|${i.cost_rub}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
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

// Не больше этого числа карточек в слайдере за раз — чтобы вызов на 3-4
// блюда, каждое из которых даёт по несколько совпадений, не завалил
// экран. С запасом под обычный сценарий «посоветуй пару десертов».
const MAX_DISPLAY_DISHES = 6;

// Показ карточек — в ОТЛИЧИЕ от get_dish_details (где неоднозначность
// опасна: можно назвать состав не того блюда, важно для аллергий) — тут
// неоднозначность НЕ проблема: слайдер для того и нужен, чтобы показать
// несколько блюд. Гость сказал «борщ», а их три в меню — показываем все
// три, пусть смотрит. Возвращаем сразу массив по нескольким названиям.
export async function findDishesForDisplay(restaurantId, dishNames) {
  const names = Array.isArray(dishNames) ? dishNames : [dishNames];
  const dishes = [];
  const seen = new Set();

  for (const name of names) {
    const rows = await findMatchingDishes(restaurantId, name, DISH_DISPLAY_FIELDS);
    for (const row of rows) {
      // Дедуп по названию+цене, а не по id: одно и то же блюдо часто
      // заведено несколькими строками (разные id), чтобы попадать сразу
      // в несколько разделов меню (напр. «Борщ» и в «Популярное», и в
      // «Супы»). Для карточки это одно блюдо — не показываем дважды.
      const key = `${row.dish_name}|${row.cost_rub}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dishes.push(row);
      if (dishes.length >= MAX_DISPLAY_DISHES) return dishes;
    }
  }

  return dishes;
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

// Общая история диалога (conversation_turns) — единая для голоса и
// текста, ключ session_id. Читаем ОДИН РАЗ при старте голосовой сессии
// (дальше Grok держит контекст сам), а не на каждую реплику. limit —
// защита от разрастания промпта на очень длинном визите; берём последние.
export async function loadConversationHistory(sessionId, limit = 40) {
  if (!sessionId) return [];
  const { data, error } = await getSupabase()
    .from('conversation_turns')
    .select('role, content, source, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.reverse(); // вернули по убыванию ради limit-«последние», отдаём в хронологическом порядке
}

// Запись одной реплики в общую историю. Best-effort: сбой записи не
// должен ронять разговор, поэтому ошибка только логируется вызывающим.
export async function saveConversationTurn({ sessionId, restaurantId, guestId, role, content, source }) {
  if (!sessionId || !content) return;
  await getSupabase().from('conversation_turns').insert({
    session_id: sessionId,
    restaurant_id: restaurantId || null,
    guest_id: guestId || null,
    role,
    content,
    source,
  });
}

function formatHistoryForPrompt(turns) {
  if (!turns || turns.length === 0) return '';
  const lines = turns
    .map((t) => `${t.role === 'user' ? 'Гость' : 'Ты'}: ${t.content}`)
    .join('\n');
  return (
    'Предыдущие реплики этого же разговора (гость мог общаться и текстом, ' +
    'и голосом — это один непрерывный диалог):\n' +
    lines +
    '\n\nЭто ПРОДОЛЖЕНИЕ уже начатого разговора: НЕ здоровайся заново и не ' +
    'представляйся снова, просто продолжай с учётом сказанного выше.'
  );
}

// Читаем ресторан целиком (select *): нужны и name, и локация
// (latitude/longitude/city/address) для погоды. select('*') не падает, если
// какой-то из этих колонок нет — вернёт то, что есть (в отличие от явного
// перечисления колонок, где отсутствующая колонка = ошибка запроса).
async function loadRestaurant(restaurantId) {
  if (!restaurantId) return {};
  // Внимание: PK этой таблицы называется "restaurantId" (camelCase) — в
  // отличие от snake_case restaurant_id везде в остальной схеме.
  const { data } = await getSupabase()
    .from('restaurants')
    .select('*')
    .eq('restaurantId', restaurantId)
    .maybeSingle();
  return data || {};
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

// ── Погода: температура в городе ресторана (Open-Meteo, бесплатно, без ключа).
// Локацию берём из строки ресторана: сперва точные координаты
// (latitude/longitude), иначе геокодим город, иначе — куски адреса. Кэшируем:
// город не переезжает, а температура достаточно свежая раз в 30 минут.
const WEATHER_CACHE_TTL_MS = 30 * 60_000;
const weatherCache = new Map(); // ключ ресторана -> { temp, expiresAt }
const geoCache = new Map();     // строка запроса -> { lat, lon }

async function fetchJson(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null; // сеть/таймаут — просто без погоды, приветствие не должно падать
  } finally {
    clearTimeout(timer);
  }
}

function coordsFromRow(r) {
  const lat = Number(r.latitude);
  const lon = Number(r.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) return { lat, lon };
  return null;
}

// Кандидаты в «город» для геокодинга: сам город, затем куски адреса, из
// которых убраны «г.», номера домов, «ул./просп./д.» и т.п.
function cityCandidates(r) {
  const out = [];
  if (r.city) out.push(String(r.city).trim());
  if (r.address) {
    for (let seg of String(r.address).split(',')) {
      seg = seg.replace(/^\s*(г\.?|город|пгт|с\.?|село|пос\.?)\s*/i, '').trim();
      if (seg && !/\d/.test(seg) && !/(ул|улица|просп|проспект|пер|переул|д\.|дом|кв|корп|стр|бул|наб|ш\.|шоссе)/i.test(seg)) {
        out.push(seg);
      }
    }
  }
  return [...new Set(out.filter(Boolean))];
}

async function geocode(name) {
  if (!name) return null;
  if (geoCache.has(name)) return geoCache.get(name);
  const data = await fetchJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=ru&format=json`
  );
  const hit = data?.results?.[0];
  const coords = hit ? { lat: hit.latitude, lon: hit.longitude } : null;
  if (coords) geoCache.set(name, coords);
  return coords;
}

async function fetchTemperature(restaurant) {
  if (!restaurant) return null;
  const key = restaurant.restaurantId ||
    `${restaurant.city}|${restaurant.address}|${restaurant.latitude}|${restaurant.longitude}`;
  const cached = weatherCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.temp;

  let coords = coordsFromRow(restaurant);
  if (!coords) {
    for (const cand of cityCandidates(restaurant)) {
      coords = await geocode(cand);
      if (coords) break;
    }
  }
  if (!coords) return null;

  const data = await fetchJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m`
  );
  const temp = data?.current?.temperature_2m;
  if (typeof temp !== 'number') return null;
  weatherCache.set(key, { temp, expiresAt: Date.now() + WEATHER_CACHE_TTL_MS });
  return temp;
}

// Пороговые фразы по температуре — БУКВАЛЬНО как задал ресторан: ниже 10° —
// мягко, 10–15° — эмоционально; по жаре: выше 30° — эмоционально, 28–30° —
// мягко. В комфортные 15–28° — без погодной фразы.
function weatherSuggestion(temp) {
  if (typeof temp !== 'number') return '';
  if (temp < 10) return 'сегодня довольно холодно, может сразу предложить вам что-то горячее, чтобы согреться?';
  if (temp < 15) return 'ну и холодина сегодня, давайте я вам сейчас закажу горячий чай или кофе, чтобы вы могли согреться, пока будем выбирать блюда.';
  if (temp > 30) return 'на улице пекло. Давайте я сразу предложу вам что-то из холодных напитков — а то, так можно и испечься.';
  if (temp > 28) return 'сегодня жарко на улице, может сразу заказать вам прохладительные напитки, чтобы вы могли чувствовать себя комфортно?';
  return '';
}

// Блок в промпт про погоду. ВАЖНО: заговариваем о погоде ТОЛЬКО при
// аномальной температуре (ниже 15° или выше 28°) и ТОЛЬКО в начале нового
// разговора. В комфортные 15–28°, а также при продолжении разговора (есть
// история) — про погоду молчим ПОЛНОСТЬЮ: не называем градусы, не упоминаем
// её вовсе. Раньше блок при каждом входе сообщал точную температуру и просил
// её «учитывать» — из-за этого ИИ проговаривал погоду каждый раз, хотя
// задумка была реагировать только на аномалии.
function buildWeatherBlock(temp, hasHistory) {
  if (typeof temp !== 'number') return '';
  if (hasHistory) return '';                 // продолжение разговора — тему не поднимаем
  const suggestion = weatherSuggestion(temp);
  if (!suggestion) return '';                // комфортная погода — молчим совсем
  return `ПОГОДА (аномальная температура). Сразу после приветствия, первой же репликой, по-человечески вверни это наблюдение и предложение (можно слегка своими словами, сохрани смысл и тёплую интонацию). НЕ называй точную цифру градусов — просто «сегодня холодно/жарко» и т.п.: «${suggestion}»`;
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

Показ фото блюд на экране (show_dish_card) — ОБЯЗАТЕЛЬНОЕ правило:
- Как только собираешься назвать гостю конкретные блюда — рекомендуешь,
  перечисляешь варианты, отвечаешь на "что посоветуешь", "что у вас есть",
  "покажи десерты", гость сменил категорию — СНАЧАЛА вызови show_dish_card
  со списком ВСЕХ этих блюд, и только ПОТОМ говори про них вслух. Порядок
  важен: карточки должны появиться на экране ДО твоей речи о блюдах, а не
  после неё. НЕ жди, пока гость попросит "покажи картинки" или скажет "не
  вижу" — если ты назвал блюда, а карточек на экране нет, это ошибка.
- ЦЕНУ голосом НЕ проговаривай. Перечисляя и советуя блюда, называй только
  их названия (можно кратко описать вкус/состав), но НЕ озвучивай стоимость —
  цена и так видна гостю на карточке блюда на экране. Исключение: гость сам
  прямо спросил, сколько стоит конкретное блюдо — тогда назови цену.
- Передавай сразу все блюда одним вызовом, списком: show_dish_card с
  dish_names = ["Тирамису", "Панна-котта"]. Не по одному и НЕ дважды подряд
  с тем же списком.
- Каждый новый вызов show_dish_card ПОЛНОСТЬЮ заменяет то, что было на
  экране. Поэтому при смене темы просто вызови его заново с новыми
  блюдами — старые уйдут сами, hide_dish_card для этого звать НЕ нужно.
- hide_dish_card нужен только когда разговор совсем уходит от еды и
  карточки больше не к месту.
- Единственное, когда show_dish_card не нужен — если ты не называешь
  конкретных блюд ("у нас богатое меню", "сейчас подберём").

Корзина и оформление заказа:
- Когда гость решает что-то заказать («давай», «беру», «добавь») —
  сразу клади блюдо в корзину инструментом add_to_cart (название +
  количество). Реально клади, а не только на словах — иначе корзина
  останется пустой.
- Особые пожелания к блюду («без лука», «уберите кинзу», «поострее», «соус
  отдельно», «без льда») — записывай их в поле comment при вызове
  add_to_cart, кратко и своими словами. Пожелания выясняй ДО добавления и
  клади блюдо сразу с комментарием, а не отдельным вызовом. Подтверди
  гостю, что учёл пожелание.
- Ты помогаешь ВЫБРАТЬ, но сам заказ на кухню НЕ отправляешь. Когда
  гость закончил выбор — как настоящий официант, вслух подытожь весь
  заказ (перечисли блюда и количество, уточни, всё ли верно, ничего не
  забыли), затем вызови show_cart и скажи: если всё верно — можно сразу
  отправить заказ на кухню кнопкой «Отправить заказ» в корзине.
- Отправляет заказ сам гость этой кнопкой. Не говори, что заказ уже
  отправлен или принят — ты его на кухню не отправляешь.
- ПОКАЗАТЬ КОРЗИНУ по просьбе: как только гость просит показать корзину или
  свой заказ — в ЛЮБОЙ формулировке («покажи корзину», «моя корзина», «что я
  заказал», «покажи заказ»), в том числе если распознавание исказило слово
  («карзину», «кардину», «корзинку», «корзина покажи») — СРАЗУ вызови
  show_cart. Не переспрашивай по нескольку раз и не заставляй повторять.
- УБРАТЬ КОРЗИНУ с экрана: как только гость просит убрать / закрыть /
  свернуть / спрятать корзину («убери корзину», «закрой корзину», «убери
  карзину», «спрячь заказ», «корзину убери») — СРАЗУ вызови hide_cart. Это
  ОТДЕЛЬНЫЙ инструмент: hide_dish_card убирает карточки блюд, а корзину — нет.
- Держись темы еды, меню и заказа. НИКОГДА не рассказывай про постороннее
  (города, достопримечательности, факты не о меню и т.п.). Если не расслышал
  или не понял просьбу — коротко переспроси («Показать корзину?», «Какое
  блюдо?»), но НЕ выдумывай ответ на тему, которой не было.
- Когда переходишь к другому блюду или тема уходит от еды — вызови
  hide_dish_card. Гость тоже может закрыть карточку сам в любой момент.

Первая реплика разговора (гость только что открыл приложение, ты
говоришь первым) — произнеси ДОСЛОВНО эту фразу, подставив только своё имя
и название ресторана:
«Привет! Я <имя>, ваш персональный ассистент по ресторану <название>, готов
рассказать о меню и принять заказ. С чего начнём?»
- <имя> — твоё имя из профиля; <название> — название этого ресторана (дано
  выше в контексте). Больше в этой фразе ничего не меняй, не добавляй и не
  убирай (в том числе не вставляй в неё итальянские слова и фирменные фразы).
- Ты — ПЕРСОНАЛЬНЫЙ АССИСТЕНТ ресторана. Никогда не называй себя шеф-поваром
  или поваром — даже если в профиле роль указана иначе.
- Если ниже есть погодная подсказка — добавь её отдельной фразой сразу
  после приветствия.`;

export async function buildSessionContext({ guestId, restaurantId, sessionId }) {
  // Ресторан грузим первым — из него нужна локация для погоды, чтобы запрос
  // температуры пошёл параллельно с остальными загрузками.
  const restaurant = await loadRestaurant(restaurantId);

  const [{ preferences, restaurantHistory }, menu, aiProfile, history, temperature] = await Promise.all([
    loadGuestContext(guestId, restaurantId),
    loadMenuSummary(restaurantId),
    loadAiProfile(restaurantId),
    loadConversationHistory(sessionId),
    fetchTemperature(restaurant),
  ]);

  const restaurantName = restaurant.name || '';
  const restaurantLine = restaurantName ? `Ты работаешь в ресторане «${restaurantName}».` : '';
  const characterText = compileCharacterProfile(aiProfile?.character_profile);
  const policyText = compileRestaurantPolicy(aiProfile?.restaurant_policy);
  const philosophy = aiProfile?.philosophy || '';
  const historyText = formatHistoryForPrompt(history);
  const hasHistory = history.length > 0;
  const weatherText = buildWeatherBlock(temperature, hasHistory);

  const dynamicContext = `Меню ресторана:\n${menu || '(меню недоступно)'}\n\n` +
    `Статистика и предпочтения гостя (JSON, только для персонализации — см. правила выше):\n` +
    JSON.stringify({ preferences, restaurantHistory });

  const instructions = [SYSTEM_PROMPT, restaurantLine, characterText, policyText, philosophy, weatherText, dynamicContext, historyText]
    .filter(Boolean)
    .join('\n\n---\n\n');

  // hasHistory (вычислен выше) voiceSession использует, чтобы решить:
  // здороваться первым (пустой визит) или молча ждать реплику гостя
  // (разговор уже шёл в другом режиме).

  // Имена голосов не переносятся между провайдерами (alloy у OpenAI ничего
  // не значит для Grok и наоборот) — профиль ресторана может задать голос
  // под каждого провайдера отдельно, полем voice.<provider>_voice.
  const voiceField = config.voiceProvider === 'grok' ? 'grok_voice' : 'openai_voice';
  const voice = aiProfile?.character_profile?.voice?.[voiceField] || null;

  return { instructions, voice, hasHistory };
}
