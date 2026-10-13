// Общий источник device_id и для register_guest_visit, и для place_guest_order —
// одно устройство должно всегда попадать в одно и то же место (seat) за столом.
// По нему же сервер находит профиль гостя для подбора пар блюд.
export function getOrCreateDeviceId() {
  let deviceId = localStorage.getItem('restai_device_id');
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem('restai_device_id', deviceId);
  }
  return deviceId;
}
