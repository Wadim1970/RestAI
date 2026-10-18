import { config } from './config.js';

// Общая часть GPT-Live для обоих транспортов (WebSocket — gptLiveProvider.js,
// WebRTC — gptLiveWebrtc.js): события сессии одинаковые, разница только в
// том, как ходит звук. Здесь — транскрипты, приветствие и наши инструменты.

// Инструменты для делегирования responses — ПЛОСКАЯ форма Responses API:
// name/description/parameters на верхнем уровне (НЕ вложенные в function, как в
// Chat Completions). Иначе GPT-Live отбивает сессию с
// "Missing required parameter: session.delegation.responses.tools[0].name".
export function toolDefinitions(tools) {
  return (tools || []).map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

// Настройки сессии GPT-Live. audioFormat — только для WebSocket (PCM внутри
// JSON); в WebRTC формат звука согласует SDP, и поле передавать нельзя.
export function liveSessionConfig({ instructions, voice, tools, audioFormat }) {
  return {
    model: config.gptLiveModel,
    instructions,
    audio: {
      ...(audioFormat ? { format: audioFormat } : {}),
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
  };
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

// send(obj) → true, если событие ушло в GPT-Live (канал открыт).
// greetOnStart=false — приветствие не на session.started, а по вызову greet()
// (WebRTC: сессия поднимается заранее, под заставкой).
export function createLiveEventHandler({ tools = [], hasHistory = false, greetOnStart = true, send, onEvent, onAudioDelta }) {
  let seq = 0;
  const nextId = (p) => `${p}_${++seq}`;

  // Свежий разговор → подтолкнуть приветствие (первая реплика без входного
  // аудио). Если GPT-Live здоровается сам и выходит ДВОЙНОЕ приветствие —
  // выключите GPTLIVE_NUDGE_GREETING=0.
  let greeted = false;
  const greet = () => {
    if (greeted || hasHistory || !config.gptLiveNudgeGreeting) return false;
    greeted = true;
    return send({ type: 'response.create', event_id: nextId('greet') });
  };

  // Транскрипты приходят дельтами — копим и фиксируем реплику на *.done. Гостя
  // фиксируем и в момент, когда ИИ начинает отвечать (см. output_transcript),
  // чтобы в истории реплики легли в правильном порядке.
  let userT = '';
  let asstT = '';
  const flushUser = () => { const t = userT.trim(); userT = ''; if (t) onEvent?.({ type: 'user.transcript', text: t }); };
  const flushAsst = () => { const t = asstT.trim(); asstT = ''; if (t) onEvent?.({ type: 'response.transcript', text: t }); };

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
    const sent = send({
      type: 'response.item.create',
      event_id: nextId('tool_result'),
      item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(result) },
    });
    if (sent) send({ type: 'response.create', event_id: nextId('continue') });
  }

  async function handle(event) {
    if (event.type === 'session.started') {
      if (greetOnStart) greet();
    } else if (event.type === 'session.output_audio.delta') {
      if (event.delta) onAudioDelta?.(event.delta);
    } else if (event.type === 'session.input_transcript.delta') {
      if (event.delta) userT += event.delta;
    } else if (event.type === 'session.input_transcript.done') {
      flushUser();
      // Гость договорил — на телефоне бокал «думает», пока не пошёл ответ.
      onEvent?.({ type: 'user.turn_end' });
    } else if (event.type === 'session.output_transcript.delta') {
      if (userT.trim()) flushUser(); // гость договорил — его реплику фиксируем первой
      if (event.delta) {
        asstT += event.delta;
        // Ответ по мере произнесения — телефон определяет по нему, кто отвечает.
        onEvent?.({ type: 'response.transcript.delta', text: event.delta });
      }
    } else if (event.type === 'session.output_transcript.done') {
      flushAsst();
      onEvent?.({ type: 'response.transcript.end' });
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
  }

  return {
    handle,
    greet,
    nextId,
    flush() { flushUser(); flushAsst(); },
  };
}
