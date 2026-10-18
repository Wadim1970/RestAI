import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import styles from './SmokeGlass.module.css';

// «Дым в бокале» — визуальная сущность голосового ассистента.
// Снаружи — через ref:
//   setRole('chef' | 'somm' | 'diet' | 'pair')
//   setVoice('idle' | 'listen' | 'think' | 'speak')
//   setAmplitude(0..1)
// Сцена (three.js) грузится отдельным куском и только при показе. Если WebGL
// недоступен или контекст потерян — статичная картинка. Пока вкладка скрыта,
// анимация на паузе; при размонтировании все WebGL-ресурсы освобождаются.

const FALLBACK_SRC = '/assistant/smoke-fallback.webp';

export default function SmokeGlass({ ref, className = '', initialRole = 'chef' }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  // Команды, пришедшие до готовности сцены, — применяем, как только она поднимется.
  const pendingRef = useRef({ role: initialRole, voice: 'idle' });
  const [fallback, setFallback] = useState(false);

  useImperativeHandle(ref, () => ({
    setRole(r) { pendingRef.current.role = r; sceneRef.current?.setRole(r); },
    setVoice(v) { pendingRef.current.voice = v; sceneRef.current?.setVoice(v); },
    setAmplitude(a) { sceneRef.current?.setAmplitude(a); },
  }), []);

  useEffect(() => {
    let cancelled = false;
    let scene = null;
    let ro = null;

    const onVisibility = () => {
      if (!scene) return;
      if (document.hidden) scene.pause();
      else scene.resume();
    };

    import('./smokeScene.js')
      .then(({ createSmokeScene }) => {
        if (cancelled || !canvasRef.current || !wrapRef.current) return;
        try {
          scene = createSmokeScene(canvasRef.current, {
            onContextLost: () => setFallback(true),
          });
        } catch (err) {
          console.warn('SmokeGlass: WebGL недоступен, показываю картинку', err);
          setFallback(true);
          return;
        }
        sceneRef.current = scene;
        scene.setRole(pendingRef.current.role);
        scene.setVoice(pendingRef.current.voice);
        const rect = wrapRef.current.getBoundingClientRect();
        scene.resize(rect.width, rect.height);
        ro = new ResizeObserver(([entry]) => {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) scene.resize(width, height);
        });
        ro.observe(wrapRef.current);
        document.addEventListener('visibilitychange', onVisibility);
        if (!document.hidden) scene.resume();
      })
      .catch((err) => {
        console.warn('SmokeGlass: не удалось загрузить сцену', err);
        if (!cancelled) setFallback(true);
      });

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      ro?.disconnect();
      scene?.dispose();
      sceneRef.current = null;
    };
  }, []);

  return (
    <div ref={wrapRef} className={`${styles.wrap} ${className}`}>
      {fallback ? (
        <img className={styles.fallback} src={FALLBACK_SRC} alt="" aria-hidden="true" />
      ) : (
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          aria-label="Светящийся дым в бокале: цвет показывает, кто отвечает, движение — слушает ассистент или говорит"
          role="img"
        />
      )}
    </div>
  );
}
