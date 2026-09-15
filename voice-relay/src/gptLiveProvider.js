import WebSocket from 'ws';
import { config } from './config.js';

// Провайдер под OpenAI GPT-Live-1 (эндпоинт v1/live/sessions) — ОТДЕЛЬНЫЙ
// протокол от Realtime API (realtimeProvider.js), поэтому отдельный файл, а не
// ветка в PROVIDERS. Интерфейс наружу тот же, что у openRealtimeSession
// ({ startGreeting, sendAudio, close } + onAudioDelta/onEvent/onClose), поэтому
// voiceSession.js остаётся без изменений — выбор делает voiceProvider.js.
//
// Ключевое отличие GPT-Live: полный дуплекс (модель сама решает, когда слушать
// и когда говорить), а «думание» и инструменты ДЕЛЕГИРУЮТСЯ бэкенд-модели
// (delegation: responses). Наши функции (call_waiter, меню) объявляем в
// delegation.responses.tools; их вызовы прилетают через response.event и
// исполняются ЗДЕСЬ (в релее), результат возвращаем response.item.create.
//
// Протокол собран по докам OpenAI (developers.openai.com/api/docs/guides/live*,
// сентябрь 2026). Пара мест помечена как «проверить вживую» — их точную форму
// доки раскрывают неполно; вынес в конфиг-флаги, чтобы подкрутить без правок.

const LIVE_URL = 'wss://api.openai.com/v1/live/sessions';

// Инструменты в формате делегирования Responses: {type:'function', function:{…}}
// (вложенная форма, в отличие от плоской у Realtime API).
function toolDefinitions(tools) {
  return (tools || []).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function openGptLiveSession({
  instructions, voice, tools = [], hasHistory = false, deferGreeting = false,
  onAudioDelta, onEvent, onClose,
}) {
  const ws = new WebSocket(LIVE_URL, { headers: { Authorization: `Bearer ${config.openaiApiKey}` } });

  let seq = 0;
  const nextId = (p) => `${p}_${++seq}`;

  let opened = false;
  let started = false;
  // Прогрев под видео-заставкой: сокет открываем сразу, но при deferGreeting
  // саму session.start (после неё GPT-Live может заговорить) держим до сигнала
  // start_greeting — чтобы ИИ не заговорил поверх заставки.
  let startRequested = !deferGreeting;

  const startSession = () => {
    if (started || ws.readyState !== WebSocket.OPEN) return;
    started = true;
    ws.send(JSON.stringify({
      type: 'session.start',
      event_id: 'session_start',
      session: {
        model: config.gptLiveModel,
        instructions,
        audio: {
          format: { type: 'audio/pcm', rate: 24000 },
          output: { voice: voice || config.gptLiveVoice },
        },
        delegation: {
          type: 'responses',
          responses: {
            model: config.gptLiveBackendModel,
            instructions,
            tools: toolDefinitions(tools),
            tool_choice: 'auto',
          },
        },
      },
    }));
  };
  const maybeStart = () => { if (opened && startRequested) startSession(); };

  // Транскрипты приходят дельтами — копим и фиксируем реплику на *.done. Гостя
  // фиксируем и в момент, когда ИИ начинает отвечать (см. output_transcript),
  // чтобы в истории реплики легли в правильном порядке.
  let userT = '';
  let asstT = '';
  const flushUser = () => { const t = userT.trim(); userT = ''; if (t) onEvent?.({ type: 'user.transcript', text: t }); };
  const flushAsst = () => { const t = asstT.trim(); asstT = ''; if (t) onEvent?.({ type: 'response.transcript', text: t }); };

  ws.on('open', () => { opened = true; maybeStart(); });

  async function runTool(item) {
    const tool = tools.find((t) => t.name === item.name);
    let args = {};
    let result;
    try {
      args = item.arguments ? JSON.parse(item.arguments) : {};
      result = tool ? await tool.execute(args) : { error: `неизвестный инструмент ${item.name}` };
    } catch (err) {
      result = { error: String(err) };
    }
    onEvent?.({ type: 'tool.called', name: item.name, args, result });
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'response.item.create',
      event_id: nextId('tool_result'),
      item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(result) },
    }));
    ws.send(JSON.stringify({ type: 'response.create', event_id: nextId('continue') }));
  }

  // Вызов функции может прийти обёрнутым (response.event → output_item.done)
  // либо напрямую — поддерживаем оба варианта.
  function extractFunctionCall(event) {
    if (event.type === 'response.event' && event.event?.type === 'response.output_item.done') {
      const item = event.event.item;
      if (item?.type === 'function_call') return item;
    }
    if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
      return event.item;
    }
    return null;
  }

  ws.on('message', async (raw) => {
    let event;
    try { event = JSON.parse(raw.toString()); } catch { return; }

    if (event.type === 'session.started') {
      // Свежий разговор → подтолкнуть приветствие (первая реплика без входного
      // аудио). Если GPT-Live здоровается сам и выходит ДВОЙНОЕ приветствие —
      // выключите GPTLIVE_NUDGE_GREETING=0 (проверить вживую).
      if (!hasHistory && config.gptLiveNudgeGreeting && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'response.create', event_id: nextId('greet') }));
      }
    } else if (event.type === 'session.output_audio.delta') {
      if (event.delta) onAudioDelta(event.delta);
    } else if (event.type === 'session.input_transcript.delta') {
      if (event.delta) userT += event.delta;
    } else if (event.type === 'session.input_transcript.done') {
      flushUser();
    } else if (event.type === 'session.output_transcript.delta') {
      if (userT.trim()) flushUser(); // гость договорил — его реплику фиксируем первой
      if (event.delta) asstT += event.delta;
    } else if (event.type === 'session.output_transcript.done') {
      flushAsst();
    } else if (event.type === 'error') {
      onEvent?.({ type: 'relay.error', error: event.error?.message || JSON.stringify(event) });
    } else {
      const fc = extractFunctionCall(event);
      if (fc) {
        try { await runTool(fc); }
        catch (err) { onEvent?.({ type: 'relay.error', error: String(err) }); }
      }
    }

    onEvent?.(event);
  });

  ws.on('close', () => { flushUser(); flushAsst(); onClose?.(); });
  ws.on('error', (err) => onEvent?.({ type: 'relay.error', error: String(err) }));

  return {
    startGreeting() { startRequested = true; maybeStart(); },
    sendAudio(base64Audio) {
      // До session.start (прогрев под заставкой) аудио гостя нет — молча роняем.
      if (ws.readyState !== WebSocket.OPEN || !started) return;
      ws.send(JSON.stringify({ type: 'session.input_audio.append', audio: base64Audio }));
    },
    close() { if (ws.readyState === WebSocket.OPEN) ws.close(); },
  };
}
