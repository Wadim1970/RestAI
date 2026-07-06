import { useState, useEffect, useCallback } from 'react'

// Android/десктоп-Chrome сами присылают это событие, когда приложение
// соответствует критериям установки (манифест + SW + https). Ловим его
// как можно раньше и держим у себя — иначе браузер покажет свой системный
// баннер вместо нашей кнопки, а вызвать установку второй раз нельзя.
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    try {
      await deferredPrompt.userChoice
    } finally {
      // Событие одноразовое — использованный prompt повторно не вызвать.
      setDeferredPrompt(null)
    }
  }, [deferredPrompt])

  return { canInstall: !!deferredPrompt, promptInstall }
}
