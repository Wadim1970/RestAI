import { useState, useEffect } from 'react'

// Возвращает текущее состояние связи и обновляется на события браузера
// online/offline. navigator.onLine не идеален (говорит лишь о наличии сети,
// не о доступности сервера), но для баннера «нет связи» его достаточно —
// реальную недоступность сервера отдельно ловит очередь запросов (outbox).
export function useOnline() {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])
  return online
}
