import { useEffect, useRef } from 'react';
import styles from './AudioBars.module.css';

// Аудиовизуализатор под карточками блюд: столбики по частотам того, что
// звучит сейчас — голос ассистента или микрофон гостя. getAnalyser()
// возвращает актуальный AnalyserNode (или null — тогда столбики опадают).
// Рисуется на 2D-canvas: легко для видеокарты, звук не страдает.

const BARS = 21;

export default function AudioBars({ getAnalyser, color = '#EB651A' }) {
  const canvasRef = useRef(null);
  const colorRef = useRef(color);
  useEffect(() => { colorRef.current = color; }, [color]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const levels = new Float32Array(BARS);
    let data = null;
    let raf = 0;

    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);

    const draw = () => {
      const analyser = getAnalyser?.();
      const w = canvas.width, h = canvas.height;
      if (analyser) {
        if (!data || data.length !== analyser.frequencyBinCount) data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
      }
      // Голос — примерно до 4 кГц: берём нижнюю часть спектра, зеркально от центра.
      const half = Math.ceil(BARS / 2);
      for (let i = 0; i < half; i++) {
        let v = 0;
        if (analyser && data) {
          const bin = Math.floor((i / half) * data.length * 0.35);
          v = data[bin] / 255;
        }
        for (const idx of [half - 1 - i, half - 1 + i]) {
          if (idx < 0 || idx >= BARS) continue;
          const target = Math.max(0.06, v * (1 - i / (half * 1.6)));
          levels[idx] += (target - levels[idx]) * (target > levels[idx] ? 0.45 : 0.12);
        }
      }
      ctx.clearRect(0, 0, w, h);
      const gap = w / BARS;
      const bw = gap * 0.46;
      ctx.fillStyle = colorRef.current;
      for (let i = 0; i < BARS; i++) {
        const bh = Math.max(bw, levels[i] * h);
        const x = i * gap + (gap - bw) / 2;
        const y = (h - bh) / 2;
        ctx.globalAlpha = 0.55 + levels[i] * 0.45;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, bw / 2);
        else ctx.rect(x, y, bw, bh);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [getAnalyser]);

  return <canvas ref={canvasRef} className={styles.bars} aria-hidden="true" />;
}
