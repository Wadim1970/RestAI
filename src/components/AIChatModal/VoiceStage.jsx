import { useEffect, useRef, useState } from 'react';
import styles from './VoiceStage.module.css';

// Пока это визуальный макет: шар реагирует на громкость живого микрофона,
// чтобы можно было согласовать дизайн экрана до подключения Realtime API.
// Реакции на голос самого ИИ здесь ещё нет — появится вместе с реальным
// аудио-потоком от OpenAI на следующем этапе.
export default function VoiceStage() {
  const orbRef = useRef(null);
  const [permission, setPermission] = useState('requesting'); // 'requesting' | 'granted' | 'denied'

  useEffect(() => {
    let stopped = false;
    let stream = null;
    let audioCtx = null;
    let rafId = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setPermission('granted');

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const level = Math.min(1, Math.sqrt(sum / data.length) * 4);
          if (orbRef.current) {
            orbRef.current.style.transform = `scale(${1 + level * 0.6})`;
            orbRef.current.style.opacity = String(0.6 + level * 0.4);
          }
          rafId = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        if (!stopped) setPermission('denied');
      }
    })();

    return () => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
      audioCtx?.close();
    };
  }, []);

  return (
    <div className={styles.stage}>
      <div className={styles.orbWrap}>
        <div className={styles.orb} ref={orbRef} />
      </div>
      <p className={styles.status}>
        {permission === 'requesting' && 'Запрашиваю доступ к микрофону…'}
        {permission === 'granted' && 'Слушаю…'}
        {permission === 'denied' && 'Нет доступа к микрофону. Разрешите доступ в настройках браузера.'}
      </p>
    </div>
  );
}
