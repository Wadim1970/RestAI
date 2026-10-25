// Совет к корзине и десерт «чуть позже» — запросы к серверу официанта
// (Waiter-app: api/guest/cart-advice, api/guest/dessert) и память визита.
//
// Сервер сам решает, чего не хватает к этому приёму пищи (завтрак, обед,
// ужин), и отвечает за доли секунды — нейросеть тут не зовётся. Здесь —
// только «что гость уже отклонил» (на визит, sessionStorage), чтобы не
// предлагать то же самое снова.

import { getOrCreateDeviceId } from './deviceId';

const API = (import.meta.env.VITE_PAIRINGS_API_URL || 'https://waiter.restai.pro').replace(/\/$/, '');
const key = (restaurantId) => `restai_cart_advice_${restaurantId}`;

export function loadAdviceMemory(restaurantId) {
  try {
    const m = JSON.parse(sessionStorage.getItem(key(restaurantId)) || '{}');
    return { dishes: m.dishes || [], gaps: m.gaps || [], dessertAnswer: m.dessertAnswer || null };
  } catch {
    return { dishes: [], gaps: [], dessertAnswer: null };
  }
}

export function saveAdviceMemory(restaurantId, memory) {
  try { sessionStorage.setItem(key(restaurantId), JSON.stringify(memory)); } catch { /* приватный режим — без памяти */ }
}

async function post(path, body, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// cart / ordered: [{id, quantity}]; declinedPairs — отказы от «Шеф советует».
export function fetchCartAdvice({ restaurantId, cart, ordered, memory, declinedPairs = [] }) {
  return post('/api/guest/cart-advice', {
    restaurantId,
    deviceId: getOrCreateDeviceId(),
    cart,
    ordered,
    dismissed: {
      dishes: [...memory.dishes, ...declinedPairs.map((k) => String(k).split('>')[1]).filter(Boolean)],
      gaps: memory.gaps,
    },
  });
}

export function sendAdviceEvent(restaurantId, advice, outcome) {
  post('/api/guest/cart-advice', {
    restaurantId,
    deviceId: getOrCreateDeviceId(),
    event: { dishId: advice?.dish?.id, anchorId: advice?.anchorId, gap: advice?.gap, source: advice?.source, outcome },
  });
}

export function answerDessert({ restaurantId, tableNumber, seat, meal, yes }) {
  return post('/api/guest/dessert', {
    restaurantId,
    deviceId: getOrCreateDeviceId(),
    tableNumber,
    seat,
    meal,
    answer: yes ? 'yes' : 'no',
  });
}

export async function checkDessert(restaurantId) {
  try {
    const q = new URLSearchParams({ restaurantId, deviceId: getOrCreateDeviceId() });
    const res = await fetch(`${API}/api/guest/dessert?${q}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
