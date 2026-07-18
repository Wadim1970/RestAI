import WebSocket from 'ws';
import { config } from './config.js';

// Оба провайдера торгуются по протоколу OpenAI Realtime API (у xAI это
// заявленная совместимость — https://docs.x.ai/developers/model-capabilities/audio/voice-agent),
// но расходятся в форме session.update: OpenAI держит voice/turn_detection
// внутри audio.output/audio.input, а Grok — на верхнем уровне session.
// Поэтому провайдер описывает только url/заголовки/форму session-пейлоада,
// а весь остальной жизненный цикл сокета (события, ошибки, sendAudio/close) общий.
function toolDefinitions(tools) {
  return (tools || []).map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

const PROVIDERS = {
  openai: {
    url: () => `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(config.openaiModel)}`,
    headers: () => ({ Authorization: `Bearer ${config.openaiApiKey}` }),
    sessionPayload: (instructions, voice, tools) => ({
      type: 'realtime',
      instructions,
      tools: toolDefinitions(tools),
      tool_choice: 'auto',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          turn_detection: { type: 'server_vad' },
          transcription: { model: 'whisper-1' }, // распознавание речи гостя, см. grok-ветку
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
    sessionPayload: (instructions, voice, tools) => ({
      voice: voice || config.grokVoice,
      instructions,
      tools: toolDefinitions(tools),
      tool_choice: 'auto',
      turn_detection: { type: 'server_vad' },
      audio: {
        // transcription.model включает распознавание речи ГОСТЯ — без него
        // Grok не шлёт conversation.item.input_audio_transcription.* и в
        // общую историю попадают только реплики ИИ, но не гостя.
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model: 'grok-transcribe' },
        },
        output: { format: { type: 'audio/pcm', rate: 24000 } },
      },
    }),
  },
};

// Гость спрашивает что-то, для чего у модели нет данных в промте (состав
// блюда и т.п.) — модель просит вызвать функцию, мы её выполняем и кладём
// результат обратно в разговор. Один "запрос" гостя закрывается двумя
// проходами response.done: сначала прилетает function_call вместо речи,
// после отправки результата — уже обычный ответ с аудио.
async function handleFunctionCalls(ws, tools, output, onEvent) {
  const calls = (output || []).filter((item) => item.type === 'function_call');
  if (calls.length === 0) return false;

  for (const call of calls) {
    const tool = tools.find((t) => t.name === call.name);
    let args = {};
    let result;
    try {
      args = call.arguments ? JSON.parse(call.arguments) : {};
      result = tool ? await tool.execute(args) : { error: `неизвестный инструмент ${call.name}` };
    } catch (err) {
      result = { error: String(err) };
    }

    onEvent?.({ type: 'tool.called', name: call.name, args, result });

    ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result),
      },
    }));
  }

  ws.send(JSON.stringify({ type: 'response.create' }));
  return true;
}

export function openRealtimeSession({ instructions, voice, tools = [], hasHistory = false, onAudioDelta, onEvent, onClose }) {
  const provider = PROVIDERS[config.voiceProvider] || PROVIDERS.openai;
  const ws = new WebSocket(provider.url(), { headers: provider.headers() });

  // Распознавание речи гостя приходит кумулятивно (событие ...updated
  // повторяется, каждый раз с более полным текстом, у Grok финального
  // .completed может не быть). Копим последний текст, а фиксируем реплику
  // гостя в историю в момент, когда ИИ начинает отвечать (response.done) —
  // значит гость договорил и транскрипт уже финальный.
  let pendingUserTranscript = '';

  const flushUserTranscript = () => {
    const text = pendingUserTranscript.trim();
    pendingUserTranscript = '';
    if (text) onEvent?.({ type: 'user.transcript', text });
  };

  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: 'session.update',
      session: provider.sessionPayload(instructions, voice, tools),
    }));
  });

  ws.on('message', async (raw) => {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (event.type === 'session.updated') {
      // Сессия сконфигурирована. Приветствуем первым ТОЛЬКО если разговор
      // ещё не начинался (пустая история). Если гость уже общался в этот
      // визит (в тексте или голосе) — не здороваемся заново, а ждём его
      // реплику: промпт уже содержит историю и указание продолжать.
      if (!hasHistory) {
        ws.send(JSON.stringify({ type: 'response.create' }));
      }
    } else if (
      event.type === 'conversation.item.input_audio_transcription.updated' ||
      event.type === 'conversation.item.input_audio_transcription.completed'
    ) {
      // Grok шлёт транскрипт кумулятивно и повторяет .completed на каждом
      // шаге (не как единичный финал) — поэтому НЕ фиксируем здесь, только
      // запоминаем последнюю версию. Реплику в историю кладём один раз,
      // когда ИИ начинает отвечать (response.done ниже) — гость договорил.
      if (event.transcript) pendingUserTranscript = event.transcript;
    } else if (event.type === 'response.output_audio.delta' && event.delta) {
      onAudioDelta(event.delta);
    } else if (event.type === 'response.done') {
      // Гость договорил, ИИ отвечает — фиксируем реплику гостя ДО реплики
      // ИИ, чтобы в истории они легли в правильном хронологическом порядке.
      flushUserTranscript();

      try {
        const calledTool = await handleFunctionCalls(ws, tools, event.response?.output, onEvent);
        if (calledTool) return; // речь пойдёт вторым response.done, после ответа функции
      } catch (err) {
        onEvent?.({ type: 'relay.error', error: String(err) });
      }

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

  ws.on('close', () => {
    // Последняя реплика гостя перед закрытием (например, «всё, спасибо»)
    // могла не успеть попасть на response.done — фиксируем её здесь.
    flushUserTranscript();
    onClose?.();
  });
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
