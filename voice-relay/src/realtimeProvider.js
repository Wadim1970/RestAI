import WebSocket from 'ws';
import { config } from './config.js';

// Оба провайдера торгуются по протоколу OpenAI Realtime API (у xAI это
// заявленная совместимость — https://docs.x.ai/developers/model-capabilities/audio/voice-agent),
// но расходятся в форме session.update: OpenAI держит voice/turn_detection
// внутри audio.output/audio.input, а Grok — на верхнем уровне session.
// Поэтому провайдер описывает только url/заголовки/форму session-пейлоада,
// а весь остальной жизненный цикл сокета (события, ошибки, sendAudio/close) общий.
const PROVIDERS = {
  openai: {
    url: () => `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(config.openaiModel)}`,
    headers: () => ({ Authorization: `Bearer ${config.openaiApiKey}` }),
    sessionPayload: (instructions, voice) => ({
      type: 'realtime',
      instructions,
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          turn_detection: { type: 'server_vad' },
        },
        output: {
          format: { type: 'audio/pcm', rate: 24000 },
          voice: voice || config.openaiVoice,
        },
      },
    }),
  },
  grok: {
    url: () => `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(config.grokVoiceModel)}`,
    headers: () => ({ Authorization: `Bearer ${config.grokApiKey}` }),
    sessionPayload: (instructions, voice) => ({
      voice: voice || config.grokVoice,
      instructions,
      turn_detection: { type: 'server_vad' },
      audio: {
        input: { format: { type: 'audio/pcm', rate: 24000 } },
        output: { format: { type: 'audio/pcm', rate: 24000 } },
      },
    }),
  },
};

export function openRealtimeSession({ instructions, voice, onAudioDelta, onEvent, onClose }) {
  const provider = PROVIDERS[config.voiceProvider] || PROVIDERS.openai;
  const ws = new WebSocket(provider.url(), { headers: provider.headers() });

  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: 'session.update',
      session: provider.sessionPayload(instructions, voice),
    }));
  });

  ws.on('message', (raw) => {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (event.type === 'session.updated') {
      // Сессия сконфигурирована — просим ИИ поздороваться первым, та же
      // логика, что маркер "ПРИВЕТСТВИЕ" в текстовом чате (AIChatModal.jsx).
      ws.send(JSON.stringify({ type: 'response.create' }));
    } else if (event.type === 'response.output_audio.delta' && event.delta) {
      onAudioDelta(event.delta);
    } else if (event.type === 'response.done') {
      // Текстовая расшифровка того, что реально сказал ИИ — полезно для
      // отладки формулировок (характер/приветствие) без переслушивания звука.
      const transcript = (event.response?.output || [])
        .flatMap((item) => item.content || [])
        .map((c) => c.transcript)
        .filter(Boolean)
        .join(' ');
      if (transcript) onEvent?.({ type: 'response.transcript', text: transcript });
    }

    onEvent?.(event);
  });

  ws.on('close', () => onClose?.());
  ws.on('error', (err) => onEvent?.({ type: 'relay.error', error: String(err) }));

  return {
    sendAudio(base64Audio) {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64Audio }));
    },
    close() {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    },
  };
}
