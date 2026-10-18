import { useCallback, useEffect, useRef, useState } from 'react';
import VoiceDishSlider from '../VoiceDishSlider/VoiceDishSlider';
import SmokeGlass from './SmokeGlass/SmokeGlass';
import AudioBars from './AudioBars/AudioBars';
import { roleFromDishes, roleFromText, ROLE_COLORS } from '../../lib/assistantRole';
import styles from './VoiceStage.module.css';

const RELAY_WS_URL = import.meta.env.VITE_VOICE_RELAY_URL || 'wss://voice.restai.space/voice';

// Громкость голоса ИИ: усиливаем, но без хрипа/треска. Порядок узлов
// критичен — сначала makeup-усиление, ПОТОМ лимитер, ПОТОМ мягкий клиппер.
// Раньше лимитер стоял ДО усиления: его attack пропускал начало каждого
// согласного, а makeup ×6 загонял этот пик в жёсткий клиппинг на динамике —
// отсюда треск на речи. Теперь лимитер видит уже усиленный сигнал и держит
// потолок, а tanh-клиппер мягко скругляет редкие выбросы (без щелчков).
const PLAYBACK_GAIN = 3.0;

// Лимитер-потолок ПОСЛЕ усиления: держит выход около -3 дБ, ratio 20 —
// «кирпичная стена», быстрый attack ловит усиленные пики речи.
const LIMITER = { threshold: -3.0, knee: 0, ratio: 20, attack: 0.002, release: 0.1 };

// Запас (сек) перед стартом новой реплики — подушка против сетевого
// джиттера: куски аудио приходят неравномерно, и без запаса очередь то и
// дело опустошается, давая паузы на стыках. Начинаем со 120 мс (на слух
// незаметно); если очередь всё же опустела посреди фразы (кусок опоздал —
// сеть или занятый поток браузера), запас растёт ступенями до 450 мс.
const PLAYBACK_LEAD = 0.12;
const PLAYBACK_LEAD_MAX = 0.45;
const PLAYBACK_LEAD_STEP = 0.08;
// Пауза между кусками короче этой — та же фраза, а не новая реплика.
const SAME_REPLY_GAP = 0.6;
// Диагностика: кадр дольше этого — вкладка подвисла; сводка — раз в N мс.
const LONG_FRAME_MS = 100;
const STATS_INTERVAL_MS = 5000;
// WebRTC: сколько ждём соединения, прежде чем уйти на WebSocket; сводку
// статистики шлём раз в WEBRTC_STATS_EVERY интервалов.
const WEBRTC_CONNECT_TIMEOUT_MS = 6000;
const WEBRTC_STATS_EVERY = 3;
// WebRTC: «ИИ говорит», пока входящий звук громче AI_TALK_RMS; молчание
// короче AI_QUIET_MS (паузы между словами) речь не прерывает.
const AI_TALK_RMS = 0.01;
const AI_QUIET_MS = 300;

// Мягкий клиппер (tanh) — страховка от жёсткого клиппинга на самом выходе.
// Кривая почти линейна в рабочем диапазоне и плавно насыщается у краёв,
// поэтому любой выброс превращается в мягкое насыщение, а не в треск.
function makeSoftClipCurve(samples = 1024) {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(1.1 * x);
  }
  return curve;
}

// Линейная интерполяция — этого достаточно для голоса, аудиофильская
// точность тут не нужна. Микрофон браузера обычно отдаёт 48000Гц,
// а Realtime API ждёт ровно 24000Гц.
function resampleTo24k(float32In, inputSampleRate) {
  if (inputSampleRate === 24000) return float32In;
  const ratio = inputSampleRate / 24000;
  const outLength = Math.round(float32In.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, float32In.length - 1);
    const frac = srcIndex - i0;
    out[i] = float32In[i0] * (1 - frac) + float32In[i1] * frac;
  }
  return out;
}

