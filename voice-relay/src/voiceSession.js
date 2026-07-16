import { buildSessionContext, lookupDishDetails, callWaiter, findDishesForDisplay } from './context.js';
import { openRealtimeSession } from './realtimeProvider.js';
import { config } from './config.js';

// show_dish_card/hide_dish_card — единственные инструменты, которые
// шлют что-то ГОСТЮ напрямую (guestSocket), в обход ответа модели: тут
// же, в closure, а не через realtimeProvider.js — тот знает только про
// его собственный сокет к OpenAI/Grok, не про сокет гостя.
// Добавление в корзину и отправка заказа на кухню — отдельная, более
// крупная задача, этот канал для неё уже пригодится.
function buildTools(restaurantId, tableNumber, guestSocket) {
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
    {
      name: 'call_waiter',
      description:
        'Зовёт официанта к столу гостя — то же самое действие, что кнопка с колокольчиком в ' +
        'приложении. Используй, когда гость прямо просит позвать/пригласить официанта. Причину ' +
        'передавай, только если гость сам её назвал (например "убрать посуду", "принести ' +
        'приборы") — не выдумывай и не уточняй специально.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Причина вызова со слов гостя, если она была. Необязательно.',
          },
        },
      },
      execute: async ({ reason } = {}) => callWaiter(restaurantId, tableNumber, reason),
    },
    {
      name: 'show_dish_card',
      description:
        'Показывает гостю на экране слайдер с фото названных блюд (цена и вес на карточке). ' +
        'Вызывай каждый раз, когда называешь гостю конкретные блюда — с полным списком этих ' +
        'блюд. Каждый вызов ПОЛНОСТЬЮ заменяет то, что было на экране до этого, поэтому при ' +
        'смене темы просто вызови снова с новыми блюдами. Показать одно блюдо — тоже через ' +
        'этот инструмент, просто список из одного названия.',
      parameters: {
        type: 'object',
        properties: {
          dish_names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Названия блюд для показа, как ты их назвал гостю. Одно или несколько.',
          },
        },
        required: ['dish_names'],
      },
      execute: async ({ dish_names }) => {
        const dishes = await findDishesForDisplay(restaurantId, dish_names);
        if (guestSocket.readyState === guestSocket.OPEN) {
          // Всегда шлём — пустой массив тоже валиден (ничего не нашли —
          // слайдер очистится, а не застрянет со старым набором).
          guestSocket.send(JSON.stringify({ type: 'show_dish', dishes }));
        }
        return { shown: dishes.map((d) => d.dish_name) };
      },
    },
    {
      name: 'hide_dish_card',
      description:
        'Убирает с экрана гостя слайдер с карточками блюд. Нужен, только когда разговор уходит ' +
        'от еды. При смене одних блюд на другие звать НЕ нужно — просто вызови show_dish_card ' +
        'с новыми блюдами, он сам заменит старые.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        if (guestSocket.readyState === guestSocket.OPEN) {
          guestSocket.send(JSON.stringify({ type: 'hide_dish' }));
        }
        return { success: true };
      },
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

    const { guestId, restaurantId, tableNumber } = req.query;

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
        tools: buildTools(restaurantId, tableNumber, guestSocket),
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
