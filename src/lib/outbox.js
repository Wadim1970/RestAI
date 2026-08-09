// Очередь отложенных действий (outbox) на случай потери связи.
//
// Критичные действия гостя — «отправить заказ» и «вызвать официанта» — это
// вызовы Supabase RPC. Если в момент нажатия связь пропала, мы не теряем
// действие, а кладём его сюда (localStorage) и повторяем, как только связь
// вернётся (событие window 'online'). Каждый элемент — самодостаточный вызов
// RPC (имя + все параметры), поэтому повтор не зависит от текущего состояния
// приложения.
const KEY = 'restai_outbox_v1'

const read = () => {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

const listeners = new Set()
const notify = () => {
  const n = read().length
  listeners.forEach((l) => l(n))
}

const write = (queue) => {
  localStorage.setItem(KEY, JSON.stringify(queue))
  notify()
}

const newId = () => {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

export const outboxSize = () => read().length

// Подписка для индикатора: сразу отдаёт текущий размер и зовёт при изменениях.
export const subscribeOutbox = (listener) => {
  listeners.add(listener)
  listener(read().length)
  return () => listeners.delete(listener)
}

// action: { type, rpc, params } — где rpc/params описывают вызов Supabase.
export const enqueue = (action) => {
  write([...read(), { ...action, id: newId(), ts: Date.now() }])
}

// Прогон очереди. perform(action) должна вернуть:
//   'done'  — выполнено, убрать из очереди;
//   'retry' — связи снова нет, прекратить проход (попробуем в следующий раз);
//   'drop'  — сервер отклонил (не сетевой сбой) — убрать, чтобы не зациклиться.
// Идёт строго по одному и по порядку; при 'retry' останавливаемся, сохраняя
// очерёдность.
let flushing = false
export async function flushOutbox(perform) {
  if (flushing) return
  flushing = true
  try {
    for (const action of read()) {
      let result
      try {
        result = await perform(action)
      } catch {
        result = 'retry'
      }
      if (result === 'retry') break
      write(read().filter((a) => a.id !== action.id))
    }
  } finally {
    flushing = false
  }
}
