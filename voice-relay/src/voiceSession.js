import { buildSessionContext, lookupDishDetails } from './context.js';
import { openRealtimeSession } from './realtimeProvider.js';
import { config } from './config.js';

// Единственный инструмент на сейчас: подробности блюда по требованию
// (см. lookupDishDetails в context.js — зачем он отдельно от общего
// списка меню в промте). Показ блюд/корзины на экране во время
// разговора — не реализовано, это отдельная, более крупная задача.
function buildTools(restaurantId) {
  return [
    {
      name: 'get_dish_details',
      description:
        'Ищет блюдо в меню ресторана по названию и возвращает состав, описание, вес и ' +
        'пищевую ценность — то, чего нет в кратком списке меню. Используй, когда гость ' +
        'спрашивает про состав, ингредиенты, из чего сделано блюдо, или просит подробное ' +
        'описание. Если пришло несколько похожих вариантов — уточни у гостя, какой именно ' +
        'он имеет в виду, и вызови инструмент снова с точным названием.',
      parameters: {
        type: 'object',
        properties: {
          dish_name: {
            type: 'string',
            description: 'Название блюда, как его назвал гость — не обязательно точно как в меню.',
          },
        },
        required: ['dish_name'],
      },
      execute: async ({ dish_name }) => lookupDishDetails(restaurantId, dish_name),
    },
  ];
}

// Пока нет очереди/горизонтального масштабирования — не даём числу
// разговоров превысить то, что реально потянет аккаунт OpenAI (см.
// MAX_CONCURRENT_SESSIONS в .env.example). Гостю сверх лимита — понятный
// отказ ДО похода в Supabase/OpenAI, а не обрыв где-то в середине разговора.
let activeSessions = 0;

export function getActiveSessionCount() {
  return activeSessions;
}

// Этап 1: только голос. Гость шлёт {type:'audio', data:<base64 pcm16/24k>},
// получает то же самое обратно, плюс один tool call на подробности блюда
// (см. buildTools). Синхронизация с экраном (показ блюд, корзина) во
// время разговора — следующий, более крупный этап, здесь ещё нет.
export async function voiceRoutes(app) {
  app.get('/voice', { websocket: true }, async (guestSocket, req) => {
    if (activeSessions >= config.maxConcurrentSessions) {
      app.log.warn({ activeSessions, max: config.maxConcurrentSessions }, 'лимит одновременных голосовых сессий достигнут');
      guestSocket.send(JSON.stringify({
        type: 'error',
        code: 'busy',
        message: 'Сейчас все голосовые линии заняты, попробуйте через минуту.',
      }));
      guestSocket.close();
      return;
    }

    const { guestId, restaurantId } = req.query;

    activeSessions += 1;
    app.log.info({ guestId, restaurantId, activeSessions }, 'голосовая сессия гостя открыта');

    // На случай, если гость и OpenAI-нога закроются почти одновременно —
    // слот освобождается ровно один раз, кто бы ни закрылся первым.
    let released = false;
    const releaseSlot = () => {
      if (released) return;
      released = true;
      activeSessions = Math.max(0, activeSessions - 1);
    };

    let openaiSession = null;

    try {
      const { instructions, voice } = await buildSessionContext({ guestId, restaurantId });

      openaiSession = openRealtimeSession({
        instructions,
        voice,
        tools: buildTools(restaurantId),
        onAudioDelta: (base64Audio) => {
          if (guestSocket.readyState === guestSocket.OPEN) {
            guestSocket.send(JSON.stringify({ type: 'audio', data: base64Audio }));
          }
        },
        onEvent: (event) => {
          if (event.type === 'relay.error' || event.type === 'error') {
            app.log.error(event, 'realtime session error');
          } else if (event.type === 'response.transcript') {
            app.log.info({ guestId, restaurantId, text: event.text }, 'ИИ сказал');
          } else if (event.type === 'tool.called') {
            app.log.info({ guestId, restaurantId, name: event.name, args: event.args, result: event.result }, 'ИИ вызвал инструмент');
          }
        },
        onClose: () => {
          releaseSlot();
          guestSocket.close();
        },
      });
    } catch (err) {
      app.log.error(err, 'не удалось открыть голосовую сессию');
      releaseSlot();
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

    guestSocket.on('close', () => {
      releaseSlot();
      openaiSession?.close();
    });
  });
}
