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

export function openGptLiveWebrtcSession({
  instructions, voice, tools = [], hasHistory = false, deferGreeting = false,
  onEvent, onClose, onAiPacket, onGuestPacket,
}) {
  let closed = false;

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
      onAiPacket?.(rtp.payload.length);
      toGuest.writeRtp(rtp);
    });
  });
  guestPc.onTrack.subscribe((track) => {
    track.onReceiveRtp.subscribe((rtp) => {
      onGuestPacket?.(rtp.payload.length);
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
  const handler = createLiveEventHandler({ tools, hasHistory, send, onEvent });
  dc.onMessage.subscribe((data) => {
    let event;
    try { event = JSON.parse(data.toString()); } catch { return; }
    handler.handle(event);
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

  // Свой offer к OpenAI собираем сразу (кандидаты, DTLS) — чтобы к сигналу
  // приветствия оставался только HTTP-запрос.
  const offerReady = (async () => {
    await aiPc.setLocalDescription(await aiPc.createOffer());
    await waitGathering(aiPc);
    return withPublicIp(aiPc.localDescription.sdp);
  })();

  let startRequested = false;
  const startSession = async () => {
    if (startRequested || closed) return;
    startRequested = true;
    try {
      const sdp = await offerReady;
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
  // Прогрев под заставкой: сессию (и счётчик минут) запускаем по сигналу
  // start_greeting, иначе ИИ поздоровался бы поверх видео.
  if (!deferGreeting) startSession();

  return {
    transport: 'webrtc',
    startGreeting() { startSession(); },
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
