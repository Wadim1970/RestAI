import { buildSessionContext, lookupDishDetails, callWaiter, findDishesForDisplay, saveConversationTurn, getDishModifierGroups, resolveModifierSelections } from './context.js';
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
        'Вызывай его ПЕРВЫМ действием — ДО того, как назовёшь блюда вслух: карточки должны ' +
        'появиться на экране раньше твоей речи о блюдах, а не после. Вызывай каждый раз, когда ' +
        'собираешься назвать гостю конкретные блюда (рекомендация, перечисление, смена ' +
        'категории) — с полным списком этих блюд одним вызовом. Каждый вызов ПОЛНОСТЬЮ заменяет ' +
        'то, что было на экране, поэтому при смене темы просто вызови снова с новыми блюдами. ' +
        'Показать одно блюдо — тоже через этот инструмент, список из одного названия.',
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
    {
      name: 'get_dish_modifiers',
      description:
        'Возвращает опции (модификаторы) блюда: группы вроде «Прожарка», «Соус», «Гарнир» с ' +
        'вариантами и наценкой. Вызывай для блюда, у которого в меню помечено «выбор опций», ' +
        'ПРЕЖДЕ чем класть его в корзину, чтобы спросить у гостя выбор по каждой группе. Если у ' +
        'блюда опций нет — вернётся пустой список, тогда добавляй блюдо как обычно.',
      parameters: {
        type: 'object',
        properties: {
          dish_name: { type: 'string', description: 'Название блюда, как в меню / как назвал гость.' },
        },
        required: ['dish_name'],
      },
      execute: async ({ dish_name }) => {
        const groups = await getDishModifierGroups(restaurantId, dish_name);
        return {
          dish_name,
          groups: groups.map((g) => ({
            group: g.name,
            required: !!g.required,
            options: (g.options || []).map((o) =>
              Number(o.price_delta) ? `${o.name} (+${o.price_delta}₽)` : o.name
            ),
          })),
        };
      },
    },
    {
      name: 'add_to_cart',
      description:
        'Добавляет выбранные гостем блюда в его корзину в приложении (реально кладёт их туда, ' +
        'а не просто на словах). Вызывай, когда гость решил что-то заказать. Передавай название ' +
        'и количество каждого блюда, а если у гостя есть особые пожелания по блюду (убрать/добавить ' +
        'ингредиент, «без лука», «поострее», «кинзу убрать») — передавай их в поле comment. Само по ' +
        'себе НЕ отправляет заказ на кухню — только наполняет корзину; отправляет заказ сам гость ' +
        'кнопкой в корзине (см. show_cart).',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                dish_name: { type: 'string', description: 'Название блюда.' },
                quantity: { type: 'number', description: 'Сколько порций. По умолчанию 1.' },
                comment: { type: 'string', description: 'Особые пожелания гостя по этому блюду (убрать/добавить ингредиент, «без лука», «поострее»). Кратко, своими словами. Если пожеланий нет — не передавай это поле.' },
                modifiers: { type: 'array', items: { type: 'string' }, description: 'Выбранные гостем опции блюда по их названиям из get_dish_modifiers (напр. ["Medium", "Барбекю", "Картофель"]). Передавай, только если у блюда есть опции и гость выбрал.' },
              },
              required: ['dish_name'],
            },
            description: 'Блюда с количеством (и пожеланиями), которые гость хочет заказать.',
          },
        },
        required: ['items'],
      },
      execute: async ({ items }) => {
        const cartItems = [];
        const notFound = [];
        for (const it of items || []) {
          const matches = await findDishesForDisplay(restaurantId, [it.dish_name]);
          if (matches.length === 0) {
            notFound.push(it.dish_name);
            continue;
          }
          const dish = matches[0]; // берём первое совпадение — для заказа неоднозначность решает контекст беседы
          // Выбранные опции (прожарка/соус/…): резолвим названия в объекты
          // {id, name, price_delta} — id уедут в place_guest_order, name+delta
          // нужны корзине для показа и подсчёта наценки.
          const chosenMods = await resolveModifierSelections(restaurantId, dish.dish_name, it.modifiers);
          cartItems.push({
            id: dish.id,
            dish_name: dish.dish_name,
            cost_rub: dish.cost_rub,
            image_url: dish.image_url,
            image_url_thumbnail: dish.image_url_thumbnail,
            // Нужно корзине для подсчёта общей калорийности заказа
            // (nutritional_info.calories_kcal). Без этого блюда, добавленные
            // голосом, считались бы как 0 ккал.
            nutritional_info: dish.nutritional_info || null,
            // Особые пожелания гостя — уедут в order_items.comment при
            // отправке заказа (place_guest_order уже принимает per-item comment).
            comment: (it.comment && String(it.comment).trim()) || null,
            modifiers: chosenMods,
            quantity: Math.max(1, Math.round(Number(it.quantity) || 1)),
          });
        }
        if (cartItems.length > 0 && guestSocket.readyState === guestSocket.OPEN) {
          guestSocket.send(JSON.stringify({ type: 'cart_add', items: cartItems }));
        }
        return {
          added: cartItems.map((c) => {
            const mods = (c.modifiers || []).map((m) => m.name).join(', ');
            return `${c.dish_name} x${c.quantity}${mods ? ` [${mods}]` : ''}${c.comment ? ` (${c.comment})` : ''}`;
          }),
          not_found: notFound,
        };
      },
    },
    {
      name: 'show_cart',
      description:
        'Показывает гостю на экране его корзину со всеми добавленными блюдами и кнопкой ' +
        '«Отправить заказ». Вызывай СРАЗУ, как только гость просит показать корзину или свой ' +
        'заказ — в любой формулировке, включая искажённые распознаванием («корзину», «карзину», ' +
        '«кардину», «покажи заказ», «что я заказал»). Также вызывай в конце выбора: сначала ' +
        'вслух подытожь заказ (перечисли блюда и количество), затем открой корзину и скажи, что ' +
        'если всё верно — гость может сам отправить заказ на кухню кнопкой «Отправить заказ».',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        if (guestSocket.readyState === guestSocket.OPEN) {
          guestSocket.send(JSON.stringify({ type: 'show_cart' }));
        }
        return { success: true };
      },
    },
    {
      name: 'hide_cart',
      description:
        'Убирает (закрывает) корзину с экрана гостя. Вызывай СРАЗУ, как только гость просит ' +
        'убрать / закрыть / свернуть / спрятать корзину — в любой формулировке, включая ' +
        'искажённые распознаванием («убери корзину», «закрой корзину», «убери карзину», ' +
        '«спрячь заказ», «корзину убери»). Не путай с hide_dish_card — та убирает карточки ' +
        'блюд, а эта именно корзину.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        if (guestSocket.readyState === guestSocket.OPEN) {
          guestSocket.send(JSON.stringify({ type: 'hide_cart' }));
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

    const { guestId, restaurantId, tableNumber, sessionId } = req.query;
    // Прогрев голоса под видео-заставкой: сессия конфигурируется сразу, а
    // приветствие ждёт сигнала start_greeting (когда заставка закончилась).
    const deferGreeting = req.query.deferGreeting === '1';

    activeSessions += 1;
    app.log.info({ guestId, restaurantId, sessionId, activeSessions }, 'голосовая сессия гостя открыта');

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
      const { instructions, voice, hasHistory } = await buildSessionContext({ guestId, restaurantId, sessionId });

      openaiSession = openRealtimeSession({
        instructions,
        voice,
        hasHistory,
        deferGreeting,
        tools: buildTools(restaurantId, tableNumber, guestSocket),
        onAudioDelta: (base64Audio) => {
          if (guestSocket.readyState === guestSocket.OPEN) {
            guestSocket.send(JSON.stringify({ type: 'audio', data: base64Audio }));
          }
        },
        onEvent: (event) => {
          if (event.type === 'relay.error' || event.type === 'error') {
            app.log.error(event, 'realtime session error');
          } else if (event.type === 'user.transcript') {
            app.log.info({ guestId, restaurantId, text: event.text }, 'гость сказал');
            // Реплика гостя из голоса — в общую историю, чтобы текстовый
            // режим видел, что именно гость спрашивал/выбирал голосом.
            saveConversationTurn({
              sessionId, restaurantId, guestId,
              role: 'user', content: event.text, source: 'voice',
            }).catch((e) => app.log.error(e, 'не удалось записать реплику гостя в историю'));
          } else if (event.type === 'response.transcript') {
            app.log.info({ guestId, restaurantId, text: event.text }, 'ИИ сказал');
            // Пишем реплику ИИ в общую историю — чтобы текстовый режим
            // (и следующая голосовая сессия) видели, что уже было сказано.
            // Best-effort: сбой записи не должен ронять разговор.
            saveConversationTurn({
              sessionId, restaurantId, guestId,
              role: 'assistant', content: event.text, source: 'voice',
            }).catch((e) => app.log.error(e, 'не удалось записать реплику ИИ в историю'));
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
      } else if (msg.type === 'start_greeting') {
        // Заставка закончилась — можно здороваться (см. deferGreeting).
        openaiSession.startGreeting();
      }
    });

    guestSocket.on('close', () => {
      releaseSlot();
      openaiSession?.close();
    });
  });
}
