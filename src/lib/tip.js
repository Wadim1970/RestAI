// Чаевые в окне оплаты — ЧИСТАЯ логика (без сети и React).
// Тесты: node --test src/lib/tip.test.js
//
// Наборы значений ДОЛЖНЫ совпадать с проверкой в базе (record_table_tip,
// миграция 20261101010000_table_tips.sql): сервер не принимает других.

export const TIP_FIXED = [100, 200, 300, 500, 1000] // рубли
export const TIP_PERCENT = [3, 5, 10, 15] // % от чека выбранных мест

// tip: { kind: 'fixed' | 'percent', value } или null — без чаевых.
export function isValidTip(tip) {
  if (!tip) return false
  if (tip.kind === 'fixed') return TIP_FIXED.includes(tip.value)
  if (tip.kind === 'percent') return TIP_PERCENT.includes(tip.value)
  return false
}

// Сумма чаевых в целых рублях. Проценты — от суммы чека (base), округление
// до рубля. Нет выбора, чек пустой или значение не из набора — 0.
export function tipAmount(tip, base) {
  if (!isValidTip(tip)) return 0
  if (tip.kind === 'fixed') return tip.value
  const b = Number(base)
  if (!Number.isFinite(b) || b <= 0) return 0
  return Math.round((b * tip.value) / 100)
}

export const sameTip = (a, b) => !!a && !!b && a.kind === b.kind && a.value === b.value

// Подпись кнопки: «200 ₽» / «10%» (с суммой, если чек известен).
export function tipLabel(tip, base) {
  if (!isValidTip(tip)) return ''
  if (tip.kind === 'fixed') return `${tip.value} ₽`
  const sum = tipAmount(tip, base)
  return sum > 0 ? `${tip.value}% · ${sum} ₽` : `${tip.value}%`
}
