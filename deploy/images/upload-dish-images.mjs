// Фото блюд → своё хранилище Supabase → ссылки в меню.
//
//   node upload-dish-images.mjs --dir /opt/restai/uploads/alco [--section "Алкогольные напитки"] [--go]
//
// Без --go — только показывает, какой файл к какому блюду подойдёт, ничего
// не загружая. Файлы называются как блюдо в меню: «Джин Bombay Sapphire.png».
// Для каждого файла:
//   • обрезает пустые поля по краям, вписывает целиком в квадрат с прозрачным
//     фоном: 800×800 (карточка блюда) и 300×300 (меню, подсказки, голосовой);
//   • загружает в bucket menu-images: <ресторан>/dishes/<id блюда>_<хэш>.webp
//     и …_thumb.webp — имя по id блюда (без кириллицы, не ломается при
//     переименовании), хэш меняется вместе с картинкой (гости не застрянут
//     на старой из кэша);
//   • прописывает image_url и image_url_thumbnail всем записям блюда с этим
//     названием (Пепперони в «Популярном» и в «Пицце» — одна картинка).
//
// Адрес Supabase и сервисный ключ берёт из /opt/restai/Waiter-app/.env.production
// (SUPABASE_URL, SUPABASE_SERVICE_KEY). Подробнее — README.md рядом.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'

const BUCKET = 'menu-images'
const DEFAULT_RESTAURANT = 'dd89773c-0952-4fd1-9510-514094a928ee'
const IMAGE_EXT = /\.(png|jpe?g|webp|avif|gif|tiff?)$/i
const SIZES = [
  { suffix: '', size: 800, field: 'image_url' },
  { suffix: '_thumb', size: 300, field: 'image_url_thumbnail' },
]

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : def
}
const has = (name) => process.argv.includes(`--${name}`)

function loadEnv(file) {
  const env = {}
  if (!fs.existsSync(file)) return env
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return env
}

const dir = arg('dir')
const restaurantId = arg('restaurant', DEFAULT_RESTAURANT)
const section = arg('section')
const go = has('go')
const envFile = arg('env', '/opt/restai/Waiter-app/.env.production')
const env = { ...loadEnv(envFile), ...process.env }
const SUPABASE_URL = String(env.SUPABASE_URL || '').replace(/\/$/, '')
const KEY = env.SUPABASE_SERVICE_KEY

if (!dir || !fs.existsSync(dir)) {
  console.error('Укажите папку с фото: --dir /opt/restai/uploads/alco')
  process.exit(1)
}
if (!SUPABASE_URL || !KEY) {
  console.error(`Нет SUPABASE_URL или SUPABASE_SERVICE_KEY (ищу в ${envFile})`)
  process.exit(1)
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function api(method, url, body, extra = {}) {
  const res = await fetch(`${SUPABASE_URL}${url}`, { method, headers: { ...headers, ...extra }, body })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* не json */ }
  return { ok: res.ok, status: res.status, json, text }
}

