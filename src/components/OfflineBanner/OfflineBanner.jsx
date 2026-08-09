import { useState, useEffect } from 'react'
import { subscribeOutbox } from '../../lib/outbox'
import { useOnline } from '../../lib/useOnline'
import styles from './OfflineBanner.module.css'

// Тонкая плашка сверху. Молчит, когда всё хорошо; показывается, когда нет
// связи или в очереди есть неотправленные действия (заказ/вызов), и сообщает,
// что они уйдут автоматически. Так гость не думает, что «кнопка не работает».
export default function OfflineBanner() {
  const online = useOnline()
  const [pending, setPending] = useState(0)

  useEffect(() => subscribeOutbox(setPending), [])

  if (online && pending === 0) return null

  let text
  if (!online) {
    text = pending > 0
      ? `Нет связи — ${pending} действ. отправятся автоматически`
      : 'Нет связи с интернетом'
  } else {
    text = `Связь есть — отправляем${pending > 0 ? ` (${pending})` : ''}…`
  }

  return (
    <div className={`${styles.banner} ${online ? styles.syncing : styles.offline}`}>
      {text}
    </div>
  )
}
