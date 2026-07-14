import WebSocket from 'ws';
import { config } from './config.js';

// Протокол по документации OpenAI (developers.openai.com/api/docs/guides/
// realtime-websocket и .../realtime-conversations). turn_detection и
// точный формат session.audio.output стоит перепроверить по первому
// реальному session.updated — это ещё не гонялось живьём, ключа пока нет.
export function openRealtimeSession({ instructions, onAudioDelta, onEvent, onClose }) {
  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(config.openaiModel)}`;
  const ws = new WebSocket(url, {
    headers: { Authorization: `Bearer ${config.openaiApiKey}` },
  });

  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions,
        voice: config.openaiVoice,
        audio: {
          input: { format: { type: 'audio/pcm', rate: 24000 } },
          output: { format: { type: 'audio/pcm', rate: 24000 } },
        },
        turn_detection: { type: 'server_vad' },
      },
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