// «Джин  Bombay Sapphire!.png» и «джин bombay sapphire» — одно и то же.
export const normName = (s) => String(s || '')
  .toLowerCase().replace(/ё/g, 'е')
  .replace(IMAGE_EXT, '')
  .replace(/[«»"'`’.,!?()_\-–—/\\]+/g, ' ')
  .replace(/\s+/g, ' ').trim()

const words = (s) => new Set(normName(s).split(' ').filter((w) => w.length > 1))
function similarity(a, b) {
  const A = words(a), B = words(b)
  if (!A.size || !B.size) return 0
  let common = 0
  for (const w of A) if (B.has(w)) common++
  return common / Math.max(A.size, B.size)
}

async function loadMenu() {
  let q = `/rest/v1/menu_items?select=id,dish_name,menu_section,image_url&restaurant_id=eq.${restaurantId}`
  if (section) q += `&menu_section=eq.${encodeURIComponent(section)}`
  const r = await api('GET', q)
  if (!r.ok) throw new Error(`Не удалось прочитать меню: HTTP ${r.status} ${r.text.slice(0, 200)}`)
  return r.json || []
}

// Файл → записи меню. Сначала точное совпадение названия, затем — если
// единственный кандидат — почти точное (все слова файла есть в названии).
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

async function ensureBucket() {
  const r = await api('GET', `/storage/v1/bucket/${BUCKET}`)
  if (r.ok) return
  if (r.status === 404 || r.status === 400) {
    const c = await api('POST', '/storage/v1/bucket', JSON.stringify({ id: BUCKET, name: BUCKET, public: true }), { 'Content-Type': 'application/json' })
    if (!c.ok && !/already exists/i.test(c.text)) throw new Error(`Не удалось создать хранилище ${BUCKET}: HTTP ${c.status} ${c.text.slice(0, 200)}`)
    console.log(`Создано хранилище ${BUCKET} (открыто на чтение)`)
    return
  }
  throw new Error(`Хранилище Supabase недоступно: HTTP ${r.status} ${r.text.slice(0, 200)}`)
}

async function render(file, size) {
  let img = sharp(file, { animated: false }).rotate()
  // Обрезаем однотонные поля вокруг бутылки — тогда она крупнее в карточке.
  try {
    const trimmed = await img.clone().trim({ threshold: 12 }).toBuffer()
    img = sharp(trimmed)
  } catch { /* однотонная картинка — оставляем как есть */ }
  return img
    .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .webp({ quality: 82, alphaQuality: 90 })
    .toBuffer()
}

async function upload(objectPath, buffer) {
  const r = await api('POST', `/storage/v1/object/${BUCKET}/${objectPath}`, buffer, {
    'Content-Type': 'image/webp',
    'x-upsert': 'true',
    'cache-control': 'max-age=31536000',
  })
  if (!r.ok) throw new Error(`загрузка ${objectPath}: HTTP ${r.status} ${r.text.slice(0, 200)}`)
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`
}

async function main() {
  const files = fs.readdirSync(dir).filter((f) => IMAGE_EXT.test(f)).sort((a, b) => a.localeCompare(b, 'ru'))
  if (!files.length) { console.log(`В ${dir} нет картинок`); return }
  const menu = await loadMenu()
  console.log(`Ресторан ${restaurantId}${section ? `, раздел «${section}»` : ''}: блюд в меню ${menu.length}, файлов ${files.length}\n`)

  const plan = []
  for (const f of files) {
    const m = matchFile(f, menu)
    if (!m.items.length) {
      console.log(`  ✗ ${f} — блюдо не найдено${m.suggestions?.length ? `. Похожие: ${m.suggestions.join(' | ')}` : ''}`)
      continue
    }
    const where = m.items.map((i) => i.menu_section).join(', ')
    console.log(`  ✓ ${f} → ${m.items[0].dish_name} (${where})${m.fuzzy ? '  ← похоже, проверьте' : ''}${m.items.some((i) => i.image_url) ? '  [фото заменится]' : ''}`)
    plan.push({ file: path.join(dir, f), items: m.items })
  }

  console.log(`\nНайдено ${plan.length} из ${files.length}.`)
  if (!go) {
    console.log('Это просмотр — ничего не загружено. Если всё верно, запустите ещё раз с --go')
    return
  }
  if (!plan.length) return

  await ensureBucket()
  let done = 0
  for (const p of plan) {
    try {
      const big = await render(p.file, 800)
      const hash = crypto.createHash('sha1').update(big).digest('hex').slice(0, 8)
      const anchorId = p.items[0].id
      const urls = {}
      for (const s of SIZES) {
        const buf = s.size === 800 ? big : await render(p.file, s.size)
        urls[s.field] = await upload(`${restaurantId}/dishes/${anchorId}_${hash}${s.suffix}.webp`, buf)
      }
      for (const item of p.items) {
        const r = await api('PATCH', `/rest/v1/menu_items?id=eq.${item.id}`, JSON.stringify(urls), {
          'Content-Type': 'application/json', Prefer: 'return=minimal',
        })
        if (!r.ok) throw new Error(`ссылка в меню: HTTP ${r.status} ${r.text.slice(0, 200)}`)
      }
      done++
      console.log(`  ↑ ${path.basename(p.file)} — ${(big.length / 1024).toFixed(0)} КБ`)
    } catch (err) {
      console.log(`  ✗ ${path.basename(p.file)} — ${err.message}`)
    }
  }
  console.log(`\nГотово: ${done} из ${plan.length}. Меню у гостей обновится в течение минуты.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((err) => { console.error(err.message || err); process.exit(1) })
}
