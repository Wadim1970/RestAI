import { useEffect, useRef, useState } from 'react';
import VoiceDishSlider from '../VoiceDishSlider/VoiceDishSlider';
import styles from './VoiceStage.module.css';

const RELAY_WS_URL = import.meta.env.VITE_VOICE_RELAY_URL || 'wss://voice.restai.space/voice';
const MAX_VOICE_DISHES = 4;

// Новое/повторно названное блюдо всегда уходит в конец массива — так
// "последний элемент" однозначно значит "то, о чём ИИ говорит сейчас",
// не важно, впервые показано блюдо или ассистент вернулся к нему снова
// (см. VoiceDishSlider — куб поворачивается именно к последнему).
function addVoiceDish(prev, dish) {
  const next = [...prev.filter((d) => d.id !== dish.id), dish];
  return next.length > MAX_VOICE_DISHES ? next.slice(next.length - MAX_VOICE_DISHES) : next;
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

// Реальный голосовой разговор: микрофон гостя течёт в voice-relay
// (wss://voice.restai.space/voice) и обратно, звук ИИ проигрывается тут же.
// Шар реагирует на то, чья сейчас реплика активна — гостя или ИИ,
// переключение неявное (кто последний писал в аудио-график, тот и ведёт).
//
// ScriptProcessorNode официально deprecated в пользу AudioWorklet, но пока
// работает во всех нужных браузерах и не требует отдельного модуля-файла —
// смена на AudioWorklet имеет смысл отдельной задачей, если понадобится
// снять работу с основного потока.
export default function VoiceStage({ guestId, restaurantId, tableNumber, onExpandDish }) {
  const orbRef = useRef(null);
  const [status, setStatus] = useState('connecting'); // 'connecting' | 'listening' | 'busy' | 'error'
  const [statusMessage, setStatusMessage] = useState('');
  // Блюда, которые ИИ показал за этот разговор (show_dish_card/
  // hide_dish_card) — локальное состояние, не в App.jsx: живёт и умирает
  // вместе с самим голосовым разговором, отдельного сброса не требует.
  const [voiceDishes, setVoiceDishes] = useState([]);

  useEffect(() => {
    let stopped = false;
    let stream = null;
    let audioContext = null;
    let scriptNode = null;
    let outputAnalyser = null;
    let ws = null;
    let aiSpeaking = false;
    let nextPlaybackTime = 0;
    let rafId = null;

    const setLevel = (level) => {
      if (!orbRef.current) return;
      orbRef.current.style.transform = `scale(${1 + level * 0.6})`;
      orbRef.current.style.opacity = String(0.6 + level * 0.4);
    };

    // Уровень звука ИИ брался раньше из каждого пришедшего по WS куска —
    // но кусок уже отыгрывает секунду-другую из очереди (нашедшая
    // очередь через nextPlaybackTime), пока следующий может задержаться
    // из-за сети/генерации. Экран из-за этого "подвисал" на середине
    // фразы: звук ещё играет, а обновлений уровня уже нет. Правильный
    // источник — не момент прихода сообщения, а сам живой аудио-граф
    // прямо сейчас, через AnalyserNode и непрерывный rAF-цикл.
    const visualLoop = () => {
      if (aiSpeaking && outputAnalyser) {
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
      const float32 = pcm16Base64ToFloat32(base64Audio);
      if (float32.length === 0) return;

      const buffer = audioContext.createBuffer(1, float32.length, 24000);
      buffer.copyToChannel(float32, 0);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(outputAnalyser);

      const startAt = Math.max(audioContext.currentTime, nextPlaybackTime);
      source.start(startAt);
      nextPlaybackTime = startAt + buffer.duration;

      aiSpeaking = true;
      source.onended = () => {
        // Это была последняя запланированная реплика ИИ — отдаём "ведение"
        // обратно микрофону гостя.
        if (audioContext.currentTime >= nextPlaybackTime - 0.02) aiSpeaking = false;
      };
    };

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);

        // ScriptProcessorNode должен быть подключен до destination, иначе
        // onaudioprocess не гарантированно срабатывает — гасим гейном в 0,
        // чтобы гость не слышал эхо собственного микрофона.
        scriptNode = audioContext.createScriptProcessor(4096, 1, 1);
        const silentGain = audioContext.createGain();
        silentGain.gain.value = 0;
        source.connect(scriptNode);
        scriptNode.connect(silentGain);
        silentGain.connect(audioContext.destination);

        // Через этот узел проходит воспроизводимый звук ИИ — им и кормим
        // непрерывный визуальный цикл (см. visualLoop выше), а не разовыми
        // снимками уровня в момент прихода каждого куска по сети.
        outputAnalyser = audioContext.createAnalyser();
        outputAnalyser.fftSize = 256;
        outputAnalyser.connect(audioContext.destination);
        rafId = requestAnimationFrame(visualLoop);

        const params = new URLSearchParams({
          guestId: guestId ?? '',
          restaurantId: restaurantId ?? '',
          tableNumber: tableNumber ?? '',
        });
        ws = new WebSocket(`${RELAY_WS_URL}?${params}`);

        ws.onopen = () => {
          if (!stopped) setStatus('listening');
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
          } else if (msg.type === 'show_dish' && msg.dish) {
            setVoiceDishes((prev) => addVoiceDish(prev, msg.dish));
          } else if (msg.type === 'hide_dish') {
            setVoiceDishes([]);
          }
        };

        scriptNode.onaudioprocess = (event) => {
          if (stopped || !ws || ws.readyState !== WebSocket.OPEN) return;
          const input = event.inputBuffer.getChannelData(0);
          if (!aiSpeaking) setLevel(rmsLevel(input));
          const resampled = resampleTo24k(input, audioContext.sampleRate);
          ws.send(JSON.stringify({ type: 'audio', data: float32ToPcm16Base64(resampled) }));
        };
      } catch (err) {
        console.error('VoiceStage: не удалось запустить голосовую сессию:', err);
        if (!stopped) {
          setStatus('error');
          setStatusMessage('Не удалось получить доступ к микрофону.');
        }
      }
    };

    start();

    return () => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (scriptNode) scriptNode.onaudioprocess = null;
      scriptNode?.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
      audioContext?.close();
      ws?.close();
    };
  }, [guestId, restaurantId, tableNumber]);

  return (
    <div className={styles.stage}>
      <VoiceDishSlider
        dishes={voiceDishes}
        onDishTap={onExpandDish}
        onClose={() => setVoiceDishes([])}
      />
      <div className={styles.orbWrap}>
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
