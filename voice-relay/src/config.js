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

  grokApiKey: process.env.GROK_API_KEY || '',
  grokVoiceModel: process.env.GROK_VOICE_MODEL || 'grok-voice-latest',
  grokVoice: process.env.GROK_VOICE || 'eve',

  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',

  menuApiBaseUrl: process.env.MENU_API_BASE_URL || 'https://guest.restai.pro',
  waiterApiUrl: process.env.WAITER_API_URL || '',

  maxConcurrentSessions: Number(process.env.MAX_CONCURRENT_SESSIONS || 15),
};
