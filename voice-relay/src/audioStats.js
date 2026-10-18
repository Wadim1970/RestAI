// Мелкие расчёты по кускам PCM16 (24 кГц, моно, base64) — для замеров
// задержки/обрывов голоса и для режима «тишина в микрофон, пока ИИ говорит».

const SAMPLE_RATE = 24000;

function decodedBytes(base64) {
  const len = base64.length;
  if (!len) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

// Длительность куска в миллисекундах.
export function pcm16DurationMs(base64) {
  return (decodedBytes(base64) / 2 / SAMPLE_RATE) * 1000;
}

// Громкость куска (RMS, 0…1).
export function pcm16Rms(base64) {
  const buf = Buffer.from(base64, 'base64');
  const samples = Math.floor(buf.length / 2);
  if (!samples) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const v = buf.readInt16LE(i * 2) / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / samples);
}

// Тишина той же длины, что и кусок (поток микрофона не рвётся по времени).
export function pcm16Silence(base64) {
  return Buffer.alloc(decodedBytes(base64)).toString('base64');
}
