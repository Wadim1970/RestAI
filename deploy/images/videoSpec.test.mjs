// node --test deploy/images/*.test.mjs — проверка видео блюда и сопоставление названий.
// Файлы для проверки создаёт настоящий ffmpeg (нет ffmpeg — тесты на файлах пропускаются).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkVideo, isFastStart, displaySize } from './videoSpec.mjs'
import { matchFile, normName } from './matching.mjs'

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dishvid-'))

function make(name, { size = '540x960', secs = 5, codec = 'libx264', pix = 'yuv420p', audio = false, fast = true, extra = [] } = {}) {
  const out = path.join(dir, name)
  const args = ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30:duration=${secs}`]
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}`)
  args.push('-c:v', codec, '-pix_fmt', pix, '-b:v', '800k', ...extra)
  if (audio) args.push('-c:a', 'aac'); else args.push('-an')
  if (fast) args.push('-movflags', '+faststart')
  args.push(out)
  execFileSync('ffmpeg', args)
  return out
}
function inspect(file) {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }))
  const head = fs.readFileSync(file).subarray(0, 65536)
  return checkVideo({ probe, size: fs.statSync(file).size, fastStart: isFastStart(head) })
}
const skip = hasFfmpeg ? false : 'нет ffmpeg'

test('правильное видео: 9:16, H.264, без звука, быстрый старт — без замечаний', { skip }, () => {
  const r = inspect(make('good.mp4'))
  assert.deepEqual(r, { errors: [], warnings: [] })
})

test('без «быстрого старта» — ошибка', { skip }, () => {
  const r = inspect(make('slow.mp4', { fast: false }))
  assert.ok(r.errors.some((e) => /быстрого старта/.test(e)), r.errors.join('|'))
})

test('HEVC (камера iPhone) — ошибка с понятной причиной', { skip }, () => {
  const r = inspect(make('hevc.mp4', { codec: 'libx265', extra: ['-tag:v', 'hvc1'] }))
  assert.ok(r.errors.some((e) => /HEVC/.test(e)), r.errors.join('|'))
})

test('10 бит — ошибка', { skip }, () => {
  const r = inspect(make('p10.mp4', { codec: 'libx264', pix: 'yuv420p10le' }))
  assert.ok(r.errors.some((e) => /yuv420p/.test(e)), r.errors.join('|'))
})

test('горизонтальное — ошибка, квадратное — предупреждение', { skip }, () => {
  assert.ok(inspect(make('land.mp4', { size: '960x540' })).errors.some((e) => /горизонтальный/.test(e)))
  const sq = inspect(make('sq.mp4', { size: '720x720' }))
  assert.equal(sq.errors.length, 0)
  assert.ok(sq.warnings.some((w) => /не 9:16/.test(w)))
})

test('звук и длинное видео — предупреждения; слишком длинное — ошибка', { skip }, () => {
  const a = inspect(make('audio.mp4', { audio: true, secs: 10 }))
  assert.ok(a.warnings.some((w) => /есть звук/.test(w)))
  assert.ok(a.warnings.some((w) => /дольше обычных/.test(w)))
  assert.ok(inspect(make('long.mp4', { secs: 20 })).errors.some((e) => /слишком длинное/.test(e)))
})

test('крупный кадр и малый кадр — предупреждения', { skip }, () => {
  assert.ok(inspect(make('big.mp4', { size: '1440x2560', secs: 2 })).warnings.some((w) => /больше нужного/.test(w)))
  assert.ok(inspect(make('small.mp4', { size: '270x480', secs: 2 })).warnings.some((w) => /мутно/.test(w)))
})

test('isFastStart читает порядок атомов', () => {
  const atom = (type, n) => { const b = Buffer.alloc(n); b.writeUInt32BE(n, 0); b.write(type, 4, 'latin1'); return b }
  assert.equal(isFastStart(Buffer.concat([atom('ftyp', 24), atom('moov', 40), atom('mdat', 100)])), true)
  assert.equal(isFastStart(Buffer.concat([atom('ftyp', 24), atom('mdat', 100), atom('moov', 40)])), false)
  assert.equal(isFastStart(Buffer.concat([atom('ftyp', 24)])), null)
})

test('поворот: видео «лежит» с флагом 90° — размеры меняются местами', () => {
  assert.deepEqual(displaySize({ width: 1920, height: 1080, tags: { rotate: '90' } }), { w: 1080, h: 1920 })
  assert.deepEqual(displaySize({ width: 540, height: 960 }), { w: 540, h: 960 })
})

test('нет видеодорожки, не MP4 — ошибки', () => {
  assert.ok(checkVideo({ probe: { streams: [{ codec_type: 'audio' }], format: {} }, size: 1, fastStart: true }).errors.length > 0)
  const r = checkVideo({ probe: { streams: [{ codec_type: 'video', codec_name: 'vp9', pix_fmt: 'yuv420p', width: 540, height: 960 }], format: { format_name: 'matroska,webm', duration: '5' } }, size: 1000, fastStart: null })
  assert.ok(r.errors.some((e) => /MP4/.test(e)) && r.errors.some((e) => /H\.264/.test(e)))
})

test('сопоставление: название файла → блюдо (все копии в разделах)', () => {
  const menu = [
    { id: '1', dish_name: 'Пепперони', menu_section: 'Популярное' },
    { id: '2', dish_name: 'Пепперони', menu_section: 'Пицца' },
    { id: '3', dish_name: 'Борщ', menu_section: 'Супы' },
  ]
  assert.deepEqual(matchFile('пепперони.mp4', menu).items.map((i) => i.id), ['1', '2'])
  assert.deepEqual(matchFile('Борщ!.MP4', menu).items.map((i) => i.id), ['3'])
  assert.equal(matchFile('Карбонара.mp4', menu).items.length, 0)
  assert.equal(normName('Ёжик  в тумане.mp4'), 'ежик в тумане')
})
