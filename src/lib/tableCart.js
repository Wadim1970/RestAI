// Корзина гостя = строки общего заказа стола (status 'new') на его месте.
// Сервер — единственный источник правды; здесь чистая логика сверки
// локальной корзины {id блюда: количество} с тем, что отдаёт get_my_table_state.
//
// Локальная корзина нужна для мгновенного отклика интерфейса. Блюда, которые
// гость только что менял (dirty), уходят на сервер через cart_set; остальные
// подтягиваются с сервера — так правки официанта видны гостю.

const sameMods = (a, b) => {
  const x = [...a].sort()
  const y = [...b].sort()
  return x.length === y.length && x.every((v, i) => v === y[i])
}

const modIds = (mods) => (Array.isArray(mods) ? mods.map((m) => (typeof m === 'string' ? m : m?.id)).filter(Boolean) : [])

const normComment = (c) => {
  const t = String(c ?? '').trim()
  return t === '' ? null : t
}

// Строки-корзина моего места.
export const cartLines = (lines) => (lines || []).filter((l) => l.status === 'new')

// Уже отправленное на кухню (sent / ready / pending).
export const orderedLines = (lines) => (lines || []).filter((l) => l.status !== 'new')

// {id блюда: суммарное количество} по строкам корзины.
export function cartTotals(lines) {
  const out = {}
  for (const l of cartLines(lines)) out[l.item_id] = (out[l.item_id] || 0) + Number(l.quantity || 0)
  return out
}

// Что показывать в «Уже готовится»: форма та же, что у позиций корзины
// (id, dish_name, image_url, count, cost_rub, modifiers, comment).
export function toConfirmedItems(lines) {
  return orderedLines(lines).map((l) => ({
    id: l.item_id,
    lineId: l.id,
    dish_name: l.dish_name,
    image_url: l.image_url_thumbnail || l.image_url || null,
    product_type: l.product_type || null,
    cost_rub: Number(l.unit_price ?? l.cost_rub ?? 0),
    count: Number(l.quantity || 0),
    comment: l.comment || undefined,
    modifiers: Array.isArray(l.modifiers) ? l.modifiers : [],
    status: l.status,
  }))
}

// Карточки блюд из строк корзины для словаря voiceDishesById (CartModal
// показывает только блюда из него): добавляем те, которых ещё нет.
export function dishCardsFromLines(lines, known = {}) {
  const out = {}
  for (const l of cartLines(lines)) {
    if (known[l.item_id] || out[l.item_id]) continue
    out[l.item_id] = {
      id: l.item_id,
      dish_name: l.dish_name,
      image_url: l.image_url_thumbnail || l.image_url || null,
      product_type: l.product_type || null,
      cost_rub: Number(l.cost_rub ?? l.unit_price ?? 0),
      modifiers: Array.isArray(l.modifiers) ? l.modifiers : [],
      comment: l.comment || undefined,
    }
  }
  return out
}

// Какие вызовы cart_set нужны, чтобы по каждому изменённому блюду серверная
// сумма стала равна локальной. Количество задаётся абсолютно, повтор безопасен.
// dishes — словарь данных блюд (comment, modifiers гость получает от голосового
// помощника); без них строка — «блюдо без комментария и опций».
export function planPush(cart, dirty, lines, dishes = {}) {
  const ops = []
  const serverLines = cartLines(lines)
  for (const itemId of dirty) {
    const want = Math.max(0, Number(cart[itemId] || 0))
    const mine = serverLines.filter((l) => l.item_id === itemId)
    const serverTotal = mine.reduce((s, l) => s + Number(l.quantity || 0), 0)
    if (want === serverTotal) continue

    const d = dishes[itemId] || {}
    const keyComment = normComment(d.comment)
    const keyMods = modIds(d.modifiers)
    const key = mine.find((l) => normComment(l.comment) === keyComment && sameMods(modIds(l.modifiers), keyMods))
    const others = mine.filter((l) => l !== key)

    if (want > serverTotal) {
      ops.push({
        itemId, quantity: Number(key?.quantity || 0) + (want - serverTotal),
        comment: keyComment, modifiers: keyMods,
      })
    } else {
      // Уменьшаем: сначала строку блюда гостя, затем остальные.
      let dec = serverTotal - want
      for (const l of [key, ...others].filter(Boolean)) {
        if (dec <= 0) break
        const take = Math.min(dec, Number(l.quantity || 0))
        ops.push({
          itemId, quantity: Number(l.quantity || 0) - take,
          comment: normComment(l.comment), modifiers: modIds(l.modifiers),
        })
        dec -= take
      }
    }
  }
  return ops
}

// Новая локальная корзина: блюда, которые гость не менял (не dirty), берутся
// с сервера (правки официанта); изменённые гостем остаются как есть.
export function adoptServerCart(cart, dirty, lines) {
  const totals = cartTotals(lines)
  const next = {}
  for (const [id, n] of Object.entries(cart)) if (dirty.has(id) && n > 0) next[id] = n
  for (const [id, n] of Object.entries(totals)) if (!dirty.has(id) && n > 0) next[id] = n
  return next
}

export const sameCart = (a, b) => {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => a[k] === b[k])
}
