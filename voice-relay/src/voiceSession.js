import { buildSessionContext } from './context.js';
import { openRealtimeSession } from './openaiRealtime.js';

// Этап 1: только голос. Гость шлёт {type:'audio', data:<base64 pcm16/24k>},
// получает то же самое обратно. Синхронизация с экраном (показ блюд,
// корзина) — через tool calls у OpenAI, следующий этап, здесь ещё нет.
export async function voiceRoutes(app) {
  app.get('/voice', { websocket: true }, async (guestSocket, req) => {
    const { guestId, restaurantId } = req.query;
    app.log.info({ guestId, restaurantId }, 'голосовая сессия гостя открыта');

    let openaiSession = null;

    try {
      const { instructions } = await buildSessionContext({ guestId, restaurantId });

      openaiSession = openRealtimeSession({
        instructions,
        onAudioDelta: (base64Audio) => {
          if (guestSocket.readyState === guestSocket.OPEN) {
            guestSocket.send(JSON.stringify({ type: 'audio', data: base64Audio }));
          }
        },
        onEvent: (event) => {
          if (event.type === 'relay.error' || event.type === 'error') {
            app.log.error(event, 'realtime session error');
          }
        },
        onClose: () => guestSocket.close(),
      });
    } catch (err) {
      app.log.error(err, 'не удалось открыть голосовую сессию');
      guestSocket.close();
      return;
    }

    guestSocket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'audio' && msg.data) {
        openaiSession.sendAudio(msg.data);
      }
    });

    guestSocket.on('close', () => openaiSession?.close());
  });
}
