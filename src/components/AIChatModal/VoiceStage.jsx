import { useEffect, useRef, useState } from 'react';
import VoiceDishSlider from '../VoiceDishSlider/VoiceDishSlider';
import styles from './VoiceStage.module.css';

const RELAY_WS_URL = import.meta.env.VITE_VOICE_RELAY_URL || 'wss://voice.restai.space/voice';

// Максимальная громкость голоса ИИ без хрипа. Простое усиление резало
// пики (громкие согласные, восклицания) — поэтому перед усилением стоит
// компрессор-лимитер: сильно прижимает самые громкие места, и уже после
// этого можно поднять общий уровень намного выше без искажений.
// PLAYBACK_GAIN — makeup-усиление ПОСЛЕ компрессора. Здесь выкручено
// высоко (громко почти на максимум); если где-то начнёт хрипеть —
// снижать в первую очередь его, потом трогать порог компрессора.
const PLAYBACK_GAIN = 6.0;

// «Лимитер для громкости»: очень сильное сжатие (ratio 20) всего, что
// громче низкого порога, мгновенный attack — ловит резкие пики речи до
// того, как их усилит makeup. Динамика становится ровной, зато можно
// безопасно поднять общий уровень. Ровный звук для ассистента в шумном
// зале — плюс, речь разборчивее.
const COMPRESSOR = { threshold: -30, knee: 20, ratio: 20, attack: 0.002, release: 0.25 };

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

