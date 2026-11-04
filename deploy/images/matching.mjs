// Сопоставление файла с блюдом меню по названию — общее для загрузки фото и видео.
// «Джин  Bombay Sapphire!.mp4» и «джин bombay sapphire» — одно и то же.
const FILE_EXT = /\.(png|jpe?g|webp|avif|gif|tiff?|mp4|mov|m4v|webm)$/i

export const normName = (s) => String(s || '')
  .toLowerCase().replace(/ё/g, 'е')
  .replace(FILE_EXT, '')
  .replace(/[«»"'`’.,!?()_\-–—/\\]+/g, ' ')
  .replace(/\s+/g, ' ').trim()

const words = (s) => new Set(normName(s).split(' ').filter((w) => w.length > 1))

export function similarity(a, b) {
  const A = words(a), B = words(b)
  if (!A.size || !B.size) return 0
  let common = 0
  for (const w of A) if (B.has(w)) common++
  return common / Math.max(A.size, B.size)
}

// Файл → записи меню. Сначала точное совпадение названия, затем — если
// единственный кандидат — почти точное (все слова файла есть в названии).
// Блюдо в нескольких разделах («Пепперони» в «Популярном» и в «Пицце») — все копии.
export function matchFile(fileName, menu) {
  const n = normName(fileName)
  const exact = menu.filter((m) => normName(m.dish_name) === n)
  if (exact.length) return { items: exact }
  const scored = menu
    .map((m) => ({ m, s: similarity(fileName, m.dish_name) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
  const names = [...new Set(scored.map((x) => x.m.dish_name))]
  const best = scored[0]
  if (best && best.s >= 0.75 && names.filter((nm) => similarity(fileName, nm) === best.s).length === 1) {
    return { items: menu.filter((m) => m.dish_name === best.m.dish_name), fuzzy: true }
  }
  return { items: [], suggestions: names.slice(0, 3) }
}
