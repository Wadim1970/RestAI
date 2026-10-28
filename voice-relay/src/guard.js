// Защита /voice: каждая минута разговора стоит денег, а адрес открыт всем.
// Здесь — чистая логика без сети, чтобы её можно было проверить тестами.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const isLoopback = (ip) => !ip || ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

// Браузер при открытии WebSocket всегда присылает Origin своего сайта. Если
// список разрешённых задан (ALLOWED_ORIGINS / CORS_ORIGIN), чужие и пустые
// Origin отклоняем: это не остановит целенаправленный скрипт (он может
// подставить любой Origin), но отсекает случайные и учебные подключения.
export function originAllowed(origin, allowed) {
  if (!allowed || allowed.length === 0) return true;
  if (!origin) return false;
  const norm = (s) => String(s).trim().replace(/\/+$/, '').toLowerCase();
  const o = norm(origin);
  return allowed.some((a) => norm(a) === o);
}

// Лимиты по IP и устройству. Всё хранится в памяти процесса (после перезапуска
// счётчики обнуляются, для защиты от потока этого достаточно).
export class SessionGuard {
  constructor({
    perIpMax = 3,
    perIpPerMinute = 12,
    perIpMinutesPerDay = 90,
    now = () => Date.now(),
    onWarn = () => {},
  } = {}) {
    this.perIpMax = perIpMax;
    this.perIpPerMinute = perIpPerMinute;
    this.perIpMsPerDay = perIpMinutesPerDay * MIN;
    this.now = now;
    this.onWarn = onWarn;
    this.ips = new Map(); // ip -> { active, starts:[ts], usedMs, dayStart }
    this.devices = new Map(); // deviceId -> { close }
    this.warnedLoopback = false;
  }

  _ip(ip) {
    let e = this.ips.get(ip);
    const t = this.now();
    if (!e) {
      e = { active: 0, starts: [], usedMs: 0, dayStart: t };
      this.ips.set(ip, e);
    }
    if (t - e.dayStart >= DAY) {
      e.usedMs = 0;
      e.dayStart = t;
    }
    e.starts = e.starts.filter((s) => t - s < MIN);
    return e;
  }

  _prune() {
    if (this.ips.size < 5000) return;
    const t = this.now();
    for (const [ip, e] of this.ips) {
      if (e.active === 0 && t - e.dayStart >= DAY) this.ips.delete(ip);
    }
  }

  // Принять подключение. Возвращает { ok:true, release } или { ok:false, code, message }.
  // close() — как закрыть ЭТО подключение, если его вытеснит новое с того же устройства.
  open({ ip, deviceId, close = () => {} }) {
    const t = this.now();
    const trackIp = !isLoopback(ip);
    if (!trackIp && !this.warnedLoopback) {
      this.warnedLoopback = true;
      this.onWarn('Не вижу реальный IP гостя (все подключения с 127.0.0.1): лимиты по IP отключены. Передайте X-Forwarded-For из nginx.');
    }

    let ipEntry = null;
    if (trackIp) {
      this._prune();
      ipEntry = this._ip(ip);
      if (ipEntry.starts.length >= this.perIpPerMinute) {
        return { ok: false, code: 'limit', message: 'Слишком много подключений, попробуйте через минуту.' };
      }
      if (ipEntry.active >= this.perIpMax) {
        return { ok: false, code: 'limit', message: 'Слишком много одновременных разговоров с этого адреса.' };
      }
      if (ipEntry.usedMs >= this.perIpMsPerDay) {
        return { ok: false, code: 'limit', message: 'Дневной лимит голосового помощника исчерпан, попробуйте завтра.' };
      }
      ipEntry.starts.push(t);
      ipEntry.active += 1;
    }

    // Один разговор на телефон: новый вытесняет прежний (так телефон, у которого
    // не поднялся WebRTC, может переподключиться по WebSocket).
    const entry = { close, startedAt: t };
    if (deviceId) {
      const prev = this.devices.get(deviceId);
      if (prev) {
        try { prev.close(); } catch { /* уже закрыт */ }
      }
      this.devices.set(deviceId, entry);
    }

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const spent = this.now() - t;
      if (ipEntry) {
        ipEntry.active = Math.max(0, ipEntry.active - 1);
        ipEntry.usedMs += spent;
      }
      if (deviceId && this.devices.get(deviceId) === entry) this.devices.delete(deviceId);
    };
    return { ok: true, release };
  }
}
