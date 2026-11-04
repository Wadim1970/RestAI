// Видео блюд → своё хранилище Supabase → ссылки в меню.
//
//   node upload-dish-videos.mjs --dir /opt/restai/uploads/video [--section "Горячие блюда"] [--fix] [--go]
//   node upload-dish-videos.mjs --remove "Борщ" [--go]        # убрать видео у блюда (останется фото)
//
// Без --go — только показывает, какой файл к какому блюду подойдёт и подходит ли
// сам файл, ничего не загружая. Файлы называются как блюдо в меню: «Борщ.mp4».
// Для каждого файла:
//   • проверяет, что он проиграется у любого гостя: MP4, H.264 (yuv420p), вертикальный
//     9:16, без звука, до ~2 МБ, «быстрый старт» (см. videoSpec.mjs). Файл с ошибкой не
//     загружается; предупреждения (тяжёлый, есть звук) — загружается, но вам видно;
//   • --fix без потерь исправляет «быстрый старт» (ffmpeg -c copy), если его нет;
//   • загружает в bucket menu-videos: <ресторан>/dishes/<id блюда>_<хэш>.mp4 — имя по
//     id блюда, хэш меняется вместе с файлом (гости не застрянут на старом из кэша);
//   • прописывает video_url всем записям блюда с этим названием («Пепперони» в
//     «Популярном» и в «Пицце» — одно видео).
//
// Адрес Supabase и сервисный ключ берёт из /opt/restai/Waiter-app/.env.production
// (SUPABASE_URL, SUPABASE_SERVICE_KEY). Подробнее — README.md рядом.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { matchFile } from './matching.mjs'
import { checkVideo, isFastStart, SPEC } from './videoSpec.mjs'

const BUCKET = 'menu-videos'
const DEFAULT_RESTAURANT = 'dd89773c-0952-4fd1-9510-514094a928ee'
const VIDEO_EXT = /\.mp4$/i

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
const removeName = arg('remove')
const restaurantId = arg('restaurant', DEFAULT_RESTAURANT)
const section = arg('section')
const go = has('go')
const fix = has('fix')
const envFile = arg('env', '/opt/restai/Waiter-app/.env.production')
const env = { ...loadEnv(envFile), ...process.env }
const SUPABASE_URL = String(env.SUPABASE_URL || '').replace(/\/$/, '')
const KEY = env.SUPABASE_SERVICE_KEY

if (!removeName && (!dir || !fs.existsSync(dir))) {
  console.error('Укажите папку с видео: --dir /opt/restai/uploads/video   (или --remove "Название блюда")')
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

async function loadMenu() {
  let q = `/rest/v1/menu_items?select=id,dish_name,menu_section,video_url&restaurant_id=eq.${restaurantId}`
  if (section) q += `&menu_section=eq.${encodeURIComponent(section)}`
  const r = await api('GET', q)
  if (!r.ok) {
    if (/video_url/.test(r.text)) throw new Error('В базе нет колонки video_url — сначала примените миграцию 20261104010000_menu_item_video.sql')
    throw new Error(`Не удалось прочитать меню: HTTP ${r.status} ${r.text.slice(0, 200)}`)
  }
  return r.json || []
}

async function ensureBucket() {
  const r = await api('GET', `/storage/v1/bucket/${BUCKET}`)
  if (r.ok) return
  if (r.status === 404 || r.status === 400) {
    const c = await api('POST', '/storage/v1/bucket', JSON.stringify({
      id: BUCKET, name: BUCKET, public: true, file_size_limit: SPEC.hardBytes, allowed_mime_types: ['video/mp4'],
    }), { 'Content-Type': 'application/json' })
    if (!c.ok && !/already exists/i.test(c.text)) throw new Error(`Не удалось создать хранилище ${BUCKET}: HTTP ${c.status} ${c.text.slice(0, 200)}`)
    console.log(`Создано хранилище ${BUCKET} (открыто на чтение, до ${SPEC.hardBytes / 1048576} МБ, только MP4)`)
    return
  }
  throw new Error(`Хранилище Supabase недоступно: HTTP ${r.status} ${r.text.slice(0, 200)}`)
}

const hasFfmpeg = spawnSync('ffprobe', ['-version']).status === 0

// Проверка файла. Возвращает { errors, warnings, file } — file может быть исправленной копией.
function inspect(file) {
  const size = fs.statSync(file).size
  const head = Buffer.alloc(65536)
  const fd = fs.openSync(file, 'r')
  const n = fs.readSync(fd, head, 0, head.length, 0)
  fs.closeSync(fd)
  const fastStart = isFastStart(head.subarray(0, n))

  if (!hasFfmpeg) {
    // Без ffprobe проверяем только то, что видно без него.
    const errors = []
    const warnings = ['ffprobe не установлен — кодек, размер кадра и длительность не проверены (apt install ffmpeg)']
    if (size > SPEC.hardBytes) errors.push(`размер ${(size / 1048576).toFixed(1)} МБ больше лимита ${SPEC.hardBytes / 1048576} МБ`)
    if (fastStart === false) errors.push('нет «быстрого старта» (moov в конце файла)')
    return { errors, warnings, file }
  }
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }))
  let res = checkVideo({ probe, size, fastStart })

  if (fix && res.errors.some((e) => /быстрого старта/.test(e))) {
    const out = path.join(os.tmpdir(), `dishvideo-${crypto.randomBytes(4).toString('hex')}.mp4`)
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', file, '-c', 'copy', '-movflags', '+faststart', out])
    const head2 = fs.readFileSync(out).subarray(0, 65536)
    res = checkVideo({ probe, size: fs.statSync(out).size, fastStart: isFastStart(head2) })
    res.warnings.unshift('«быстрый старт» исправлен автоматически (без потери качества)')
    return { ...res, file: out }
  }
  return { ...res, file }
}

