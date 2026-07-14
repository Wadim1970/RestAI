import WebSocket from 'ws';
import { config } from './config.js';

// Протокол по developers.openai.com/api/reference/resources/realtime/
// client-events — voice и turn_detection живут не там, где в первой версии
// (voice под audio.output, turn_detection под audio.input), поправлено по
// факту реальной ошибки "Unknown parameter: 'session.voice'" при живом тесте.
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
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            turn_detection: { type: 'server_vad' },
          },
          output: {
            format: { type: 'audio/pcm', rate: 24000 },
            voice: config.openaiVoice,
          },
        },
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
