import { useState, useEffect } from 'react'

// ВАЖНО: display-mode в manifest.json у нас "fullscreen", а не "standalone" —
// это РАЗНЫЕ, взаимоисключающие значения media-запроса display-mode
// (fullscreen | standalone | minimal-ui | window-controls-overlay | browser).
// Проверять надо не "standalone" конкретно, а "не browser" — иначе после
// установки и запуска с иконки (реально в режиме fullscreen) эта проверка
// давала false, и промо установки показывалось снова даже для уже
// установленного приложения.
function checkStandalone() {
  if (window.navigator.standalone === true) return true // iOS Safari, свой флаг
  if (!window.matchMedia) return false
  return !window.matchMedia('(display-mode: browser)').matches
}

// true, только когда приложение реально запущено с иконки (установлено),
// а не открыто в браузере. См. объяснение в чате: на iOS это НЕЛЬЗЯ узнать
// из вкладки Safari (изолированное хранилище) — только внутри самого
// установленного приложения через этот флаг.
export function useDisplayMode() {
  const [isStandalone, setIsStandalone] = useState(checkStandalone)

  useEffect(() => {
    const mq = window.matchMedia?.('(display-mode: browser)')
    const handler = () => setIsStandalone(checkStandalone())
    mq?.addEventListener?.('change', handler)
    return () => mq?.removeEventListener?.('change', handler)
  }, [])

  return isStandalone
}

export function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
}

export function isAndroidDevice() {
  return /Android/.test(navigator.userAgent)
}
