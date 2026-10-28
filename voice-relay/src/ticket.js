// Билет на голосовой разговор (миграция 20261029010000_voice_tickets).
// Телефон получает билет у базы (voice_ticket_issue) и передаёт его в адресе
// /voice. Здесь он гасится (voice_ticket_consume): ресторан, стол и устройство
// берутся из билета, а не из ссылки.
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

let client = null;
function defaultRpc(name, args) {
  if (!client) client = createClient(config.supabaseUrl, config.supabaseAnonKey);
  return client.rpc(name, args);
}

// Вернёт { restaurantId, tableNumber, deviceId } или null (нет/просрочен/уже
// использован/ошибка базы). rpc можно подменить в тестах.
export async function consumeTicket(ticket, rpc = defaultRpc) {
  if (typeof ticket !== 'string' || !/^[0-9a-f]{64}$/.test(ticket)) return null;
  try {
    const { data, error } = await rpc('voice_ticket_consume', { p_ticket: ticket });
    if (error || !data) return null;
    return {
      restaurantId: data.restaurant_id,
      tableNumber: data.table_number,
      deviceId: data.device_id,
    };
  } catch {
    return null;
  }
}
