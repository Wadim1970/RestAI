// Сквозная проверка скрипта загрузки видео: настоящий скрипт + настоящий ffmpeg против
// поддельного Supabase (меню, хранилище, ссылки). node --test deploy/images/*.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const skip = hasFfmpeg ? false : 'нет ffmpeg'
const SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), 'upload-dish-videos.mjs')

const state = { menu: [], buckets: new Set(), objects: new Map(), bucketBody: null }
let server, base, dir

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dishvid-e2e-'))
  state.menu = [
    { id: 'm1', dish_name: 'Пепперони', menu_section: 'Популярное', video_url: null },
    { id: 'm2', dish_name: 'Пепперони', menu_section: 'Пицца', video_url: null },
    { id: 'm3', dish_name: 'Борщ', menu_section: 'Супы', video_url: 'https://old/video.mp4' },
    { id: 'm4', dish_name: 'Лапша куриная', menu_section: 'Супы', video_url: null },
  ]
  server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const body = Buffer.concat(chunks)
    const u = new URL(req.url, 'http://x')
    const send = (code, obj, raw) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(raw ?? JSON.stringify(obj)) }
    if (req.method === 'GET' && u.pathname === '/rest/v1/menu_items') return send(200, state.menu)
    if (req.method === 'PATCH' && u.pathname === '/rest/v1/menu_items') {
      const id = u.searchParams.get('id').replace('eq.', '')
      const it = state.menu.find((m) => m.id === id)
      Object.assign(it, JSON.parse(body.toString()))
      return send(204, null, '')
    }
    if (req.method === 'GET' && u.pathname === '/storage/v1/bucket/menu-videos') return state.buckets.has('menu-videos') ? send(200, {}) : send(404, { error: 'not found' })
    if (req.method === 'POST' && u.pathname === '/storage/v1/bucket') { state.bucketBody = JSON.parse(body.toString()); state.buckets.add(state.bucketBody.id); return send(200, {}) }
    if (req.method === 'POST' && u.pathname.startsWith('/storage/v1/object/menu-videos/')) {
      state.objects.set(u.pathname.replace('/storage/v1/object/menu-videos/', ''), { size: body.length, type: req.headers['content-type'] })
      return send(200, {})
    }
    send(404, { error: 'нет такого пути ' + u.pathname })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => { server.close() })

function make(name, extra = []) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=540x960:rate=30:duration=5',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-b:v', '800k', '-an', ...extra, path.join(dir, name)])
}
// Скрипт запускаем асинхронно: поддельный Supabase работает в этом же процессе,
// синхронный запуск заблокировал бы его.
function run(args) {
  return new Promise((resolve) => {
    const p = spawn('node', [SCRIPT, '--restaurant', 'R1', ...args], {
      env: { ...process.env, SUPABASE_URL: base, SUPABASE_SERVICE_KEY: 'test-key' },
    })
    let out = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { out += d })
    p.on('close', (code) => resolve({ out, code }))
  })
}

test('просмотр без --go: показывает, что куда, и ничего не загружает', { skip }, async () => {
  make('пепперони.mp4', ['-movflags', '+faststart'])
  make('Борщ.mp4', ['-movflags', '+faststart'])
  make('Карбонара.mp4', ['-movflags', '+faststart'])
  const r = await run(['--dir', dir])
  assert.match(r.out, /✓ пепперони\.mp4 → Пепперони \(Популярное, Пицца\)/)
  assert.match(r.out, /✓ Борщ\.mp4 → Борщ .*\[видео заменится\]/)
  assert.match(r.out, /✗ Карбонара\.mp4 — блюдо не найдено/)
  assert.match(r.out, /Это просмотр — ничего не загружено/)
  assert.equal(state.objects.size, 0)
  assert.equal(state.menu.find((m) => m.id === 'm1').video_url, null)
})

test('файл без «быстрого старта» не загружается, с --fix исправляется и загружается', { skip }, async () => {
  make('Лапша куриная.mp4') // без faststart
  let r = await run(['--dir', dir, '--go'])
  assert.match(r.out, /✗ Лапша куриная\.mp4/)
  assert.match(r.out, /ОШИБКА: нет «быстрого старта»/)
  assert.equal(state.menu.find((m) => m.id === 'm4').video_url, null)
  r = await run(['--dir', dir, '--fix', '--go'])
  assert.match(r.out, /«быстрый старт» исправлен автоматически/)
  assert.ok(state.menu.find((m) => m.id === 'm4').video_url, r.out)
})

test('--go: файлы в хранилище, ссылка на все копии блюда, хранилище создано с лимитами', { skip }, async () => {
  const m1 = state.menu.find((m) => m.id === 'm1').video_url
  const m2 = state.menu.find((m) => m.id === 'm2').video_url
  assert.ok(m1 && m1 === m2, 'обе копии Пепперони получили одну ссылку')
  assert.match(m1, new RegExp(`^${base}/storage/v1/object/public/menu-videos/R1/dishes/m1_[0-9a-f]{8}\\.mp4$`))
  assert.notEqual(state.menu.find((m) => m.id === 'm3').video_url, 'https://old/video.mp4', 'видео Борща заменено')
  assert.ok([...state.objects.values()].every((o) => o.type === 'video/mp4'))
  assert.equal(state.bucketBody.public, true)
  assert.deepEqual(state.bucketBody.allowed_mime_types, ['video/mp4'])
  assert.equal(state.bucketBody.file_size_limit, 5 * 1024 * 1024)
})

test('--remove: просмотр ничего не меняет, с --go убирает видео у всех копий', { skip }, async () => {
  let r = await run(['--remove', 'пепперони'])
  assert.match(r.out, /Пепперони: 2 зап\./)
  assert.ok(state.menu.find((m) => m.id === 'm1').video_url)
  r = await run(['--remove', 'пепперони', '--go'])
  assert.match(r.out, /Видео убрано/)
  assert.equal(state.menu.find((m) => m.id === 'm1').video_url, null)
  assert.equal(state.menu.find((m) => m.id === 'm2').video_url, null)
})
