import crypto from 'node:crypto';
import { RTCPeerConnection, MediaStreamTrack, useOPUS } from 'werift';
import { config } from './config.js';
import { createLiveEventHandler, liveSessionConfig } from './gptLiveEvents.js';

// GPT-Live по WebRTC через наш сервер (основной путь):
//
//   телефон ⇄ WebRTC ⇄ relay (Казахстан) ⇄ WebRTC ⇄ GPT-Live
//
// Звук не декодируем и не копим: RTP-пакеты Opus пересылаются между двумя
// соединениями как есть. GPT-Live отдаёт голос в реальном времени и сам
// замолкает, когда гость его перебивает, — у гостя голос стихает сразу, как в
// приложении OpenAI. Эхо гасит браузер (звонковый режим WebRTC). OpenAI видит
// только казахстанский IP.
//
// События сессии (транскрипты, наши инструменты, приветствие) идут по
// data channel "oai-events" и обрабатываются тем же кодом, что и в
// WebSocket-варианте (gptLiveEvents.js). Сигнализация с телефоном (SDP) — по
// уже открытому WebSocket гостя (voiceSession.js).
//
// По докам OpenAI (guides/voice-webrtc): сессию создаёт HTTP-запрос
// POST /v1/live/sessions с transport.webrtc.sdp; session.start по каналу НЕ
// шлём; формат звука не указываем (его согласует SDP).

const GATHER_TIMEOUT_MS = 3000;

function peerConfig() {
  return {
    codecs: { audio: [useOPUS()], video: [] },
    // werift всегда спрашивает свой внешний адрес у STUN (stun.l.google.com,
    // даже при пустом iceServers) и по умолчанию ждёт ответа до 5 с. Серверу с
    // публичным IP он почти не нужен — ждём не больше секунды. Звук и события
    // — в одном транспорте (bundle).
    iceServers: [],
    iceStunGatherTimeout: 1,
    bundlePolicy: 'max-bundle',
    // Канал событий: session.started несёт весь конфиг сессии (инструкции с
    // меню — 70+ КБ). При стандартных 64 КБ OpenAI его не присылает
    // (data_channel_message_too_large) — и приветствие не запускалось.
    maxMessageSize: 1024 * 1024,
    iceUseIpv6: false,
    icePortRange: [config.webrtcPortMin, config.webrtcPortMax],
  };
}

function waitGathering(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, GATHER_TIMEOUT_MS);
    pc.iceGatheringStateChange.subscribe((state) => {
      if (state === 'complete') { clearTimeout(timer); resolve(); }
    });
  });
}

// Сервер за NAT хостинга: в своих host-кандидатах подменяем внутренний IP на
// публичный (WEBRTC_PUBLIC_IP). Если публичный IP на интерфейсе — не нужно.
function withPublicIp(sdp) {
  const ip = config.webrtcPublicIp;
  if (!ip) return sdp;
  return sdp
    .replace(/^(a=candidate:\S+ \d+ udp \d+ )(\d+\.\d+\.\d+\.\d+)( \d+ typ host)/gim, `$1${ip}$3`)
    .replace(/^c=IN IP4 \d+\.\d+\.\d+\.\d+/gm, `c=IN IP4 ${ip}`);
}

// ICE-серверы для телефона: временные логин/пароль TURN по схеме coturn
// use-auth-secret (логин = срок действия, пароль = HMAC от секрета).
export function guestIceServers() {
  if (!config.turnUrls.length || !config.turnSecret) return [];
  const username = `${Math.floor(Date.now() / 1000) + 3600}:guest`;
  const credential = crypto.createHmac('sha1', config.turnSecret).update(username).digest('base64');
  return [{ urls: config.turnUrls, username, credential }];
}

// Ровность потока пакетов (норма — пакет каждые 20 мс): сколько пришло,
// самый большой разрыв и сколько разрывов длиннее LATE_GAP_MS. По ним видно,
// откуда «рваный» звук — от OpenAI или из сети телефона.
const LATE_GAP_MS = 60;
function createFlowMeter() {
  let packets = 0;
  let maxGapMs = 0;
  let late = 0;
  let lastAt = 0;
  return {
    packet() {
      const now = Date.now();
      if (lastAt) {
        const gap = now - lastAt;
        // Пауза дольше секунды — тишина/DTX, а не провал потока.
        if (gap < 1000) {
          maxGapMs = Math.max(maxGapMs, gap);
          if (gap > LATE_GAP_MS) late += 1;
        }
      }
      lastAt = now;
      packets += 1;
    },
    take() {
      const snapshot = { packets, maxGapMs, late };
      packets = 0;
      maxGapMs = 0;
      late = 0;
      return snapshot;
    },
  };
}

