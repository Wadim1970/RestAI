import { useState, useEffect } from 'react'

function checkStandalone() {
  // Android/десктоп: медиа-запрос display-mode. iOS Safari его не поддерживает
  // и использует свой отдельный флаг navigator.standalone.
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

// true, только когда приложение реально запущено с иконки (установлено),
// а не открыто в браузере. См. объяснение в чате: на iOS это НЕЛЬЗЯ узнать
// из вкладки Safari (изолированное хранилище) — только внутри самого
// установленного приложения через этот флаг.
export function useDisplayMode() {
  const [isStandalone, setIsStandalone] = useState(checkStandalone)

  useEffect(() => {
    const mq = window.matchMedia?.('(display-mode: standalone)')
    const handler = () => setIsStandalone(checkStandalone())
    mq?.addEventListener?.('change', handler)
    return () => mq?.removeEventListener?.('change', handler)
  }, [])

  return isStandalone
}

export function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
}
