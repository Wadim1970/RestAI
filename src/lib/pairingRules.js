// Когда показывать гостю подсказку «к этому блюду отлично подходит…».
// Чистые функции (без React и сети) — проверяются node --test.
//
// Правила (из обсуждения с рестораном):
//   • подсказка только при ПЕРВОМ добавлении блюда (0 → 1), не на «ещё одну»;
//   • не больше 3 за визит и не чаще раза в минуту;
//   • «Нет, спасибо» запоминается: эту пару больше не предлагаем, а после
//     двух отказов подряд подсказки выключаются до конца визита;
//   • не предлагаем то, что уже в заказе, и то, чего нет в меню;
//   • если сервер подобрал пары под гостя (аллергии, вкусы) — берём их,
//     даже пустой список: значит, общие пары гостю не подходят.

export const MAX_PER_VISIT = 3;
export const COOLDOWN_MS = 60 * 1000;
export const DECLINES_TO_STOP = 2;

export function emptyMemory() {
  return { shown: 0, lastAt: 0, declineStreak: 0, declined: [] };
}

const pairKey = (anchorId, pairId) => `${anchorId}>${pairId}`;

// → { anchorId, dishId, lead, why, personal } или null.
export function pickPairing({ dishId, prevCount, cart, menuById, generic, personal, memory, now }) {
  if (prevCount > 0) return null;
  const m = memory || emptyMemory();
  if (m.declineStreak >= DECLINES_TO_STOP) return null;
  if (m.shown >= MAX_PER_VISIT) return null;
  if (m.lastAt && now - m.lastAt < COOLDOWN_MS) return null;

  const list = personal ? (personal[dishId] || []) : ((generic && generic[dishId]) || []);
  for (const p of list) {
    if (!p || !p.dishId || p.dishId === dishId) continue;
    if (!menuById.has(p.dishId)) continue;
    if ((cart[p.dishId] || 0) > 0) continue;
    if (m.declined.includes(pairKey(dishId, p.dishId))) continue;
    return { anchorId: dishId, dishId: p.dishId, lead: p.lead, why: p.why, personal: !!p.personal };
  }
  return null;
}

export function rememberShown(memory, now) {
  const m = memory || emptyMemory();
  return { ...m, shown: m.shown + 1, lastAt: now };
}

export function rememberAnswer(memory, offer, accepted) {
  const m = memory || emptyMemory();
  if (accepted) return { ...m, declineStreak: 0 };
  return {
    ...m,
    declineStreak: m.declineStreak + 1,
    declined: [...m.declined, pairKey(offer.anchorId, offer.dishId)].slice(-50),
  };
}

// Память — на визит (вкладку): sessionStorage. Нет доступа — живём без неё.
export function loadMemory(restaurantId) {
  try {
    const raw = sessionStorage.getItem(`restai_pairing_${restaurantId}`);
    return raw ? { ...emptyMemory(), ...JSON.parse(raw) } : emptyMemory();
  } catch {
    return emptyMemory();
  }
}

export function saveMemory(restaurantId, memory) {
  try { sessionStorage.setItem(`restai_pairing_${restaurantId}`, JSON.stringify(memory)); } catch { /* приватный режим */ }
}
