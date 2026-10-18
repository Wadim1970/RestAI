import 'dotenv/config';

function list(value) {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT || 8081),
  corsOrigin: list(process.env.CORS_ORIGIN),

  // Какой провайдер обслуживает /voice — переключается целиком через .env
  // (перезапуск pm2), без разделения по сессиям. См. voiceProvider в README.
  voiceProvider: process.env.VOICE_PROVIDER || 'openai',

  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime',
  openaiVoice: process.env.OPENAI_REALTIME_VOICE || 'alloy',

  // --- OpenAI GPT-Live-1 (VOICE_PROVIDER=gptlive; эндпоинт v1/live/sessions) ---
  // Тот же OPENAI_API_KEY. gptLiveBackendModel — бэкенд-модель делегирования
  // (рассуждения/инструменты); точный доступный id уточните в своём аккаунте
  // OpenAI и при необходимости переопределите через .env.
  gptLiveModel: process.env.OPENAI_LIVE_MODEL || 'gpt-live-1',
  gptLiveVoice: process.env.OPENAI_LIVE_VOICE || 'marin',
  gptLiveBackendModel: process.env.OPENAI_LIVE_BACKEND_MODEL || 'gpt-5.6-terra',
  // Подталкивать ли первое приветствие response.create'ом (=0 отключает, если
  // GPT-Live здоровается сам и выходит двойное приветствие).
  gptLiveNudgeGreeting: process.env.GPTLIVE_NUDGE_GREETING !== '0',
  // Адрес создания сессии GPT-Live по WebRTC (переопределяется только в тестах).
  gptLiveSessionsUrl: process.env.OPENAI_LIVE_SESSIONS_URL || 'https://api.openai.com/v1/live/sessions',
  // =1 — пока у гостя играет голос ИИ, вместо микрофона шлём тишину (защита
  // от эха: модель не слышит саму себя из динамика и не обрывает ответ).
  // Цена — гость не может перебить ИИ голосом. Для проверки, по умолчанию выкл.
  // Только для запасного WebSocket-пути: в WebRTC эхо гасит сам браузер.
  muteMicWhileSpeaking: process.env.MUTE_MIC_WHILE_AI_SPEAKS === '1',

  // --- WebRTC (основной путь для gptlive): телефон ⇄ relay ⇄ GPT-Live ---
  // =0 — выключить и пускать всех по WebSocket (как раньше).
  webrtcEnabled: process.env.WEBRTC_ENABLED !== '0',
  // UDP-порты, на которых relay принимает звук гостей (по одному на
  // разговор и ещё по одному на ногу к OpenAI). Их нужно открыть на входящие
  // в файрволе хостинга.
  webrtcPortMin: Number(process.env.WEBRTC_PORT_MIN || 40000),
  webrtcPortMax: Number(process.env.WEBRTC_PORT_MAX || 40199),
  // Публичный IP сервера — только если он НЕ виден на сетевом интерфейсе
  // (сервер за NAT хостинга). Тогда relay подставит его в свои кандидаты.
  webrtcPublicIp: process.env.WEBRTC_PUBLIC_IP || '',
  // TURN (coturn) для гостей, у которых мобильная сеть режет UDP: адреса через
  // запятую и общий секрет (use-auth-secret в coturn). Пусто — без TURN.
  turnUrls: list(process.env.TURN_URLS),
  turnSecret: process.env.TURN_SECRET || '',

  grokApiKey: process.env.GROK_API_KEY || '',
  grokVoiceModel: process.env.GROK_VOICE_MODEL || 'grok-voice-latest',
  grokVoice: process.env.GROK_VOICE || 'eve',

  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',

  menuApiBaseUrl: process.env.MENU_API_BASE_URL || 'https://guest.restai.pro',
  waiterApiUrl: process.env.WAITER_API_URL || '',

  maxConcurrentSessions: Number(process.env.MAX_CONCURRENT_SESSIONS || 15),
};