function float32ToPcm16Base64(float32) {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 32768 : s * 32767;
  }
  let binary = '';
  const bytes = new Uint8Array(int16.buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function pcm16Base64ToFloat32(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
  return float32;
}

function rmsLevel(float32) {
  let sum = 0;
  for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
  return Math.min(1, Math.sqrt(sum / float32.length) * 4);
}

// Громкость (RMS) того, что сейчас проходит через анализатор.
const analyserBuffers = new WeakMap();
function analyserRms(analyser) {
  let data = analyserBuffers.get(analyser);
  if (!data) {
    data = new Uint8Array(analyser.frequencyBinCount);
    analyserBuffers.set(analyser, data);
  }
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

// Сводка WebRTC для лога relay: потери, джиттер, «додуманные» браузером
// куски (провалы), средний буфер, задержка сети и путь (прямой/через TURN).
async function collectWebrtcStats(pc) {
  const report = await pc.getStats();
  let inbound = null;
  let pair = null;
  report.forEach((s) => {
    if (s.type === 'inbound-rtp' && s.kind === 'audio') inbound = s;
    if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s;
  });
  const local = pair ? report.get(pair.localCandidateId) : null;
  const round1 = (v) => Math.round(v * 10) / 10;
  const lost = inbound?.packetsLost ?? 0;
  const received = inbound?.packetsReceived ?? 0;
  return {
    lossPct: received + lost > 0 ? round1((100 * lost) / (received + lost)) : 0,
    jitterMs: inbound?.jitter != null ? Math.round(inbound.jitter * 1000) : null,
    concealedPct: inbound?.totalSamplesReceived
      ? round1((100 * (inbound.concealedSamples || 0)) / inbound.totalSamplesReceived)
      : null,
    bufferMs: inbound?.jitterBufferEmittedCount
      ? Math.round((1000 * inbound.jitterBufferDelay) / inbound.jitterBufferEmittedCount)
      : null,
    rttMs: pair?.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
    path: local ? `${local.candidateType}/${local.protocol}` : null,
  };
}

// Порог уровня микрофона (после rmsLevel), выше которого считаем, что гость
// говорит, и сколько держим «слушаю» после последнего звука.
const MIC_TALK_LEVEL = 0.06;
const MIC_HOLD_MS = 1200;
// Перебивание. GPT-Live сам замолкает, когда слышит гостя, но звук, который
// он уже прислал, лежит в очереди телефона и доигрывался бы до конца — гость
// слышал бы, что ИИ «говорит поверх». Поэтому, если гость говорит громче
// BARGE_IN_LEVEL дольше BARGE_IN_MS, пока звучит ИИ, обрываем очередь сами.
// Порог выше MIC_TALK_LEVEL — чтобы остатки эха ИИ из динамика не обрывали
// его же. Хвост старого ответа, который ещё долетает, отбрасываем, пока в
// потоке не будет паузы NEW_REPLY_GAP (= модель начала новый ответ).
const BARGE_IN_LEVEL = 0.2;
const BARGE_IN_MS = 300;
const NEW_REPLY_GAP = 0.5;
const DROP_MAX_SEC = 15;
// «Думаю» — от конца реплики гостя до первого звука ответа, но не дольше.
const THINK_MAX_MS = 9000;
// Роль по тексту ответа решаем по его началу — дальше не перекрашиваем.
const ROLE_TEXT_MIN = 18;
const ROLE_TEXT_MAX = 160;

// Реальный голосовой разговор с voice-relay (wss://voice.restai.space/voice).
// Основной путь — WebRTC: микрофон и голос ИИ идут живым потоком, как в
// звонке (эхоподавление браузера, мгновенное перебивание); по WebSocket —
// только сигнализация и команды экрана. Запасной путь (WebRTC не поднялся) —
// звук кусками PCM прямо по WebSocket.
// Визуально — «дым в бокале» (SmokeGlass): состояние idle/listen/think/speak,
// амплитуда — уровень микрофона, пока говорит гость, и уровень голоса ИИ,
// пока отвечает он; цвет — кто отвечает (шеф, сомелье, диетолог).
//
// ScriptProcessorNode (только запасной путь) официально deprecated в пользу
// AudioWorklet, но пока работает во всех нужных браузерах.
export default function VoiceStage({ guestId, restaurantId, tableNumber, sessionId, prewarm = false, initialRole = 'chef', onExpandDish, onCartAdd, onShowCart, onHideCart }) {
  const glassRef = useRef(null);
  const [roleColor, setRoleColor] = useState(ROLE_COLORS[initialRole] || ROLE_COLORS.chef);
  // Анализаторы для визуализатора: голос ИИ (после лимитера) и микрофон.
  const outputAnalyserRef = useRef(null);
  const micAnalyserRef = useRef(null);
  const playbackLeadRef = useRef(PLAYBACK_LEAD);
  const lastChunkAtRef = useRef(-Infinity);
  // Диагностика звука (уходит в лог voice-relay, см. client_stats).
  const playStatsRef = useRef({ underruns: 0, underrunMs: 0, longFrames: 0, maxFrameMs: 0 });
  // Перебивание: играющие куски (чтобы оборвать), с какого момента
  // отбрасываем хвост старого ответа, и функция обрыва из фазы 1 для фазы 2.
  const playingSourcesRef = useRef(new Set());
  const droppingSinceRef = useRef(0);
  // Транспорт звука ('webrtc' | 'ws', пока неизвестен — null), отправитель
  // микрофона в WebRTC, <audio> для голоса ИИ, подключение микрофона из фазы 1
  // для фазы 2 и было ли уже запрошено приветствие.
  const modeRef = useRef(null);
  const micSenderRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const attachMicRef = useRef(null);
  const greetingRequestedRef = useRef(false);
  const [status, setStatus] = useState('connecting'); // 'connecting' | 'listening' | 'busy' | 'error'
  const [statusMessage, setStatusMessage] = useState('');
  // Блюда, которые ИИ показал за этот разговор (show_dish_card/
  // hide_dish_card) — локальное состояние, не в App.jsx: живёт и умирает
  // вместе с самим голосовым разговором, отдельного сброса не требует.
  const [voiceDishes, setVoiceDishes] = useState([]);

  // Латест-реф на колбэки корзины из App: они могут пересоздаваться на
  // каждый рендер родителя, а WS-эффект зависит только от id сессии —
  // без рефа новая функция заставляла бы переподключать сокет.
  const onCartAddRef = useRef(onCartAdd);
  const onShowCartRef = useRef(onShowCart);
  const onHideCartRef = useRef(onHideCart);
  onCartAddRef.current = onCartAdd;
  onShowCartRef.current = onShowCart;
  onHideCartRef.current = onHideCart;

  // setLevel задаёт лишь ЦЕЛЬ уровня; сам шар плавно подтягивается к ней в
  // visualLoop каждый кадр (интерполяция) — поэтому движение гладкое, без
  // рывков между кусками аудио.
  const setLevel = (level) => {
    targetLevelRef.current = Math.max(0, Math.min(1, level));
  };

  // Общее между фазами прогрева и активации — держим в ref, чтобы второй
  // эффект (микрофон) мог дотянуться до уже созданных в первом графа и WS.
  const audioContextRef = useRef(null);
  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const scriptNodeRef = useRef(null);
  const aiSpeakingRef = useRef(false);
  const nextPlaybackTimeRef = useRef(0);
  const activatedRef = useRef(false);
  // Плавность шара: target — куда стремимся (из анализатора ИИ или с
  // микрофона), display — текущее значение, каждый кадр подтягиваемое к цели.
  const targetLevelRef = useRef(0);
  const displayLevelRef = useRef(0);
  // Для состояний бокала: когда гость последний раз звучал громче порога,
  // с какого момента «думаем», и текст текущего ответа ИИ (для роли).
  const micLevelRef = useRef(0);
  const micHeardAtRef = useRef(0);
  const thinkingSinceRef = useRef(0);
  const replyTextRef = useRef('');
  const roleLockedRef = useRef(false);
  const applyRole = (role) => {
    glassRef.current?.setRole(role);
    setRoleColor(ROLE_COLORS[role] || ROLE_COLORS.chef);
  };
  // Что показывает визуализатор: пока говорит ИИ — его голос, иначе микрофон.
  const getAnalyser = useCallback(
    () => (aiSpeakingRef.current ? outputAnalyserRef.current : micAnalyserRef.current),
    [],
  );
  const statusRef = useRef('connecting');
  useEffect(() => { statusRef.current = status; }, [status]);

  // ФАЗА 1 — соединение и ВОСПРОИЗВЕДЕНИЕ (без микрофона). Запускается при
  // монтировании: под видео-заставкой (prewarm) это и есть «прогрев» —
  // WebSocket, WebRTC и загрузка контекста готовятся заранее, а само
  // приветствие откладывается (deferGreeting) до сигнала из фазы 2.
  // prewarm читается один раз при монтировании — смена флага НЕ пересоздаёт
  // соединение (иначе прогрев был бы бессмысленным).
  //
  // Звук идёт по WebRTC (relay сообщает {type:'transport'}): микрофон — трек
  // соединения, голос ИИ — входящий трек в <audio>; эхо гасит браузер, а
  // перебивание отрабатывает сам GPT-Live. Если WebRTC не поднялся (нет в
  // браузере, сеть режет UDP, таймаут) — переподключаемся с transport=ws:
  // звук кусками PCM в JSON, как раньше.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let stopped = false;
    let rafId = null;
    let makeupGain = null;
    let removeUnlock = null;
    let ws = null;
    let pc = null;
    let fellBack = false;
    let fallbackReason = '';
    let connectTimer = null;
    let aiQuietSince = 0;

    // Раньше AudioContext разблокировал клик по кнопке «войти». Кнопки
    // больше нет — заставка стартует сама после скана QR, поэтому контекст
    // создаём здесь, а разблокировку звука вешаем на первое касание экрана
    // (см. unlockAudio ниже).
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioContextRef.current = audioContext;
    const remoteAudio = remoteAudioRef.current;

    // Уровень звука ИИ — из живого аудио-графа через AnalyserNode. Цикл
    // крутится ВСЕГДА (не только пока играет ИИ) и каждый кадр подтягивает
    // отображаемый уровень к целевому — поэтому шар движется плавно, а не
    // рывками между кусками аудио.
    let lastFrameAt = 0;
    const visualLoop = (frameAt) => {
      // Подвисание вкладки (кадр дольше LONG_FRAME_MS) — в тот же поток
      // приходят звук и микрофон, так что это кандидат в причины обрывов.
      if (lastFrameAt && document.visibilityState === 'visible') {
        const frameMs = frameAt - lastFrameAt;
        if (frameMs > LONG_FRAME_MS && frameMs < 2000) {
          const stats = playStatsRef.current;
          stats.longFrames += 1;
          stats.maxFrameMs = Math.max(stats.maxFrameMs, frameMs);
        }
      }
      lastFrameAt = frameAt;
      const now = performance.now();
      const webrtc = modeRef.current === 'webrtc';
      const outputAnalyser = outputAnalyserRef.current;

      // WebRTC: кусков нет — «ИИ говорит» узнаём по уровню входящего звука
      // (с короткой задержкой на паузы между словами).
      if (webrtc && outputAnalyser) {
        if (analyserRms(outputAnalyser) > AI_TALK_RMS) {
          aiSpeakingRef.current = true;
          aiQuietSince = 0;
        } else if (aiSpeakingRef.current) {
          if (!aiQuietSince) aiQuietSince = now;
          else if (now - aiQuietSince > AI_QUIET_MS) aiSpeakingRef.current = false;
        }
      }

      if (aiSpeakingRef.current && outputAnalyser) {
        targetLevelRef.current = Math.min(1, analyserRms(outputAnalyser) * 3.5);
      } else if (webrtc && micAnalyserRef.current) {
        // WebRTC: микрофон не проходит через ScriptProcessor — уровень гостя
        // берём из анализатора микрофона.
        const level = Math.min(1, analyserRms(micAnalyserRef.current) * 4);
        targetLevelRef.current = level;
        micLevelRef.current = level;
        if (level > MIC_TALK_LEVEL) {
          micHeardAtRef.current = now;
          thinkingSinceRef.current = 0; // гость снова заговорил
        }
      } else {
        // Ни ИИ, ни свежих данных с микрофона — плавно гасим (микрофон, если
        // активен, тут же перепишет цель своим значением в onaudioprocess).
        targetLevelRef.current *= 0.9;
      }
      // Интерполяция к цели — сглаживает и пики ИИ, и стыки кусков аудио.
      displayLevelRef.current += (targetLevelRef.current - displayLevelRef.current) * 0.22;

      // Состояние бокала: говорит ИИ → speak; гость договорил, ответа ещё
      // нет → think; гость говорит → listen; иначе idle.
      const glass = glassRef.current;
      if (glass) {
        let state = 'idle';
        let amp = 0;
        if (aiSpeakingRef.current) {
          state = 'speak';
          amp = displayLevelRef.current;
          thinkingSinceRef.current = 0;
        } else if (thinkingSinceRef.current && now - thinkingSinceRef.current < THINK_MAX_MS) {
          state = 'think';
        } else if (statusRef.current === 'listening' && now - micHeardAtRef.current < MIC_HOLD_MS) {
          state = 'listen';
          amp = micLevelRef.current;
        }
        glass.setVoice(state);
        if (state === 'speak' || state === 'listen') glass.setAmplitude(amp);
      }
      rafId = requestAnimationFrame(visualLoop);
    };

    // --- WebSocket-путь (запасной): куски PCM → очередь AudioBuffer ---

    const playChunk = (base64Audio) => {
      // После перебивания: хвост старого ответа (куски идут без паузы) — мимо.
      if (droppingSinceRef.current) {
        const t = audioContext.currentTime;
        if (t - lastChunkAtRef.current < NEW_REPLY_GAP && t - droppingSinceRef.current < DROP_MAX_SEC) {
          lastChunkAtRef.current = t;
          return;
        }
        droppingSinceRef.current = 0;
      }
      const float32 = pcm16Base64ToFloat32(base64Audio);
      if (float32.length === 0) return;

      const buffer = audioContext.createBuffer(1, float32.length, 24000);
      buffer.copyToChannel(float32, 0);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(makeupGain);

      // Очередь опустела, хотя прошлый кусок пришёл только что, — это обрыв
      // посреди фразы: увеличиваем запас, чтобы дальше не прерывалось.
      const now = audioContext.currentTime;
      if (!aiSpeakingRef.current && now - lastChunkAtRef.current < SAME_REPLY_GAP) {
        const stats = playStatsRef.current;
        stats.underruns += 1;
        stats.underrunMs += (Math.max(0, now - nextPlaybackTimeRef.current) + playbackLeadRef.current) * 1000;
        playbackLeadRef.current = Math.min(PLAYBACK_LEAD_MAX, playbackLeadRef.current + PLAYBACK_LEAD_STEP);
      }
      lastChunkAtRef.current = now;

      // Если очередь опустела (ИИ молчал) — стартуем не впритык к «сейчас», а
      // с запасом, чтобы сетевой джиттер не рвал звук.
      const base = aiSpeakingRef.current
        ? nextPlaybackTimeRef.current
        : now + playbackLeadRef.current;
      const startAt = Math.max(audioContext.currentTime, base);
      source.start(startAt);
      nextPlaybackTimeRef.current = startAt + buffer.duration;

      aiSpeakingRef.current = true;
      playingSourcesRef.current.add(source);
      source.onended = () => {
        playingSourcesRef.current.delete(source);
        if (audioContext.currentTime >= nextPlaybackTimeRef.current - 0.02) aiSpeakingRef.current = false;
      };
    };

    // Гость перебил: глушим всё, что стоит в очереди, и не доигрываем хвост.
    const stopPlayback = () => {
      const t = audioContext.currentTime;
      playingSourcesRef.current.forEach((s) => {
        try { s.stop(); } catch { /* уже доиграл */ }
      });
      playingSourcesRef.current.clear();
      nextPlaybackTimeRef.current = t;
      aiSpeakingRef.current = false;
      droppingSinceRef.current = t;
      lastChunkAtRef.current = t;
    };

    // Микрофон по WebSocket: ScriptProcessorNode → 24 кГц PCM16 → JSON.
    // ScriptProcessorNode подключаем к destination через нулевой гейн — иначе
    // onaudioprocess не гарантированно срабатывает, но эхо своего микрофона
    // гость слышать не должен.
    const startMicOverWs = (stream) => {
      if (scriptNodeRef.current) return;
      const source = audioContext.createMediaStreamSource(stream);
      const scriptNode = audioContext.createScriptProcessor(4096, 1, 1);
      scriptNodeRef.current = scriptNode;
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      source.connect(scriptNode);
      scriptNode.connect(silentGain);
      silentGain.connect(audioContext.destination);

      let bargeInSec = 0;
      scriptNode.onaudioprocess = (event) => {
        const socket = wsRef.current;
        if (stopped || !socket || socket.readyState !== WebSocket.OPEN) return;
        const input = event.inputBuffer.getChannelData(0);
        if (aiSpeakingRef.current) {
          // Гость говорит поверх ИИ достаточно громко и долго — перебил.
          const level = rmsLevel(input);
          bargeInSec = level > BARGE_IN_LEVEL ? bargeInSec + input.length / audioContext.sampleRate : 0;
          if (bargeInSec * 1000 >= BARGE_IN_MS) {
            bargeInSec = 0;
            stopPlayback();
            socket.send(JSON.stringify({ type: 'barge_in', level: Math.round(level * 100) / 100 }));
          }
        } else {
          bargeInSec = 0;
        }
        if (!aiSpeakingRef.current) {
          const level = rmsLevel(input);
          setLevel(level);
          micLevelRef.current = level;
          if (level > MIC_TALK_LEVEL) {
            micHeardAtRef.current = performance.now();
            thinkingSinceRef.current = 0; // гость снова заговорил
          }
        }
        const resampled = resampleTo24k(input, audioContext.sampleRate);
        socket.send(JSON.stringify({ type: 'audio', data: float32ToPcm16Base64(resampled) }));
      };
    };

    // Микрофон (если уже разрешён) — в текущий транспорт. Вызывается и из
    // фазы 2 (микрофон получили), и здесь (транспорт стал известен/сменился).
    const attachMic = () => {
      const stream = streamRef.current;
      if (!stream || stopped) return;
      if (modeRef.current === 'webrtc') {
        const track = stream.getAudioTracks()[0];
        if (track && micSenderRef.current) micSenderRef.current.replaceTrack(track).catch(() => {});
      } else if (modeRef.current === 'ws') {
        startMicOverWs(stream);
      }
    };
    attachMicRef.current = attachMic;

    // Цепочка воспроизведения (WebSocket): кусок -> makeupGain (усиление) ->
    // limiter (потолок против клиппинга) -> softClip (мягкая страховка) ->
    // outputAnalyser (визуализация шара) -> колонки. Усиление ДО лимитера,
    // иначе усиленные пики режутся уже на выходе (был треск на речи).
    makeupGain = audioContext.createGain();
    makeupGain.gain.value = PLAYBACK_GAIN;
    const limiter = audioContext.createDynamicsCompressor();
    limiter.threshold.value = LIMITER.threshold;
    limiter.knee.value = LIMITER.knee;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attack;
    limiter.release.value = LIMITER.release;
    const softClip = audioContext.createWaveShaper();
    softClip.curve = makeSoftClipCurve();
    softClip.oversample = '2x';
    const outputAnalyser = audioContext.createAnalyser();
    outputAnalyser.fftSize = 256;
    outputAnalyserRef.current = outputAnalyser;
    makeupGain.connect(limiter);
    limiter.connect(softClip);
    softClip.connect(outputAnalyser);
    outputAnalyser.connect(audioContext.destination);
    rafId = requestAnimationFrame(visualLoop);

    // --- WebRTC-путь (основной) ---

    // Голос ИИ из WebRTC — через ту же цепочку, что и WebSocket-звук
    // (усиление ×PLAYBACK_GAIN → лимитер → анализатор → колонки): без
    // усиления голос в звонковом режиме телефона звучит заметно тише.
    // <audio> без звука нужен только Chrome — иначе входящий WebRTC-поток в
    // аудио-граф не идёт. Эхо на телефонах гасит системное эхоподавление
    // (оно вычитает весь звук устройства, не только <audio>).
    const playRemoteStream = (stream) => {
      if (remoteAudio) {
        remoteAudio.muted = true;
        remoteAudio.srcObject = stream;
        remoteAudio.play().catch(() => { /* разблокирует первое касание */ });
      }
      audioContext.createMediaStreamSource(stream).connect(makeupGain);
    };

    const closePc = () => {
      clearTimeout(connectTimer);
      if (!pc) return;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      pc = null;
      micSenderRef.current = null;
    };

    // WebRTC не поднялся — тот же разговор по WebSocket (новая сессия relay).
    const fallbackToWs = (reason) => {
      if (fellBack || stopped) return;
      fellBack = true;
      fallbackReason = reason;
      console.warn('VoiceStage: WebRTC не поднялся, переходим на WebSocket:', reason);
      closePc();
      if (remoteAudio) remoteAudio.srcObject = null;
      aiSpeakingRef.current = false;
      modeRef.current = 'ws';
      const old = ws;
      connect('ws');
      old?.close();
    };

    const startWebrtc = async (iceServers) => {
      try {
        pc = new RTCPeerConnection({ iceServers });
        const thisPc = pc;
        const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
        micSenderRef.current = transceiver.sender;
        attachMic();
        pc.ontrack = (event) => {
          playRemoteStream(event.streams[0] || new MediaStream([event.track]));
        };
        pc.onconnectionstatechange = () => {
          if (thisPc.connectionState === 'connected') clearTimeout(connectTimer);
          if (thisPc.connectionState === 'failed') fallbackToWs('failed');
        };
        // Offer уходит сразу, без ожидания кандидатов телефона: у relay
        // публичный адрес, телефон сам стучится к нему (и через TURN тоже), а
        // relay узнаёт адрес телефона из этих проверок. Сбор кандидатов в
        // браузере местами тянется секундами — ждать его незачем.
        await pc.setLocalDescription(await pc.createOffer());
        if (stopped || thisPc !== pc) return;
        sendToRelay({ type: 'webrtc_offer', sdp: pc.localDescription.sdp });
        connectTimer = setTimeout(() => {
          if (thisPc === pc && thisPc.connectionState !== 'connected') fallbackToWs('timeout');
        }, WEBRTC_CONNECT_TIMEOUT_MS);
      } catch (err) {
        fallbackToWs(`error: ${err?.message || err}`);
      }
    };

    const sendToRelay = (msg) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    // Разблокировка звука без кнопки: браузеры (особенно iOS) держат
    // AudioContext в suspended до жеста пользователя, и приветствие ИИ
    // молчит. Ловим ПЕРВОЕ касание экрана где угодно (по заставке в том
    // числе), будим контекст и проигрываем беззвучный буфер — этого iOS
    // достаточно, чтобы дальше зазвучал и голос ассистента. Невидимо, без
    // отдельной кнопки.
    const unlockAudio = () => {
      const ctx = audioContextRef.current;
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      try {
        const b = ctx.createBuffer(1, 1, 22050);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start(0);
      } catch { /* контекст уже закрыт — не важно */ }
      remoteAudio?.play().catch(() => {});
    };
    const unlockEvents = ['pointerdown', 'touchend', 'click'];
    unlockEvents.forEach((e) => document.addEventListener(e, unlockAudio, { once: true, passive: true }));
    removeUnlock = () => unlockEvents.forEach((e) => document.removeEventListener(e, unlockAudio));

    const handleMessage = (msg) => {
      if (msg.type === 'transport') {
        // Relay сообщает, каким путём пойдёт звук.
        if (msg.transport === 'webrtc' && !fellBack) {
          modeRef.current = 'webrtc';
          startWebrtc(Array.isArray(msg.iceServers) ? msg.iceServers : []);
        } else {
          modeRef.current = 'ws';
          attachMic();
        }
      } else if (msg.type === 'webrtc_answer' && pc) {
        pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp })
          .catch((err) => fallbackToWs(`answer: ${err?.message || err}`));
      } else if (msg.type === 'webrtc_failed') {
        fallbackToWs('relay');
      } else if (msg.type === 'audio' && msg.data) {
        playChunk(msg.data);
      } else if (msg.type === 'error' && msg.code === 'busy') {
        setStatus('busy');
        setStatusMessage(msg.message || '');
      } else if (msg.type === 'user_turn_end') {
        // Гость договорил — «думаем», пока не зазвучит ответ.
        thinkingSinceRef.current = performance.now();
        replyTextRef.current = '';
        roleLockedRef.current = false;
      } else if (msg.type === 'transcript_delta' && msg.text) {
        // Кто отвечает — по началу ответа (карточки блюд уточнят ниже).
        if (!roleLockedRef.current && replyTextRef.current.length < ROLE_TEXT_MAX) {
          replyTextRef.current += msg.text;
          if (replyTextRef.current.length >= ROLE_TEXT_MIN) {
            const role = roleFromText(replyTextRef.current);
            if (role) applyRole(role);
          }
        }
      } else if (msg.type === 'transcript_end') {
        replyTextRef.current = '';
        roleLockedRef.current = false;
      } else if (msg.type === 'show_dish') {
        const dishes = Array.isArray(msg.dishes) ? msg.dishes : [];
        setVoiceDishes(dishes);
        // Карточки — самый точный сигнал темы: вино → сомелье, еда → шеф.
        const role = roleFromDishes(dishes);
        if (role) {
          applyRole(role);
          roleLockedRef.current = true;
        }
      } else if (msg.type === 'hide_dish') {
        setVoiceDishes([]);
      } else if (msg.type === 'cart_add' && Array.isArray(msg.items)) {
        onCartAddRef.current?.(msg.items);
      } else if (msg.type === 'show_cart') {
        onShowCartRef.current?.();
      } else if (msg.type === 'hide_cart') {
        onHideCartRef.current?.();
      }
    };

    function connect(transport) {
      // Приветствие уже запрошено (переход на WebSocket посреди старта) —
      // новая сессия здоровается сразу, без ожидания start_greeting.
      const params = new URLSearchParams({
        guestId: guestId ?? '',
        restaurantId: restaurantId ?? '',
        tableNumber: tableNumber ?? '',
        sessionId: sessionId ?? '',
        deferGreeting: prewarm && !greetingRequestedRef.current ? '1' : '0',
        transport,
      });
      const socket = new WebSocket(`${RELAY_WS_URL}?${params}`);
      ws = socket;
      wsRef.current = socket;

      socket.onopen = () => {
        if (stopped || socket !== ws) return;
        // При прогреве под видео шар пока не показывается, статус не важен;
        // «Слушаю…» ставит фаза активации, когда включит микрофон.
        if (!prewarm || activatedRef.current) setStatus('listening');
        if (fallbackReason) {
          socket.send(JSON.stringify({ type: 'client_stats', webrtcFallback: fallbackReason }));
        }
      };
      socket.onclose = () => {
        if (stopped || socket !== ws) return;
        setStatus((s) => (s === 'busy' ? s : 'error'));
      };
      socket.onmessage = (event) => {
        if (stopped || socket !== ws) return;
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        handleMessage(msg);
      };
    }

    connect(typeof window.RTCPeerConnection === 'function' ? 'webrtc' : 'ws');

    // Сводка, как звук играл на телефоне (пишется в лог voice-relay «звук на
    // телефоне»): по WebSocket — опустошения очереди и подвисания вкладки
    // (раз в 5 с, если что-то изменилось), по WebRTC — потери, джиттер,
    // буфер и тип соединения (раз в 15 с).
    let uaSent = false;
    let lastStatsKey = '';
    let tick = 0;
    const statsTimer = setInterval(async () => {
      tick += 1;
      const s = playStatsRef.current;
      if (modeRef.current === 'webrtc') {
        if (tick % WEBRTC_STATS_EVERY !== 0 || !pc || pc.connectionState !== 'connected') return;
        const stats = await collectWebrtcStats(pc).catch(() => null);
        if (!stats) return;
        sendToRelay({
          type: 'client_stats',
          ...stats,
          longFrames: s.longFrames,
          maxFrameMs: Math.round(s.maxFrameMs),
          ua: uaSent ? undefined : navigator.userAgent.slice(0, 160),
        });
        uaSent = true;
        return;
      }
      const key = `${s.underruns}|${s.longFrames}`;
      if (key === lastStatsKey || !ws || ws.readyState !== WebSocket.OPEN) return;
      lastStatsKey = key;
      sendToRelay({
        type: 'client_stats',
        underruns: s.underruns,
        underrunMs: Math.round(s.underrunMs),
        leadMs: Math.round(playbackLeadRef.current * 1000),
        longFrames: s.longFrames,
        maxFrameMs: Math.round(s.maxFrameMs),
        ua: uaSent ? undefined : navigator.userAgent.slice(0, 160),
      });
      uaSent = true;
    }, STATS_INTERVAL_MS);

    return () => {
      stopped = true;
      clearInterval(statsTimer);
      if (removeUnlock) removeUnlock();
      if (rafId) cancelAnimationFrame(rafId);
      attachMicRef.current = null;
      closePc();
      if (remoteAudio) remoteAudio.srcObject = null;
      audioContext.close();
      ws?.close();
    };
  }, [guestId, restaurantId, tableNumber, sessionId]);

  // ФАЗА 2 — АКТИВАЦИЯ: микрофон + сигнал приветствия. Запускается, когда
  // заставка закончилась (prewarm стал false). Микрофон запрашивается
  // ТОЛЬКО здесь, поэтому попап разрешения появляется после анимации, а не
  // во время неё — и он не в критическом пути приветствия (ИИ говорит
  // первым, микрофон ему не нужен).
  useEffect(() => {
    if (prewarm || activatedRef.current) return;
    activatedRef.current = true;
    let stopped = false;

    const sendStartGreeting = () => {
      greetingRequestedRef.current = true;
      const ws = wsRef.current;
      if (!ws) return;
      const send = () => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'start_greeting' }));
      };
      if (ws.readyState === WebSocket.OPEN) send();
      else ws.addEventListener('open', send, { once: true });
    };

    const resumeContext = async () => {
      const ctx = audioContextRef.current;
      if (ctx && ctx.state === 'suspended') {
        try { await ctx.resume(); } catch { /* не критично */ }
      }
    };

    // На iOS звук воспроизведения оживает только когда активна аудио-сессия,
    // а её включает именно захват микрофона (getUserMedia). Поэтому порядок
    // важен: сначала берём микрофон и будим контекст, и ТОЛЬКО ПОТОМ просим
    // приветствие — иначе первые слова ИИ уходят в ещё «спящий» контекст и на
    // айфоне не слышны. echoCancellation/noiseSuppression — чтобы микрофон не
    // ловил голос ассистента из динамика (меньше фонового шума и эха).
    const activate = async () => {
      let micOk = false;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const audioContext = audioContextRef.current;
        if (!audioContext) return;

        // Анализатор микрофона — для бокала и визуализатора (в колонки не
        // идёт: нулевой гейн лишь «тянет» граф, чтобы анализатор обновлялся).
        const source = audioContext.createMediaStreamSource(stream);
        const micAnalyser = audioContext.createAnalyser();
        micAnalyser.fftSize = 256;
        const sink = audioContext.createGain();
        sink.gain.value = 0;
        source.connect(micAnalyser);
        micAnalyser.connect(sink);
        sink.connect(audioContext.destination);
        micAnalyserRef.current = micAnalyser;

        // Микрофон — в текущий транспорт (WebRTC-трек или ScriptProcessor).
        attachMicRef.current?.();
        micOk = true;
      } catch (err) {
        console.error('VoiceStage: не удалось получить микрофон:', err);
      }

      // Будим контекст и просим приветствие ПОСЛЕ попытки микрофона (успешной
      // или нет) — так на iOS воспроизведение выходит из тишины. Даже без
      // микрофона ИИ поздоровается (гость просто не сможет ответить голосом).
      if (stopped) return;
      await resumeContext();
      remoteAudioRef.current?.play().catch(() => {});
      sendStartGreeting();

      if (!stopped) {
        if (micOk) {
          setStatus('listening');
        } else {
          setStatus('error');
          setStatusMessage('Не удалось получить доступ к микрофону.');
        }
      }
    };

    activate();

    return () => {
      stopped = true;
      if (scriptNodeRef.current) {
        scriptNodeRef.current.onaudioprocess = null;
        scriptNodeRef.current.disconnect();
        scriptNodeRef.current = null;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [prewarm]);

  const hasDishes = voiceDishes.length > 0;

  return (
    <div className={styles.stage}>
      {hasDishes && (
        <VoiceDishSlider
          dishes={voiceDishes}
          onDishTap={onExpandDish}
          onClose={() => setVoiceDishes([])}
        />
      )}
      {/* Приёмник WebRTC-потока для Chrome (звук идёт через аудио-граф). */}
      <audio ref={remoteAudioRef} autoPlay playsInline muted />
      {/* Пока на экране карточки блюд, бокал растворяется и не рисуется. */}
      <SmokeGlass
        ref={glassRef}
        initialRole={initialRole}
        active={!hasDishes}
        className={styles.glass}
      />
      <div className={styles.bottom}>
      {hasDishes && <AudioBars getAnalyser={getAnalyser} color={roleColor} />}
      <p className={styles.status}>
        {status === 'connecting' && 'Подключаюсь…'}
        {status === 'listening' && 'Слушаю…'}
        {status === 'busy' && (statusMessage || 'Сейчас все голосовые линии заняты, попробуйте через минуту.')}
        {status === 'error' && (statusMessage || 'Не удалось подключиться. Попробуйте ещё раз.')}
      </p>
      </div>
    </div>
  );
}