export function openGptLiveWebrtcSession({
  instructions, voice, tools = [], hasHistory = false, deferGreeting = false,
  onEvent, onClose,
}) {
  let closed = false;
  const aiFlow = createFlowMeter();
  const guestFlow = createFlowMeter();

  // --- Нога к GPT-Live: мы предлагаем (offer), OpenAI отвечает ---
  const aiPc = new RTCPeerConnection(peerConfig());
  const toAi = new MediaStreamTrack({ kind: 'audio' });
  aiPc.addTransceiver(toAi, { direction: 'sendrecv' });
  const dc = aiPc.createDataChannel('oai-events');

  // --- Нога к гостю: телефон предлагает, мы отвечаем ---
  const guestPc = new RTCPeerConnection(peerConfig());
  const toGuest = new MediaStreamTrack({ kind: 'audio' });

  // Пересылка звука: голос ИИ → гостю, микрофон гостя → ИИ.
  aiPc.onTrack.subscribe((track) => {
    track.onReceiveRtp.subscribe((rtp) => {
      aiFlow.packet();
      toGuest.writeRtp(rtp);
    });
  });
  guestPc.onTrack.subscribe((track) => {
    track.onReceiveRtp.subscribe((rtp) => {
      guestFlow.packet();
      toAi.writeRtp(rtp);
    });
  });

  // Канал событий: OpenAI может прислать session.started раньше, чем у нас
  // канал перейдёт в open, — исходящие до открытия копим и шлём следом.
  const pendingOut = [];
  const send = (obj) => {
    if (dc.readyState === 'open') { dc.send(JSON.stringify(obj)); return true; }
    if (dc.readyState === 'connecting') { pendingOut.push(obj); return true; }
    return false;
  };
  const handler = createLiveEventHandler({ tools, hasHistory, greetOnStart: false, send, onEvent });

  // Приветствие — когда сессия GPT-Live уже поднялась (session.started) И
  // телефон готов слушать (start_greeting / без прогрева сразу). Сессию
  // поднимаем заранее, под заставкой, — после сигнала остаётся только сама
  // реплика ИИ.
  let sessionStarted = false;
  let greetRequested = !deferGreeting;
  const maybeGreet = () => {
    if (sessionStarted && greetRequested && handler.greet()) onEvent?.({ type: 'webrtc.greet_sent' });
  };

  dc.onMessage.subscribe((data) => {
    let event;
    try { event = JSON.parse(data.toString()); } catch { return; }
    handler.handle(event);
    if (event.type === 'session.started') {
      sessionStarted = true;
      maybeGreet();
    }
  });

  const close = () => {
    if (closed) return;
    closed = true;
    handler.flush();
    // Просим OpenAI закрыть сессию (иначе минуты идут до таймаута), потом
    // рвём оба соединения.
    send({ type: 'session.close', event_id: 'session_close' });
    setTimeout(() => {
      aiPc.close().catch(() => {});
      guestPc.close().catch(() => {});
    }, 300);
    onClose?.();
  };

  dc.stateChanged.subscribe((state) => {
    if (state === 'open') pendingOut.splice(0).forEach((obj) => dc.send(JSON.stringify(obj)));
    if (state === 'closed') close();
  });
  aiPc.connectionStateChange.subscribe((state) => {
    if (state === 'failed') {
      onEvent?.({ type: 'relay.error', error: 'WebRTC-соединение с GPT-Live оборвалось' });
      close();
    }
  });
  guestPc.connectionStateChange.subscribe((state) => {
    onEvent?.({ type: 'webrtc.guest_state', state });
  });

  // Сессию GPT-Live поднимаем сразу, ещё под заставкой: HTTP-запрос,
  // соединение и session.started занимают пару секунд — гость их не ждёт.
  // Сама GPT-Live первой не заговаривает (молчит до нашего response.create),
  // так что поверх заставки ИИ не зазвучит.
  const startSession = async () => {
    try {
      await aiPc.setLocalDescription(await aiPc.createOffer());
      await waitGathering(aiPc);
      const sdp = withPublicIp(aiPc.localDescription.sdp);
      if (closed) return;
      const res = await fetch(config.gptLiveSessionsUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session: liveSessionConfig({ instructions, voice, tools }),
          transport: { type: 'webrtc', sdp },
        }),
      });
      if (!res.ok) throw new Error(`GPT-Live ${res.status}: ${(await res.text()).slice(0, 500)}`);
      const json = await res.json();
      if (closed) return;
      await aiPc.setRemoteDescription({ type: 'answer', sdp: json.transport.sdp });
      onEvent?.({ type: 'webrtc.ai_session', id: json.session?.id });
    } catch (err) {
      onEvent?.({ type: 'relay.error', error: `не удалось создать сессию GPT-Live: ${err.message || err}` });
      close();
    }
  };
  startSession();

  return {
    transport: 'webrtc',
    startGreeting() {
      greetRequested = true;
      maybeGreet();
    },
    // Ровность потоков звука с прошлого вызова (для периодического лога).
    takeFlowStats() {
      return { ai: aiFlow.take(), guest: guestFlow.take() };
    },
    // Телефон прислал offer — отвечаем своим SDP.
    async answerGuest(offerSdp) {
      await guestPc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
      const transceiver = guestPc.getTransceivers().find((t) => t.kind === 'audio');
      if (!transceiver) throw new Error('в offer гостя нет аудио');
      await transceiver.sender.replaceTrack(toGuest);
      transceiver.setDirection('sendrecv');
      await guestPc.setLocalDescription(await guestPc.createAnswer());
      await waitGathering(guestPc);
      return withPublicIp(guestPc.localDescription.sdp);
    },
    sendAudio() { /* звук идёт по WebRTC, не через WebSocket */ },
    close,
  };
}