async function patchItems(items, videoUrl) {
  for (const item of items) {
    const r = await api('PATCH', `/rest/v1/menu_items?id=eq.${item.id}`, JSON.stringify({ video_url: videoUrl }), {
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    })
    if (!r.ok) throw new Error(`ссылка в меню: HTTP ${r.status} ${r.text.slice(0, 200)}`)
  }
}

async function removeVideo() {
  const menu = await loadMenu()
  const m = matchFile(removeName, menu)
  if (!m.items.length) {
    console.log(`Блюдо «${removeName}» не найдено${m.suggestions?.length ? `. Похожие: ${m.suggestions.join(' | ')}` : ''}`)
    return
  }
  console.log(`${m.items[0].dish_name}: ${m.items.length} зап. (${m.items.map((i) => i.menu_section).join(', ')}), видео ${m.items.some((i) => i.video_url) ? 'есть' : 'нет'}`)
  if (!go) { console.log('Это просмотр — ничего не изменено. Добавьте --go, чтобы убрать видео (останется фото).'); return }
  await patchItems(m.items, null)
  console.log('Видео убрано: гости видят фото. Файл в хранилище остался (можно вернуть загрузкой заново).')
}

async function main() {
  const files = fs.readdirSync(dir).filter((f) => VIDEO_EXT.test(f)).sort((a, b) => a.localeCompare(b, 'ru'))
  if (!files.length) { console.log(`В ${dir} нет файлов .mp4`); return }
  const menu = await loadMenu()
  console.log(`Ресторан ${restaurantId}${section ? `, раздел «${section}»` : ''}: блюд в меню ${menu.length}, файлов ${files.length}\n`)

  const plan = []
  let bad = 0
  for (const f of files) {
    const m = matchFile(f, menu)
    if (!m.items.length) {
      console.log(`  ✗ ${f} — блюдо не найдено${m.suggestions?.length ? `. Похожие: ${m.suggestions.join(' | ')}` : ''}`)
      bad++
      continue
    }
    const where = m.items.map((i) => i.menu_section).join(', ')
    const r = inspect(path.join(dir, f))
    const mark = r.errors.length ? '✗' : '✓'
    console.log(`  ${mark} ${f} → ${m.items[0].dish_name} (${where})${m.fuzzy ? '  ← похоже, проверьте' : ''}${m.items.some((i) => i.video_url) ? '  [видео заменится]' : ''}`)
    for (const e of r.errors) console.log(`      ОШИБКА: ${e}`)
    for (const w of r.warnings) console.log(`      внимание: ${w}`)
    if (r.errors.length) { bad++; continue }
    plan.push({ file: r.file, name: f, items: m.items })
  }

  console.log(`\nГотово к загрузке ${plan.length} из ${files.length}${bad ? `, не подходит ${bad}` : ''}.`)
  if (!go) {
    console.log('Это просмотр — ничего не загружено. Если всё верно, запустите ещё раз с --go')
    return
  }
  if (!plan.length) return

  await ensureBucket()
  let done = 0
  for (const p of plan) {
    try {
      const buf = fs.readFileSync(p.file)
      const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8)
      const objectPath = `${restaurantId}/dishes/${p.items[0].id}_${hash}.mp4`
      const r = await api('POST', `/storage/v1/object/${BUCKET}/${objectPath}`, buf, {
        'Content-Type': 'video/mp4', 'x-upsert': 'true', 'cache-control': 'max-age=31536000',
      })
      if (!r.ok) throw new Error(`загрузка ${objectPath}: HTTP ${r.status} ${r.text.slice(0, 200)}`)
      await patchItems(p.items, `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`)
      done++
      console.log(`  ↑ ${p.name} — ${(buf.length / 1024).toFixed(0)} КБ`)
    } catch (err) {
      console.log(`  ✗ ${p.name} — ${err.message}`)
    }
  }
  console.log(`\nЗагружено ${done} из ${plan.length}. Гости увидят видео в окне блюда (в кэше меню — до нескольких минут).`)
}

try {
  if (removeName) await removeVideo()
  else await main()
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
