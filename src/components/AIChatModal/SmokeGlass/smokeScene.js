// «Дым в бокале» — визуальная сущность голосового ассистента (three.js r128).
// Перенос прототипа restai-smoke.html: шейдеры и внешний вид — один в один;
// единственное изменение в шейдере дыма — число шагов STEPS задаётся define,
// чтобы на слабых устройствах его можно было уменьшить (34 → 24 → 20).
//
// Без React: createSmokeScene(canvas) → { setRole, setVoice, setAmplitude,
// resize, pause, resume, dispose }. Если WebGL недоступен — бросает ошибку,
// компонент показывает статичную картинку.

import * as THREE from 'three';

// ---------- Palette ----------
const hex = (h) => { const n = parseInt(h.slice(1), 16); return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const C_CHEF = hex('#EB651A');   // цвет логотипа
const C_SOMM = hex('#B0123C');   // бордо
const C_DIET = hex('#4DD17A');   // зелень
export const ROLES = {
  chef: { a: C_CHEF, b: C_CHEF, pair: 0, css: '#EB651A' },
  somm: { a: C_SOMM, b: C_SOMM, pair: 0, css: '#B0123C' },
  diet: { a: C_DIET, b: C_DIET, pair: 0, css: '#4DD17A' },
  pair: { a: C_CHEF, b: C_SOMM, pair: 1, css: '#DA4334' },
};
export const VOICE_STATES = ['idle', 'listen', 'think', 'speak'];

// ---------- Shared GLSL ----------
const NOISE = `
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0);
    const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy));
    vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz);
    vec3 l=1.0-g;
    vec3 i1=min(g.xyz,l.zxy);
    vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx;
    vec3 x2=x0-i2+C.yyy;
    vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857;
    vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z);
    vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy;
    vec4 y=y_*ns.x+ns.yyyy;
    vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy);
    vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0;
    vec4 s1=floor(b1)*2.0+1.0;
    vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
    vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x);
    vec3 p1=vec3(a0.zw,h.y);
    vec3 p2=vec3(a1.xy,h.z);
    vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
    m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }`;

const FULL_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const BG_FRAG = `
      uniform float uAspect; varying vec2 vUv;
      void main(){
        vec2 p = (vUv - vec2(0.5, 0.6)) * vec2(uAspect, 1.0);
        float r = length(p);
        vec3 c0 = vec3(0.008, 0.016, 0.040);
        vec3 c1 = vec3(0.040, 0.078, 0.188);
        vec3 col = mix(c1, c0, smoothstep(0.0, 0.85, r));
        gl_FragColor = vec4(col, 1.0);
      }`;

const SMOKE_VERT = 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';

// STEPS приходит через material.defines (см. выше).
const SMOKE_FRAG = NOISE + `
      uniform float uTime, uPhase, uBob, uLean, uCondense, uGlow, uMix, uFromPair, uToPair;
      uniform vec3 uFromA, uFromB, uToA, uToB;
      varying vec3 vW;
      const float RAD = 1.15;
      mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      vec3 pal(vec3 A, vec3 B, float pair, float s){ return mix(A, B, pair * smoothstep(-0.2, 0.2, s)); }
      void main(){
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vW - ro);
        vec3 c = vec3(0.0, 0.45 + uBob, 0.0);
        vec3 oc = ro - c;
        float b = dot(oc, rd);
        float cc = dot(oc, oc) - RAD * RAD;
        float h = b * b - cc;
        if (h < 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        h = sqrt(h);
        float t0 = max(-b - h, 0.0);
        float t1 = -b + h;
        float dt = (t1 - t0) / float(STEPS);
        float t = t0 + hash(gl_FragCoord.xy) * dt;
        vec3 acc = vec3(0.0);
        float trans = 1.0;
        float edge = mix(-0.35, 1.35, uMix);
        vec3 rad = vec3(0.58, 1.0, 0.58) * mix(1.0, 0.55, uCondense);
        for (int i = 0; i < STEPS; i++) {
          vec3 p = ro + rd * t; t += dt;
          p.y -= uBob;
          vec3 q = p - vec3(0.0, 0.45, 0.0);
          q.z -= uLean * (0.4 + 0.6 * clamp((p.y + 0.4) / 1.8, 0.0, 1.0));
          float ang = uPhase + q.y * 1.4;
          vec2 xz = rot(ang) * q.xz;
          vec3 qs = vec3(xz.x, q.y, xz.y);
          float e = length(qs / rad);
          if (e > 1.0) continue;
          float mask = smoothstep(1.0, 0.45, e);
          vec3 np = vec3(qs.x * 2.4, qs.y * 1.3 - uTime * 0.18, qs.z * 2.4);
          float n1 = snoise(np);
          vec3 wp = np * 1.9 + vec3(n1 * 1.2, 0.0, n1 * 0.8);
          float n2 = snoise(wp + vec3(3.1, -uTime * 0.25, 1.7));
          float ridge = pow(1.0 - abs(n2), 5.0);
          float haze = smoothstep(-0.2, 0.9, n1);
          float d = (ridge * 0.9 + haze * 0.10) * mask;
          float coreD = uCondense * exp(-dot(qs, qs) * 18.0);
          d += coreD * 0.9;
          if (d < 0.003) continue;
          float split = n2 * 0.6 + sin(q.y * 5.0 + atan(xz.y, xz.x)) * 0.6;
          float hn = (p.y + 0.52) / 1.95;
          float k = smoothstep(edge - 0.18, edge + 0.18, hn + n1 * 0.12);
          vec3 col = mix(pal(uToA, uToB, uToPair, split), pal(uFromA, uFromB, uFromPair, split), k);
          col = mix(col, vec3(1.0, 0.9, 0.8), clamp(coreD, 0.0, 1.0) * 0.35);
          float a = d * dt * 4.0;
          acc += col * a * trans;
          trans *= exp(-a * 0.5);
          if (trans < 0.03) break;
        }
        acc *= 0.3 + uGlow * 1.1;
        gl_FragColor = vec4(acc, 1.0);
      }`;

const COMP_FRAG = `
      uniform sampler2D tSmoke; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tSmoke, vUv).rgb;
        c = 1.0 - exp(-c * 1.25);
        gl_FragColor = vec4(c, 1.0);
      }`;

const HALO_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const HALO_FRAG = `
      uniform float uGlow; uniform vec3 uTint; varying vec2 vUv;
      void main(){
        vec2 p = vUv - 0.5; p.y *= 1.15;
        float r = length(p);
        float a = exp(-r * r * 16.0) * 0.13 * uGlow + exp(-r * r * 60.0) * 0.05 * uGlow;
        gl_FragColor = vec4(uTint * a, 1.0);
      }`;

const GLASS_VERT = `
      varying vec3 vN; varying vec3 vW; varying vec3 vL;
      void main(){
        vL = position;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`;
const GLASS_FRAG = `
      uniform float uTime, uGlow, uSpeak, uBandY;
      uniform vec3 uTint;
      varying vec3 vN; varying vec3 vW; varying vec3 vL;
      void main(){
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        float f = pow(1.0 - abs(dot(N, V)), 4.0);
        vec3 cool = vec3(0.50, 0.62, 0.95);
        vec3 col = cool * f * 0.42 + cool * 0.004;
        if (dot(N, V) < 0.0) N = -N;
        vec3 Rf = reflect(-V, N);
        float spec = pow(max(dot(Rf, normalize(vec3(-0.65, 0.45, 0.6))), 0.0), 36.0);
        float spec2 = pow(max(dot(Rf, normalize(vec3(0.7, 0.2, 0.7))), 0.0), 60.0);
        col += vec3(0.85, 0.9, 1.0) * spec * 0.45 + vec3(0.8, 0.85, 1.0) * spec2 * 0.18;
        float bowl = smoothstep(-0.45, -0.3, vL.y) * (1.0 - smoothstep(1.25, 1.42, vL.y));
        col += uTint * bowl * uGlow * 0.10 * (0.3 + f);
        float ang = atan(vL.z, vL.x);
        float band = exp(-pow((vL.y - uBandY) * 7.0, 2.0)) * (0.55 + 0.45 * sin(ang * 2.0 + uTime * 1.7));
        col += uTint * band * bowl * uSpeak * 1.1 * (0.25 + f);
        gl_FragColor = vec4(col, 1.0);
      }`;

// Ступени качества: сверху — максимум (дым в полном разрешении, бокал в
// родном разрешении экрана), вниз — по мере просадки частоты кадров.
// dpr — потолок плотности пикселей, smoke — доля разрешения для дыма.
// В прототипе было dpr ≤ 2, дым в половине разрешения — отсюда «мыло».
const TIERS = [
  { dpr: 3, smoke: 1.0, steps: 34 },
  { dpr: 3, smoke: 0.75, steps: 34 },
  { dpr: 2, smoke: 0.75, steps: 24 },
  { dpr: 2, smoke: 0.5, steps: 24 },
  { dpr: 1.5, smoke: 0.5, steps: 20 },
];
const MIN_FPS = 45;          // ниже — опускаемся на ступень
const SAMPLE_SEC = 1.5;      // окно замера
const SETTLE_SEC = 1.0;      // после смены ступени даём кадрам устояться

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth01 = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
function speechEnv(t, s) {
  const phrase = smooth01((Math.sin(t * 0.7 + s) + 0.35) * 2.0);
  const syl = 0.5 + 0.5 * Math.sin(t * 12.0 + 2.0 * Math.sin(t * 2.7 + s));
  return clamp(phrase * (0.2 + 0.8 * syl * syl) * (0.75 + 0.25 * Math.sin(t * 1.9 + s)), 0, 1);
}

// tier — фиксированная ступень качества (для проверки и снимков); по умолчанию
// ступень подбирается сама по частоте кадров.
export function createSmokeScene(canvas, { onContextLost, onQualityChange, tier: fixedTier = null } = {}) {
  // Без WebGL three бросает — компонент покажет статичную картинку.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 1);

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const U = {
    uTime: { value: 0 }, uPhase: { value: 0 }, uBob: { value: 0 },
    uLean: { value: 0 }, uCondense: { value: 0 }, uGlow: { value: 0.55 },
    uSpeak: { value: 0 }, uBandY: { value: 0 },
    uFromA: { value: C_CHEF.clone() }, uFromB: { value: C_CHEF.clone() }, uFromPair: { value: 0 },
    uToA: { value: C_CHEF.clone() }, uToB: { value: C_CHEF.clone() }, uToPair: { value: 0 },
    uMix: { value: 1 },
    uTint: { value: C_CHEF.clone() },
    uAspect: { value: 1 },
    tSmoke: { value: null },
  };

  // ---------- Cameras & scenes ----------
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bgScene = new THREE.Scene();
  const compScene = new THREE.Scene();
  const smokeScene = new THREE.Scene();
  const scene = new THREE.Scene();

  // Background: чёрно-синий
  bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: U, depthTest: false, depthWrite: false, vertexShader: FULL_VERT, fragmentShader: BG_FRAG,
  })));

  // Smoke (raymarch) — в отдельный буфер, разрешение по ступени качества
  const rt = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });
  U.tSmoke.value = rt.texture;

  const smokeMat = new THREE.ShaderMaterial({
    uniforms: U, depthTest: false, depthWrite: false,
    defines: { STEPS: TIERS[0].steps },
    vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG,
  });
  const smokePlane = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), smokeMat);
  smokeScene.add(smokePlane);

  // Composite: мягко вписываем дым поверх фона
  compScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: U, depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.AdditiveBlending, vertexShader: FULL_VERT, fragmentShader: COMP_FRAG,
  })));

  // ---------- Glass ----------
  const group = new THREE.Group();
  scene.add(group);

  const prof = [
    [0.0, -1.62], [0.50, -1.62], [0.57, -1.605], [0.56, -1.58], [0.40, -1.56], [0.14, -1.52],
    [0.055, -1.44], [0.034, -1.2], [0.034, -0.8], [0.05, -0.62], [0.12, -0.52],
    [0.28, -0.44], [0.46, -0.30], [0.60, -0.08], [0.66, 0.18], [0.67, 0.45],
    [0.645, 0.75], [0.595, 1.05], [0.545, 1.32], [0.53, 1.42],
  ].map((p) => new THREE.Vector2(p[0], p[1]));
  const profPts = new THREE.SplineCurve(prof).getPoints(160);

  const halo = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: HALO_VERT, fragmentShader: HALO_FRAG,
  }));
  halo.position.set(0, 0.0, -1.4);
  group.add(halo);

  const glass = new THREE.Mesh(new THREE.LatheGeometry(profPts, 128), new THREE.ShaderMaterial({
    uniforms: U, side: THREE.DoubleSide, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG,
  }));
  group.add(glass);

  // ---------- Quality / layout ----------
  let tier = 0;
  let width = 1, height = 1;
  const LOOK = new THREE.Vector3(0, -0.3, 0);

  function applySize() {
    const t = TIERS[tier];
    const dpr = Math.min(window.devicePixelRatio || 1, t.dpr);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    rt.setSize(Math.max(2, Math.floor(width * dpr * t.smoke)), Math.max(2, Math.floor(height * dpr * t.smoke)));
    camera.aspect = width / height;
    U.uAspect.value = width / height;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const needH = 5.3, needW = 2.1;
    const dist = Math.max((needH / 2) / tanHalf, (needW / 2) / (tanHalf * camera.aspect));
    const dir = new THREE.Vector3(0, 0.1, 1).normalize();
    camera.position.copy(LOOK).addScaledVector(dir, dist);
    camera.lookAt(LOOK);
    camera.updateProjectionMatrix();
  }

  function setTier(next) {
    tier = clamp(next, 0, TIERS.length - 1);
    if (smokeMat.defines.STEPS !== TIERS[tier].steps) {
      smokeMat.defines.STEPS = TIERS[tier].steps;
      smokeMat.needsUpdate = true; // перекомпиляция шейдера с новым числом шагов
    }
    applySize();
    onQualityChange?.({ tier, ...TIERS[tier] });
  }

  function resize(w, h) {
    width = Math.max(1, Math.round(w));
    height = Math.max(1, Math.round(h));
    applySize();
  }

  // ---------- Controls ----------
  let voice = 'idle', role = 'chef', mixRaw = 1;
  let fromRole = ROLES.chef, toRole = ROLES.chef;

  function setVoice(v) {
    if (VOICE_STATES.includes(v)) voice = v;
  }
  function setRole(r) {
    if (!ROLES[r] || r === role) return;
    if (mixRaw >= 0.5) fromRole = toRole;
    toRole = ROLES[r];
    role = r;
    mixRaw = 0;
    U.uFromA.value.copy(fromRole.a); U.uFromB.value.copy(fromRole.b); U.uFromPair.value = fromRole.pair;
    U.uToA.value.copy(toRole.a); U.uToB.value.copy(toRole.b); U.uToPair.value = toRole.pair;
  }

  // Амплитуда снаружи (микрофон / воспроизводимый голос). Если свежих данных
  // нет дольше AMP_STALE — запасной вариант, имитация речи speechEnv.
  const AMP_STALE = 0.3;
  let extAmp = 0, extAmpAt = -Infinity;
  function setAmplitude(a) {
    extAmp = clamp(Number(a) || 0, 0, 1);
    extAmpAt = performance.now() / 1000;
  }

  // ---------- Animation ----------
  const P = { swirl: 0.15, lean: 0, condense: 0, glow: 0.55, speak: 0 };
  const FAST = { lean: 1, speak: 1 };
  const motion = reduceMotion ? 0.5 : 1;
  const TRANSITION = 2.2; // секунды на смену цвета
  const tintFrom = new THREE.Vector3(), tintTo = new THREE.Vector3();
  const avg = (r, out) => out.copy(r.a).multiplyScalar(1 - 0.5 * r.pair).addScaledVector(r.b, 0.5 * r.pair);
  let last = performance.now(), phase = 0, bandT = 0;
  let rafId = 0, running = false, disposed = false;

  // Замер частоты кадров для ступеней качества
  let sampleStart = 0, sampleFrames = 0, settleUntil = 0;

  function measure(now) {
    if (fixedTier !== null || tier >= TIERS.length - 1) return;
    const t = now / 1000;
    if (t < settleUntil) return;
    if (!sampleStart) { sampleStart = t; sampleFrames = 0; return; }
    sampleFrames++;
    const elapsed = t - sampleStart;
    if (elapsed >= SAMPLE_SEC) {
      const fps = sampleFrames / elapsed;
      sampleStart = 0;
      if (fps < MIN_FPS) {
        setTier(tier + 1);
        settleUntil = t + SETTLE_SEC;
      }
    }
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    measure(now);

    const fresh = t - extAmpAt < AMP_STALE;
    const ampL = fresh ? extAmp : speechEnv(t, 0.0);
    const ampS = fresh ? extAmp : speechEnv(t * 1.1, 2.0);
    let T;
    switch (voice) {
      case 'listen': T = { swirl: 0.25, lean: 0.03 + ampL * 0.07, condense: 0, glow: 0.6 + ampL * 0.35, speak: 0 }; break;
      case 'think': T = { swirl: 1.6, lean: 0, condense: 0.85, glow: 0.7 + 0.08 * Math.sin(t * 5.0), speak: 0 }; break;
      case 'speak': T = { swirl: 0.45, lean: 0, condense: 0.15, glow: 0.55 + ampS * 0.6, speak: ampS }; break;
      default: T = { swirl: 0.15, lean: 0, condense: 0, glow: 0.52 + 0.06 * Math.sin(t * 1.2), speak: 0 };
    }
    for (const k in P) {
      const rate = FAST[k] ? 9 : 2.0;
      P[k] += (T[k] - P[k]) * (1 - Math.exp(-dt * rate));
    }
    // мягкий рост яркости в ответе
    if (voice === 'speak') P.glow += (0.55 + ampS * 0.6 - P.glow) * (1 - Math.exp(-dt * 9));

    mixRaw = Math.min(1, mixRaw + dt / TRANSITION);
    const m = smooth01(mixRaw);

    phase += P.swirl * dt * motion;
    bandT += dt * (0.4 + P.speak * 0.8);

    U.uTime.value = t * (reduceMotion ? 0.5 : 1);
    U.uPhase.value = phase;
    U.uLean.value = P.lean * motion;
    U.uCondense.value = P.condense;
    U.uGlow.value = P.glow;
    U.uSpeak.value = P.speak;
    U.uBandY.value = -0.4 + (bandT % 1.8);
    U.uMix.value = m;
    avg(fromRole, tintFrom); avg(toRole, tintTo);
    U.uTint.value.copy(tintFrom).lerp(tintTo, m);

    const bob = reduceMotion ? 0 : Math.sin(t * 0.6) * 0.035;
    group.position.y = bob;
    U.uBob.value = bob;
    halo.quaternion.copy(camera.quaternion);
    smokePlane.position.set(0, 0.45 + bob, 0);
    smokePlane.quaternion.copy(camera.quaternion);

    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(smokeScene, camera);
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(bgScene, ortho);
    renderer.render(compScene, ortho);
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  }

  function resume() {
    if (running || disposed) return;
    running = true;
    last = performance.now();
    sampleStart = 0;
    settleUntil = last / 1000 + SETTLE_SEC;
    rafId = requestAnimationFrame(frame);
  }
  function pause() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  const onLost = (e) => {
    e.preventDefault();
    pause();
    onContextLost?.();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  function dispose() {
    if (disposed) return;
    pause();
    disposed = true;
    canvas.removeEventListener('webglcontextlost', onLost);
    for (const s of [bgScene, compScene, smokeScene, scene]) {
      s.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    rt.dispose();
    renderer.renderLists.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }

  setTier(fixedTier ?? 0);
  return { setRole, setVoice, setAmplitude, resize, pause, resume, dispose, getQuality: () => ({ tier, ...TIERS[tier] }) };
}
