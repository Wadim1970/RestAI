import WebSocket from 'ws';
import { config } from './config.js';
import { createLiveEventHandler, liveSessionConfig } from './gptLiveEvents.js';

// Провайдер под OpenAI GPT-Live-1 (эндпоинт v1/live/sessions) по WebSocket —
// ОТДЕЛЬНЫЙ протокол от Realtime API (realtimeProvider.js), поэтому отдельный
// файл, а не ветка в PROVIDERS. Интерфейс наружу тот же, что у
// openRealtimeSession ({ startGreeting, sendAudio, close } +
// onAudioDelta/onEvent/onClose), поэтому voiceSession.js не знает, кто внутри.
//
// Основной путь теперь WebRTC (gptLiveWebrtc.js): там звук идёт живым потоком,
// и перебивание работает как в приложении OpenAI. Этот WebSocket-вариант —
// запасной, когда WebRTC у гостя не соединился (браузер/сеть).
//
// Ключевое отличие GPT-Live: полный дуплекс (модель сама решает, когда слушать
// и когда говорить), а «думание» и инструменты ДЕЛЕГИРУЮТСЯ бэкенд-модели
// (delegation: responses). Наши функции (call_waiter, меню) объявляем в
// delegation.responses.tools; их вызовы прилетают через response.event и
// исполняются ЗДЕСЬ (в релее), результат возвращаем response.item.create —
// всё это в gptLiveEvents.js, общее с WebRTC.
//
// Протокол собран по докам OpenAI (developers.openai.com/api/docs/guides/live*,
// сентябрь 2026).

const LIVE_URL = 'wss://api.openai.com/v1/live/sessions';

export function openGptLiveSession({
  instructions, voice, tools = [], hasHistory = false, deferGreeting = false,
  onAudioDelta, onEvent, onClose,
}) {
  const ws = new WebSocket(LIVE_URL, { headers: { Authorization: `Bearer ${config.openaiApiKey}` } });

  const send = (obj) => {
    if (ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(obj));
    return true;
  };
  const handler = createLiveEventHandler({ tools, hasHistory, send, onEvent, onAudioDelta });

  let opened = false;
  let started = false;
  // Прогрев под видео-заставкой: сокет открываем сразу, но при deferGreeting
  // саму session.start (после неё GPT-Live может заговорить) держим до сигнала
  // start_greeting — чтобы ИИ не заговорил поверх заставки.
  let startRequested = !deferGreeting;

  const startSession = () => {
    if (started || ws.readyState !== WebSocket.OPEN) return;
    started = true;
    send({
      type: 'session.start',
      event_id: 'session_start',
      session: liveSessionConfig({
        instructions, voice, tools,
        audioFormat: { type: 'audio/pcm', rate: 24000 },
      }),
    });
  };
  const maybeStart = () => { if (opened && startRequested) startSession(); };

  ws.on('open', () => { opened = true; maybeStart(); });

  ws.on('message', (raw) => {
    let event;
    try { event = JSON.parse(raw.toString()); } catch { return; }
    handler.handle(event);
  });

  ws.on('close', () => { handler.flush(); onClose?.(); });
  ws.on('error', (err) => onEvent?.({ type: 'relay.error', error: String(err) }));

  return {
    startGreeting() { startRequested = true; maybeStart(); },
    sendAudio(base64Audio) {
      // До session.start (прогрев под заставкой) аудио гостя нет — молча роняем.
      if (!started) return;
      send({ type: 'session.input_audio.append', audio: base64Audio });
    },
    close() { if (ws.readyState === WebSocket.OPEN) ws.close(); },
  };
}
