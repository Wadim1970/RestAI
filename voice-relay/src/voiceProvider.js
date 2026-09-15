import { config } from './config.js';
import { openRealtimeSession } from './realtimeProvider.js';
import { openGptLiveSession } from './gptLiveProvider.js';

// Единая точка выбора голосового провайдера по VOICE_PROVIDER:
//   • gptlive        → OpenAI GPT-Live-1 (v1/live/sessions, делегирование);
//   • openai | grok  → OpenAI/xAI Realtime API (v1/realtime).
// Интерфейс у обоих одинаковый, поэтому voiceSession.js не знает, кто внутри.
export function openVoiceSession(opts) {
  return config.voiceProvider === 'gptlive'
    ? openGptLiveSession(opts)
    : openRealtimeSession(opts);
}
