// Когда показывать гостю подсказку «к этому блюду отлично подходит…».
// Чистые функции (без React и сети) — проверяются node --test.
//
// Правила (из обсуждения с рестораном):
//   • подсказка только при ПЕРВОМ добавлении блюда (0 → 1), не на «ещё одну»;
//   • не больше 3 за визит и не раньше чем через 5 секунд после прошлой
//     подсказки (чтобы две шторки не выезжали одна за другой);
//   • «Нет, спасибо» запоминается: эту пару больше не предлагаем, а после
//     двух отказов подряд подсказки выключаются до конца визита;
//   • не предлагаем то, что уже в заказе, и то, чего нет в меню;
//   • если сервер подобрал пары под гостя (аллергии, вкусы) — берём их,
//     даже пустой список: значит, общие пары гостю не подходят.

export const MAX_PER_VISIT = 3;
export const COOLDOWN_MS = 5 * 1000;
export const DECLINES_TO_STOP = 2;

export function emptyMemory() {
  return { shown: 0, lastAt: 0, declineStreak: 0, declined: [] };
}

const pairKey = (anchorId, pairId) => `${anchorId}>${pairId}`;

// Одно и то же блюдо бывает в меню несколькими записями: «Пепперони» и в
// «Популярном», и в «Пицце». Пара составлена к одной из записей — отдаём её
// и остальным записям с тем же названием.
export function expandPairingsByName(pairings, items) {
  if (!pairings) return pairings;
  const idsByName = new Map();
  for (const it of items) {
    const key = String(it.dish_name || '').trim().toLowerCase();
    if (!key) continue;
    if (!idsByName.has(key)) idsByName.set(key, []);
    idsByName.get(key).push(it.id);
  }
  const out = { ...pairings };
  for (const ids of idsByName.values()) {
    if (ids.length < 2) continue;
    const source = ids.find((id) => (pairings[id] || []).length);
    if (!source) continue;
    for (const id of ids) {
      // sourceAnchorId — под каким блюдом пара лежит в базе: с ним пишем журнал.
      if (!(id in pairings)) out[id] = pairings[source].map((p) => ({ ...p, sourceAnchorId: source }));
    }
  }
  return out;
}

// → { anchorId, dishId, lead, why, personal } или null.
// ignoreLimits — режим проверки (ссылка с &pairs=test): без лимитов показа.
export function pickPairing({ dishId, prevCount, cart, menuById, generic, personal, memory, now, ignoreLimits = false }) {
  if (prevCount > 0) return null;
  const m = memory || emptyMemory();
  if (!ignoreLimits) {
    if (m.declineStreak >= DECLINES_TO_STOP) return null;
    if (m.shown >= MAX_PER_VISIT) return null;
    if (m.lastAt && now - m.lastAt < COOLDOWN_MS) return null;
  }

  const list = personal ? (personal[dishId] || []) : ((generic && generic[dishId]) || []);
  for (const p of list) {
    if (!p || !p.dishId || p.dishId === dishId) continue;
    if (!menuById.has(p.dishId)) continue;
    if ((cart[p.dishId] || 0) > 0) continue;
    if (!ignoreLimits && m.declined.includes(pairKey(dishId, p.dishId))) continue;
    return { anchorId: dishId, logAnchorId: p.sourceAnchorId || dishId, dishId: p.dishId, lead: p.lead, why: p.why, personal: !!p.personal };
  }
  return null;
}

export function rememberShown(memory, now) {
  const m = memory || emptyMemory();
  return { ...m, shown: m.shown + 1, lastAt: now };
}

// Пауза отсчитывается и от ответа гостя: шторка могла висеть дольше 5 секунд.
export function rememberAnswer(memory, offer, accepted, now = Date.now()) {
  const m = { ...(memory || emptyMemory()), lastAt: now };
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
