import 'dotenv/config';

function list(value) {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT || 8081),
  corsOrigin: list(process.env.CORS_ORIGIN),

  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime',
  openaiVoice: process.env.OPENAI_REALTIME_VOICE || 'alloy',

  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',

  menuApiBaseUrl: process.env.MENU_API_BASE_URL || 'https://guest.restai.pro',
};
