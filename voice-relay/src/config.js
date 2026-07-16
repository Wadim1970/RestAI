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

  grokApiKey: process.env.GROK_API_KEY || '',
  grokVoiceModel: process.env.GROK_VOICE_MODEL || 'grok-voice-latest',
  grokVoice: process.env.GROK_VOICE || 'eve',

  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',

  menuApiBaseUrl: process.env.MENU_API_BASE_URL || 'https://guest.restai.pro',

  maxConcurrentSessions: Number(process.env.MAX_CONCURRENT_SESSIONS || 15),
};
