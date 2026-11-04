// Проверка видео блюда перед загрузкой: что воспроизведётся на любом телефоне гостя.
// Требования (README.md): MP4, видео H.264 (yuv420p), вертикальное 9:16, без звука,
// 5–6 секунд, до ~2 МБ, «быстрый старт» (moov в начале файла).

export const SPEC = {
  okBytes: 2 * 1024 * 1024,
  hardBytes: 5 * 1024 * 1024, // лимит хранилища menu-videos
  okSeconds: 8,
  hardSeconds: 15,
  ratio: 9 / 16,
}

// «Быстрый старт»: атом moov идёт раньше mdat — видео начинает играть, не дожидаясь
// скачивания всего файла. buf — начало файла (достаточно первых ~64 КБ).
export function isFastStart(buf) {
  let pos = 0
  while (pos + 8 <= buf.length) {
    let size = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    if (type === 'moov') return true
    if (type === 'mdat') return false
    if (size === 1) {
      if (pos + 16 > buf.length) return null
      size = Number(buf.readBigUInt64BE(pos + 8))
    }
    if (size < 8) return null
    pos += size
  }
  return null // начала файла не хватило
}

// Размер кадра с учётом поворота (видео с телефона часто «лежит» с флагом поворота).
export function displaySize(stream) {
  let w = Number(stream.width) || 0
  let h = Number(stream.height) || 0
  const rot = Number(stream.tags?.rotate ?? stream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0)
  if (Math.abs(rot) % 180 === 90) [w, h] = [h, w]
  return { w, h }
}

// probe — вывод `ffprobe -show_streams -show_format -of json`.
export function checkVideo({ probe, size, fastStart }) {
  const errors = []
  const warnings = []
  const streams = probe?.streams || []
  const v = streams.find((s) => s.codec_type === 'video')
  const hasAudio = streams.some((s) => s.codec_type === 'audio')

  if (!v) {
    errors.push('в файле нет видео')
    return { errors, warnings }
  }
  const fmt = String(probe?.format?.format_name || '')
  if (!/mp4/.test(fmt)) errors.push(`контейнер «${fmt || '?'}», нужен MP4`)
  if (v.codec_name !== 'h264') {
    errors.push(v.codec_name === 'hevc'
      ? 'кодек HEVC (H.265, так пишет камера iPhone) — на части телефонов не проиграется; экспортируйте в H.264'
      : `кодек ${v.codec_name}, нужен H.264`)
  }
  if (v.pix_fmt && v.pix_fmt !== 'yuv420p') errors.push(`формат пикселей ${v.pix_fmt} (10 бит/HDR) — на части телефонов не проиграется; нужен yuv420p`)

  const { w, h } = displaySize(v)
  if (w && h) {
    if (w > h) errors.push(`кадр горизонтальный (${w}×${h}), нужен вертикальный 9:16`)
    else if (Math.abs(w / h - SPEC.ratio) > 0.06) warnings.push(`пропорции ${w}×${h} не 9:16 — края будут обрезаны по центру`)
    if (w > 1080) warnings.push(`ширина ${w} px больше нужного — файл тяжелее, чем надо (хватит 540–720)`)
    if (w < 360) warnings.push(`ширина ${w} px — на экране телефона будет мутно (нужно от 480)`)
  }

  const dur = Number(probe?.format?.duration ?? v.duration)
  if (Number.isFinite(dur)) {
    if (dur > SPEC.hardSeconds) errors.push(`длительность ${dur.toFixed(1)} с — слишком длинное (до ${SPEC.hardSeconds} с, лучше 5–6)`)
    else if (dur > SPEC.okSeconds) warnings.push(`длительность ${dur.toFixed(1)} с — дольше обычных 5–6 с`)
  }

  const fps = (() => { const [a, b] = String(v.avg_frame_rate || '0/1').split('/').map(Number); return b ? a / b : 0 })()
  if (fps > 31) warnings.push(`${Math.round(fps)} кадров/с — хватит 24–30, файл будет тяжелее`)

  if (hasAudio) warnings.push('в файле есть звук — приложение его не воспроизводит, он только утяжеляет файл')

  if (size > SPEC.hardBytes) errors.push(`размер ${(size / 1048576).toFixed(1)} МБ больше лимита хранилища ${SPEC.hardBytes / 1048576} МБ`)
  else if (size > SPEC.okBytes) warnings.push(`размер ${(size / 1048576).toFixed(1)} МБ — тяжелее ориентира 2 МБ, на слабой сети будет грузиться долго`)

  if (fastStart === false) errors.push('нет «быстрого старта» (moov в конце файла): видео не начнёт играть, пока не скачается целиком. Исправляется без потерь: ключ --fix')
  else if (fastStart === null) warnings.push('не удалось проверить «быстрый старт»')

  return { errors, warnings }
}
