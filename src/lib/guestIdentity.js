import { supabase } from '../supabaseClient';
import { getOrCreateDeviceId } from './deviceId';

// Номер гостя (guests.id) для этого устройства. Сначала просто узнаём его по
// связке устройство → гость (без записи), и только если гостя ещё нет —
// регистрируем визит. Нужен там, где номер обязателен прямо сейчас
// (викторина), а стартовая регистрация визита в App могла не успеть или
// упасть — викторину это не должно отменять.
export async function resolveGuestId() {
  const deviceId = getOrCreateDeviceId();
  try {
    const { data, error } = await supabase.rpc('guest_id_for_device', { p_device_id: deviceId });
    if (!error && data) return Number(data);
  } catch { /* пробуем регистрацию ниже */ }
  try {
    const { data, error } = await supabase.rpc('register_guest_visit', { p_device_id: deviceId });
    if (!error && data?.[0]?.id) return data[0].id;
  } catch { /* нет связи — вызывающий решит, что делать */ }
  return null;
}