// Реальный голосовой разговор: микрофон гостя течёт в voice-relay
// (wss://voice.restai.space/voice) и обратно, звук ИИ проигрывается тут же.
// Шар реагирует на то, чья сейчас реплика активна — гостя или ИИ,
// переключение неявное (кто последний писал в аудио-график, тот и ведёт).
//
// ScriptProcessorNode официально deprecated в пользу AudioWorklet, но пока
// работает во всех нужных браузерах и не требует отдельного модуля-файла —
// смена на AudioWorklet имеет смысл отдельной задачей, если понадобится
// снять работу с основного потока.
export default function VoiceStage({ guestId, restaurantId, tableNumber, sessionId, prewarm = false, onExpandDish, onCartAdd, onShowCart }) {
  const orbRef = useRef(null);
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
  onCartAddRef.current = onCartAdd;
  onShowCartRef.current = onShowCart;

  const setLevel = (level) => {
    if (!orbRef.current) return;
    orbRef.current.style.transform = `scale(${1 + level * 0.6})`;
    orbRef.current.style.opacity = String(0.6 + level * 0.4);
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

  // ФАЗА 1 — соединение и ВОСПРОИЗВЕДЕНИЕ (без микрофона). Запускается при
  // монтировании: под видео-заставкой (prewarm) это и есть «прогрев» —
  // WebSocket, сессия Grok и загрузка контекста готовятся заранее, а само
  // приветствие откладывается (deferGreeting) до сигнала из фазы 2.
  // prewarm читается один раз при монтировании — смена флага НЕ пересоздаёт
  // соединение (иначе прогрев был бы бессмысленным).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let stopped = false;
    let rafId = null;
    let outputAnalyser = null;
    let compressor = null;
    let playbackGain = null;
    let removeUnlock = null;

    // Уровень звука ИИ — из живого аудио-графа через AnalyserNode и rAF,
    // а не из момента прихода куска по сети (тот уже отыгрывает из очереди).
    const visualLoop = () => {
      if (aiSpeakingRef.current && outputAnalyser) {
        const data = new Uint8Array(outputAnalyser.frequencyBinCount);
        outputAnalyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      }
      rafId = requestAnimationFrame(visualLoop);
    };

    const playChunk = (base64Audio) => {
      const audioContext = audioContextRef.current;
      if (!audioContext) return;
      const float32 = pcm16Base64ToFloat32(base64Audio);
      if (float32.length === 0) return;

      const buffer = audioContext.createBuffer(1, float32.length, 24000);
      buffer.copyToChannel(float32, 0);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(compressor);

      const startAt = Math.max(audioContext.currentTime, nextPlaybackTimeRef.current);
      source.start(startAt);
      nextPlaybackTimeRef.current = startAt + buffer.duration;

      aiSpeakingRef.current = true;
      source.onended = () => {
        if (audioContext.currentTime >= nextPlaybackTimeRef.current - 0.02) aiSpeakingRef.current = false;
      };
    };

    // Раньше AudioContext разблокировал клик по кнопке «войти». Кнопки
    // больше нет — заставка стартует сама после скана QR, поэтому контекст
    // создаём здесь, а разблокировку звука вешаем на первое касание экрана
    // (см. unlockAudio ниже).
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioContextRef.current = audioContext;

    // Цепочка воспроизведения: кусок -> compressor -> playbackGain (громкость)
    // -> outputAnalyser (визуализация шара) -> колонки. Компрессор ДО
    // усиления, чтобы не резать пики.
    compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = COMPRESSOR.threshold;
    compressor.knee.value = COMPRESSOR.knee;
    compressor.ratio.value = COMPRESSOR.ratio;
    compressor.attack.value = COMPRESSOR.attack;
    compressor.release.value = COMPRESSOR.release;
    playbackGain = audioContext.createGain();
    playbackGain.gain.value = PLAYBACK_GAIN;
    outputAnalyser = audioContext.createAnalyser();
    outputAnalyser.fftSize = 256;
    compressor.connect(playbackGain);
    playbackGain.connect(outputAnalyser);
    outputAnalyser.connect(audioContext.destination);
    rafId = requestAnimationFrame(visualLoop);

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
    };
    const unlockEvents = ['pointerdown', 'touchend', 'click'];
    unlockEvents.forEach((e) => document.addEventListener(e, unlockAudio, { once: true, passive: true }));
    removeUnlock = () => unlockEvents.forEach((e) => document.removeEventListener(e, unlockAudio));

    const params = new URLSearchParams({
      guestId: guestId ?? '',
      restaurantId: restaurantId ?? '',
      tableNumber: tableNumber ?? '',
      sessionId: sessionId ?? '',
      deferGreeting: prewarm ? '1' : '0',
    });
    const ws = new WebSocket(`${RELAY_WS_URL}?${params}`);
    wsRef.current = ws;

    ws.onopen = () => {
      // При прогреве под видео шар пока не показывается, статус не важен;
      // «Слушаю…» ставит фаза активации, когда включит микрофон.
      if (!stopped && !prewarm) setStatus('listening');
    };
    ws.onclose = () => {
      if (stopped) return;
      setStatus((s) => (s === 'busy' ? s : 'error'));
    };
    ws.onmessage = (event) => {
      if (stopped) return;
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'audio' && msg.data) {
        playChunk(msg.data);
      } else if (msg.type === 'error' && msg.code === 'busy') {
        setStatus('busy');
        setStatusMessage(msg.message || '');
      } else if (msg.type === 'show_dish') {
        setVoiceDishes(Array.isArray(msg.dishes) ? msg.dishes : []);
      } else if (msg.type === 'hide_dish') {
        setVoiceDishes([]);
      } else if (msg.type === 'cart_add' && Array.isArray(msg.items)) {
        onCartAddRef.current?.(msg.items);
      } else if (msg.type === 'show_cart') {
        onShowCartRef.current?.();
      }
    };

    return () => {
      stopped = true;
      if (removeUnlock) removeUnlock();
      if (rafId) cancelAnimationFrame(rafId);
      audioContext.close();
      ws.close();
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
      const ws = wsRef.current;
      if (!ws) return;
      const send = () => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'start_greeting' }));
      };
      if (ws.readyState === WebSocket.OPEN) send();
      else ws.addEventListener('open', send, { once: true });
    };

    const activate = async () => {
      // Приветствие можно просить сразу — оно не ждёт микрофона.
      sendStartGreeting();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const audioContext = audioContextRef.current;
        if (!audioContext) return;
        if (audioContext.state === 'suspended') audioContext.resume();

        const source = audioContext.createMediaStreamSource(stream);
        // ScriptProcessorNode подключаем к destination через нулевой гейн —
        // иначе onaudioprocess не гарантированно срабатывает, но эхо своего
        // микрофона гость слышать не должен.
        const scriptNode = audioContext.createScriptProcessor(4096, 1, 1);
        scriptNodeRef.current = scriptNode;
        const silentGain = audioContext.createGain();
        silentGain.gain.value = 0;
        source.connect(scriptNode);
        scriptNode.connect(silentGain);
        silentGain.connect(audioContext.destination);

        scriptNode.onaudioprocess = (event) => {
          const ws = wsRef.current;
          if (stopped || !ws || ws.readyState !== WebSocket.OPEN) return;
          const input = event.inputBuffer.getChannelData(0);
          if (!aiSpeakingRef.current) setLevel(rmsLevel(input));
          const resampled = resampleTo24k(input, audioContext.sampleRate);
          ws.send(JSON.stringify({ type: 'audio', data: float32ToPcm16Base64(resampled) }));
        };

        if (!stopped) setStatus('listening');
      } catch (err) {
        console.error('VoiceStage: не удалось получить микрофон:', err);
        if (!stopped) {
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
      <div className={`${styles.orbWrap} ${hasDishes ? styles.orbWrapCompact : ''}`}>
        <div className={styles.orb} ref={orbRef} />
      </div>
      <p className={styles.status}>
        {status === 'connecting' && 'Подключаюсь…'}
        {status === 'listening' && 'Слушаю…'}
        {status === 'busy' && (statusMessage || 'Сейчас все голосовые линии заняты, попробуйте через минуту.')}
        {status === 'error' && (statusMessage || 'Не удалось подключиться. Попробуйте ещё раз.')}
      </p>
    </div>
  );
}
