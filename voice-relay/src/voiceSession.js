import { buildSessionContext, lookupDishDetails, callWaiter, findDishesForDisplay, saveConversationTurn, getDishModifierGroups, resolveModifierSelections } from './context.js';
import { openVoiceSession } from './voiceProvider.js';
import { config } from './config.js';
import { pcm16DurationMs, pcm16Rms, pcm16Silence } from './audioStats.js';
import { openGptLiveWebrtcSession, guestIceServers } from './gptLiveWebrtc.js';
import { SessionGuard, originAllowed } from './guard.js';
import { consumeTicket } from './ticket.js';

// Замеры голоса (логи «задержка ответа», «ответ ИИ: поток звука»):
// ответ ИИ закончился, если звука нет столько после того, как он доиграл бы;
// микрофон гостя «звучит», если громкость куска выше порога (после AGC
// браузера речь ~0.05–0.3, тишина в зале ~0.005–0.02).
const REPLY_END_GAP_MS = 2000;
const AI_AUDIBLE_TAIL_MS = 600;
const GUEST_VOICE_RMS = 0.03;
// WebRTC: как часто писать в лог ровность потоков пакетов.
const FLOW_LOG_MS = 15000;

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
  const guard = new SessionGuard({
    perIpMax: config.maxSessionsPerIp,
    perIpPerMinute: config.maxNewSessionsPerIpPerMinute,
    perIpMinutesPerDay: config.maxMinutesPerIpPerDay,
    onWarn: (msg) => app.log.warn(msg),
  });

  app.get('/voice', { websocket: true }, async (guestSocket, req) => {
    const reject = (code, message) => {
      try { guestSocket.send(JSON.stringify({ type: 'error', code, message })); } catch { /* сокет уже закрыт */ }
      guestSocket.close();
    };

    // 1. Подключение должно идти с нашего сайта (если список задан).
    if (!originAllowed(req.headers.origin, config.allowedOrigins)) {
      app.log.warn({ origin: req.headers.origin, ip: req.ip }, 'голос: чужой Origin, отклонено');
      reject('forbidden', 'Подключение не разрешено.');
      return;
    }

    if (activeSessions >= config.maxConcurrentSessions) {
      app.log.warn({ activeSessions, max: config.maxConcurrentSessions }, 'лимит одновременных голосовых сессий достигнут');
      reject('busy', 'Сейчас все голосовые линии заняты, попробуйте через минуту.');
      return;
    }

    let { guestId, restaurantId, tableNumber, sessionId, deviceId } = req.query;

    // 2. Лимиты по IP и устройству (один разговор на телефон — новый вытесняет
    //    прежний, поэтому переход WebRTC → WebSocket у того же телефона проходит).
    const admitted = guard.open({
      ip: req.ip,
      deviceId,
      close: () => {
        try { guestSocket.send(JSON.stringify({ type: 'error', code: 'replaced', message: 'Разговор открыт на другом экране.' })); } catch { /* закрыт */ }
        guestSocket.close();
      },
    });
    if (!admitted.ok) {
      app.log.warn({ ip: req.ip, code: admitted.code }, 'голос: лимит подключений');
      reject(admitted.code, admitted.message);
      return;
    }
    guestSocket.once('close', admitted.release);

    // 3. Билет из базы (voice_ticket_issue): ресторан, стол и устройство берём
    //    из него, а не из ссылки. Если задан REQUIRE_TICKET=1 — без билета нельзя.
    if (req.query.ticket || config.requireTicket) {
      const t = await consumeTicket(req.query.ticket);
      if (!t) {
        app.log.warn({ ip: req.ip, hasTicket: Boolean(req.query.ticket) }, 'голос: билет не принят');
        reject('forbidden', 'Не удалось подтвердить стол. Отсканируйте QR-код на столе заново.');
        return;
      }
      restaurantId = t.restaurantId;
      tableNumber = t.tableNumber;
      deviceId = t.deviceId;
      if (guestSocket.readyState !== guestSocket.OPEN) return; // гость ушёл, пока проверяли
    }

    // Прогрев голоса под видео-заставкой: сессия конфигурируется сразу, а
    // приветствие ждёт сигнала start_greeting (когда заставка закончилась).
    const deferGreeting = req.query.deferGreeting === '1';
    // WebRTC (живой звук, мгновенное перебивание) — основной путь для GPT-Live;
    // WebSocket — запасной, если у гостя WebRTC не поднялся (телефон тогда
    // переподключается с transport=ws).
    const transport = req.query.transport === 'webrtc' && config.voiceProvider === 'gptlive' && config.webrtcEnabled
      ? 'webrtc'
      : 'ws';

    activeSessions += 1;
    app.log.info({ guestId, restaurantId, sessionId, activeSessions, transport }, 'голосовая сессия гостя открыта');

    // Потолок одного разговора: потом гость может начать новый (лимиты по IP
    // в guard.js не дадут переоткрывать без конца).
    let maxTimer = null;
    if (config.maxSessionMinutes > 0) {
      maxTimer = setTimeout(() => {
        app.log.info({ guestId, restaurantId }, 'голос: потолок времени разговора');
        try {
          guestSocket.send(JSON.stringify({ type: 'error', code: 'time_limit', message: 'Время разговора вышло. Нажмите, чтобы начать заново.' }));
        } catch { /* закрыт */ }
        guestSocket.close();
      }, config.maxSessionMinutes * 60_000);
    }

    // На случай, если гость и OpenAI-нога закроются почти одновременно —
    // слот освобождается ровно один раз, кто бы ни закрылся первым.
    let released = false;
    const releaseSlot = () => {
      if (released) return;
      released = true;
      activeSessions = Math.max(0, activeSessions - 1);
    };

    // Сообщения гостя, пришедшие, пока грузится контекст (WebRTC-offer
    // приходит сразу), — копим и разбираем, когда сессия ИИ создана.
    let openaiSession = null;
    const pendingGuestMessages = [];
    const toGuest = (msg) => {
      if (guestSocket.readyState === guestSocket.OPEN) guestSocket.send(JSON.stringify(msg));
    };

    // Когда гость договорил — для замера задержки ответа (см. noteAiAudio).
    let turnEndAt = 0;
    let lastTurnEndAt = 0;
    // Когда микрофон гостя последний раз звучал громче порога — второй замер
    // задержки, не зависящий от того, прислал ли провайдер «гость договорил».
    let lastGuestVoiceAt = 0;
    // Текущий ответ ИИ: сколько звука пришло и сколько телефон простоял бы
    // без звука, если бы играл куски сразу (= провалы в потоке от OpenAI).
    // В WebRTC звук идёт мимо нас пакетами — там ответ отмечаем по тексту
    // (транскрипт ИИ идёт вровень с речью), а провалы видны в «поток WebRTC».
    let reply = null;

    // Этапы старта (лог «голос: этап», мс от подключения телефона): видно,
    // на чём тратится время до приветствия.
    const openedAt = Date.now();
    let greetingAskedAt = deferGreeting ? 0 : openedAt;
    let greetingHeard = false;
    const stage = (name, extra = {}) => {
      app.log.info({ guestId, restaurantId, transport, stage: name, ms: Date.now() - openedAt, ...extra }, 'голос: этап');
    };
    let replyTimer = null;
    // До какого момента у гостя ещё звучит ИИ (с запасом на буфер и сеть).
    const aiAudible = () => reply && Date.now() < reply.playhead + AI_AUDIBLE_TAIL_MS;

    const finishReply = () => {
      if (!reply) return;
      if (transport === 'webrtc') {
        app.log.info({
          guestId, restaurantId, transport,
          wallMs: reply.lastAt - reply.startedAt,
          inputDuringReply: reply.inputDuring,
        }, 'ответ ИИ');
        reply = null;
        return;
      }
      app.log.info({
        guestId, restaurantId, transport,
        audioMs: Math.round(reply.audioMs),
        wallMs: reply.lastAt - reply.startedAt,
        stallMs: Math.round(reply.stallMs),
        maxGapMs: reply.maxGapMs,
        chunks: reply.chunks,
        // Доля кусков микрофона громче порога, пока звучал ИИ: высокая —
        // микрофон слышит ИИ из динамика (эхо) или гость говорит поверх.
        micLoudPct: reply.micChunks ? Math.round((reply.micLoudChunks / reply.micChunks) * 100) : 0,
        inputDuringReply: reply.inputDuring,
      }, 'ответ ИИ: поток звука');
      reply = null;
    };

    // Начало ответа ИИ: пишем задержку — от «гость договорил» (событие
    // провайдера), от последнего звука/текста гостя, а для первой реплики —
    // от сигнала «здоровайся».
    const startReply = (now) => {
      app.log.info({
        guestId, restaurantId, transport,
        fromTurnEndMs: turnEndAt ? now - turnEndAt : null,
        fromGuestVoiceMs: lastGuestVoiceAt ? now - lastGuestVoiceAt : null,
        fromGreetingAskMs: !greetingHeard && greetingAskedAt ? now - greetingAskedAt : null,
      }, 'задержка ответа');
      greetingHeard = true;
      turnEndAt = 0;
      reply = {
        startedAt: now, lastAt: now, playhead: now, audioMs: 0, stallMs: 0,
        maxGapMs: 0, chunks: 0, micChunks: 0, micLoudChunks: 0, inputDuring: 0,
      };
    };

    // WebRTC: пришёл кусок текста ответа ИИ — ответ идёт.
    const noteAiText = () => {
      const now = Date.now();
      if (!reply) startReply(now);
      reply.lastAt = now;
      reply.playhead = now;
      clearTimeout(replyTimer);
      replyTimer = setTimeout(finishReply, REPLY_END_GAP_MS);
    };

    // Пришёл звук ИИ длительностью ms (кусок PCM, WebSocket-путь).
    const noteAiAudio = (ms) => {
      const now = Date.now();
      if (!reply) startReply(now);
      // Простой «телефон без буфера»: если кусок пришёл позже, чем
      // доиграл предыдущий, — это провал в потоке от провайдера.
      if (now > reply.playhead) {
        if (reply.chunks) reply.stallMs += now - reply.playhead;
        reply.playhead = now;
      }
      reply.playhead += ms;
      reply.audioMs += ms;
      reply.maxGapMs = Math.max(reply.maxGapMs, now - reply.lastAt);
      reply.lastAt = now;
      reply.chunks += 1;
      clearTimeout(replyTimer);
      replyTimer = setTimeout(finishReply, reply.playhead - now + REPLY_END_GAP_MS);
    };

    // Пришёл кусок микрофона гостя (loud — громче порога).
    const noteGuestAudio = (loud) => {
      if (loud) lastGuestVoiceAt = Date.now();
      const speaking = aiAudible();
      if (speaking) {
        reply.micChunks += 1;
        if (loud) reply.micLoudChunks += 1;
      }
      return speaking;
    };

    const onEvent = (event) => {
      // Для бокала на телефоне: «гость договорил» и ответ ИИ по кускам.
      // GPT-Live присылает их нашими событиями (gptLiveEvents), Realtime
      // (openai/grok) — сырыми событиями API.
      if (event.type === 'user.turn_end' || event.type === 'input_audio_buffer.speech_stopped') {
        turnEndAt = Date.now();
        lastTurnEndAt = turnEndAt;
        toGuest({ type: 'user_turn_end' });
      } else if (
        (event.type === 'response.transcript.delta' ||
          event.type === 'response.output_audio_transcript.delta' ||
          event.type === 'response.audio_transcript.delta') &&
        (event.text || event.delta)
      ) {
        toGuest({ type: 'transcript_delta', text: event.text || event.delta });
        if (transport === 'webrtc') noteAiText();
      } else if (
        event.type === 'response.transcript.end' ||
        event.type === 'response.output_audio_transcript.done' ||
        event.type === 'response.audio_transcript.done'
      ) {
        toGuest({ type: 'transcript_end' });
      }

      if (event.type === 'relay.error' || event.type === 'error') {
        app.log.error(event, 'realtime session error');
      } else if (event.type === 'session.input_transcript.delta') {
        // Гость говорит (в WebRTC его звук идёт мимо нас — судим по тексту).
        lastGuestVoiceAt = Date.now();
      } else if (event.type === 'webrtc.guest_state') {
        app.log.info({ guestId, restaurantId, state: event.state }, 'WebRTC с гостем');
        if (event.state === 'connected') stage('guest_connected');
      } else if (event.type === 'webrtc.ai_session') {
        app.log.info({ guestId, restaurantId, liveSessionId: event.id }, 'WebRTC с GPT-Live: сессия создана');
        stage('ai_session_created');
      } else if (event.type === 'session.started') {
        stage('ai_session_started');
      } else if (event.type === 'webrtc.greet_sent') {
        stage('greet_sent');
      } else if (event.type === 'user.transcript') {
        // duringAiSpeech — реплика распознана, пока у гостя звучал ИИ:
        // либо гость перебил, либо модель услышала саму себя (эхо).
        const duringAiSpeech = Boolean(aiAudible());
        if (duringAiSpeech) reply.inputDuring += 1;
        app.log.info({ guestId, restaurantId, text: event.text, duringAiSpeech }, 'гость сказал');
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
        app.log.info({
          guestId, restaurantId, name: event.name, args: event.args, result: event.result,
          fromTurnEndMs: lastTurnEndAt ? Date.now() - lastTurnEndAt : null,
        }, 'ИИ вызвал инструмент');
      }
    };

    const handleGuestMessage = (msg) => {
      if (msg.type === 'audio' && msg.data) {
        const speaking = noteGuestAudio(pcm16Rms(msg.data) > GUEST_VOICE_RMS);
        openaiSession.sendAudio(speaking && config.muteMicWhileSpeaking ? pcm16Silence(msg.data) : msg.data);
      } else if (msg.type === 'webrtc_offer' && typeof msg.sdp === 'string' && openaiSession.answerGuest) {
        openaiSession.answerGuest(msg.sdp)
          .then((sdp) => toGuest({ type: 'webrtc_answer', sdp }))
          .catch((err) => {
            app.log.error({ guestId, restaurantId, err: String(err) }, 'WebRTC с гостем: не удалось ответить на offer');
            toGuest({ type: 'webrtc_failed' });
          });
      } else if (msg.type === 'client_stats') {
        // Как звук играл на телефоне (опустошения очереди, подвисания
        // вкладки; в WebRTC — потери, джиттер, тип соединения).
        const { type, ...stats } = msg;
        app.log.info({ guestId, restaurantId, transport, ...stats }, 'звук на телефоне');
      } else if (msg.type === 'barge_in') {
        // Телефон оборвал звук ИИ: гость заговорил поверх (или эхо — тогда
        // таких строк будет много без реальных реплик гостя).
        app.log.info({ guestId, restaurantId, level: msg.level }, 'гость перебил ИИ');
      } else if (msg.type === 'start_greeting') {
        // Заставка закончилась — можно здороваться (см. deferGreeting).
        if (!greetingAskedAt) greetingAskedAt = Date.now();
        stage('greeting_asked');
        openaiSession.startGreeting();
      }
    };

    guestSocket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (openaiSession) handleGuestMessage(msg);
      else pendingGuestMessages.push(msg);
    });

    let guestClosed = false;
    let flowTimer = null;
    guestSocket.on('close', () => {
      guestClosed = true;
      clearTimeout(maxTimer);
      clearInterval(flowTimer);
      clearTimeout(replyTimer);
      finishReply();
      releaseSlot();
      openaiSession?.close();
    });

    // Телефону сразу — каким путём пойдёт звук (если WebRTC выключен на
    // сервере, телефон останется на этом же сокете), а для WebRTC — ICE-серверы
    // (TURN), чтобы он готовил offer, пока мы грузим контекст.
    toGuest(transport === 'webrtc'
      ? { type: 'transport', transport, iceServers: guestIceServers() }
      : { type: 'transport', transport });

    try {
      const { instructions, voice, hasHistory, greetingText } = await buildSessionContext({ guestId, restaurantId, sessionId, deviceId });
      if (guestClosed) return;
      stage('context_loaded');

      const sessionOpts = {
        instructions,
        voice,
        hasHistory,
        greetingText,
        deferGreeting,
        tools: buildTools(restaurantId, tableNumber, guestSocket),
        onEvent,
        onClose: () => {
          releaseSlot();
          guestSocket.close();
        },
      };
      openaiSession = transport === 'webrtc'
        ? openGptLiveWebrtcSession(sessionOpts)
        : openVoiceSession({
          ...sessionOpts,
          onAudioDelta: (base64Audio) => {
            noteAiAudio(pcm16DurationMs(base64Audio));
            if (guestSocket.readyState === guestSocket.OPEN) {
              guestSocket.send(JSON.stringify({ type: 'audio', data: base64Audio }));
            }
          },
        });
    } catch (err) {
      app.log.error(err, 'не удалось открыть голосовую сессию');
      releaseSlot();
      guestSocket.close();
      return;
    }

    // WebRTC: раз в 15 с — насколько ровно идут пакеты от OpenAI (ai) и от
    // телефона (guest): late — разрывы длиннее 60 мс при норме 20 мс.
    if (openaiSession.takeFlowStats) {
      flowTimer = setInterval(() => {
        const { ai, guest } = openaiSession.takeFlowStats();
        if (ai.packets || guest.packets) {
          app.log.info({ guestId, restaurantId, ai, guest }, 'поток WebRTC');
        }
      }, FLOW_LOG_MS);
    }

    pendingGuestMessages.splice(0).forEach(handleGuestMessage);
  });
}
