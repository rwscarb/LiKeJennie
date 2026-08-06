// ─────────────────────────────────────────────────────────────────────────────
//  SCENE 21 — P-wave Early Detection
//
//  Live seismogram scrolling right-to-left.
//  StreamDetector fires within 1s of P-arrival, giving >8s warning before S.
//
//  Layout:
//    TOP CENTRE   — Seismogram canvas (DISP_S-second scrolling window)
//    RIGHT        — Warning / countdown display
//    LEFT         — Accuracy bars (BASE 87.4% vs TRI 88.4%) + orbit ring
//    FLOOR        — Grid with flat labels
//    3D MARKERS   — P (green) and S (orange) thin planes track the waveform
// ─────────────────────────────────────────────────────────────────────────────
import { THREE, R, mkCamera, mkControls, CG, CC, CY, CO } from './shared.js';

// ── Physics constants ─────────────────────────────────────────────────────────
const TP       = 10.0;  // P-wave arrival (s)
const TS       = 20.5;  // S-wave arrival (s)  — 10.5 s gap ≈ >8 s after detection
const T_LOOP   = 38.0;  // simulation loop period
const DISP_S   = 24.0;  // seconds visible in canvas window
const HZ       = 80;    // internal sample rate

// ── Waveform synthesis (deterministic — no Math.random) ───────────────────────
function synthClean(t) {
  const ph = t % T_LOOP;
  const bg = 0.04 * Math.sin(t * 197.3) + 0.03 * Math.sin(t * 83.1 + 1.1)
           + 0.025 * Math.sin(t * 41.7 + 2.3);
  if (ph < TP - 0.05) {
    return bg * 0.5;
  } else if (ph < TP + 1.2) {
    const dt = ph - TP;
    const env = Math.min(dt * 5, 1.0) * Math.exp(-dt * 1.2);
    return env * (Math.sin(dt * Math.PI * 15) * 0.55 + Math.sin(dt * Math.PI * 9) * 0.28) + bg * 0.4;
  } else if (ph < TS) {
    const dt = ph - (TP + 1.2);
    return Math.exp(-dt * 0.5) * 0.22 * Math.sin(dt * Math.PI * 5.5) + bg * 0.3;
  } else if (ph < TS + 7.0) {
    const dt = ph - TS;
    const env = Math.min(dt * 1.5, 1.0) * Math.exp(-dt * 0.28);
    return env * (Math.sin(dt * Math.PI * 3.5) * 1.3 + Math.sin(dt * Math.PI * 2.0) * 0.55) + bg * 0.25;
  } else {
    const dt = ph - (TS + 7.0);
    return Math.exp(-dt * 0.22) * 0.35 * Math.sin(dt * Math.PI * 2.2 + 0.4) + bg * 0.2;
  }
}

// Pre-compute one full loop so canvas reads are O(1)
const N_PRE = Math.ceil(T_LOOP * HZ);
const preWave = new Float32Array(N_PRE);
for (let i = 0; i < N_PRE; i++) preWave[i] = synthClean(i / HZ);

// Deterministic noise layer added at runtime
function addNoise(v, t, sigma) {
  return v + sigma * 0.28 * Math.sin(t * 1237.7 + 0.1) * Math.sin(t * 313.3 + 0.7);
}

// ── STA/LTA Detector ─────────────────────────────────────────────────────────
// Industry-standard P-wave picker: ratio of short-term to long-term energy.
// Fires when STA/LTA > TRIGGER (energy onset = P-arrival).
const STA_WIN         = 0.5;   // short window (s) — sensitive to onset
const LTA_WIN         = 8.0;   // long window (s)  — background energy baseline
const STA_LTA_TRIGGER = 3.2;
const N_STA = Math.ceil(STA_WIN * HZ);  // 40 samples
const N_LTA = Math.ceil(LTA_WIN * HZ);  // 640 samples

// Pre-compute ratio on clean (sigma=0) signal for canvas overlay — one-time cost
const preRatio = new Float32Array(N_PRE);
for (let i = 0; i < N_PRE; i++) {
  let sSTA = 0, sLTA = 0;
  for (let j = 0; j < N_LTA; j++) {
    const v = preWave[(i - j + N_PRE) % N_PRE];
    const v2 = v * v;
    if (j < N_STA) sSTA += v2;
    sLTA += v2;
  }
  preRatio[i] = sLTA > 0.001
    ? Math.sqrt(sSTA / N_STA) / Math.sqrt(sLTA / N_LTA)
    : 0;
}

// T_DETECT: actual detection time from clean STA/LTA (replaces hardcoded TP+0.5)
let T_DETECT = TP + 0.6;  // fallback; overwritten below
for (let i = Math.ceil((TP + 0.05) * HZ); i < N_PRE; i++) {
  if (preRatio[i] >= STA_LTA_TRIGGER) { T_DETECT = i / HZ; break; }
}

// Live STA/LTA at absT with current noise (called once per frame in detection window)
function staLtaLive(absT, sigma) {
  let sSTA = 0, sLTA = 0;
  for (let j = 0; j < N_LTA; j++) {
    const t = absT - j / HZ;
    const idx = ((Math.floor(t * HZ) % N_PRE) + N_PRE) % N_PRE;
    const v = addNoise(preWave[idx], t, sigma);
    const v2 = v * v;
    if (j < N_STA) sSTA += v2;
    sLTA += v2;
  }
  return sLTA > 0.001
    ? Math.sqrt(sSTA / N_STA) / Math.sqrt(sLTA / N_LTA)
    : 0;
}

// ── Build ─────────────────────────────────────────────────────────────────────
export function buildS21() {
  const ov = R.ov;
  const scene = R.scene = new THREE.Scene();
  const camera = R.camera = mkCamera();
  // Camera offset to the left so z-layers read as depth, not overlap
  camera.position.set(0, 4.6, 10.8);
  camera.lookAt(0.5, 1.0, -2);
  const controls = R.controls = mkControls(camera);
  controls.autoRotate = false;
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.42));
  const pl1 = new THREE.PointLight(CG,  4.0, 70); pl1.position.set(-6, 5, 3);  scene.add(pl1);
  const pl2 = new THREE.PointLight(CO,  2.8, 55); pl2.position.set( 6, 4, 3);  scene.add(pl2);
  const pl3 = new THREE.PointLight(CY,  2.0, 40); pl3.position.set( 0,-2, 6);  scene.add(pl3);
  const pl4 = new THREE.PointLight(CG,  1.5, 30); pl4.position.set( 0, 3,-5);  scene.add(pl4);

  const grid = new THREE.GridHelper(32, 32, 0x0a1a0a, 0x050f05);
  grid.position.y = -0.5;
  scene.add(grid);

  // ── Layout ── Z-layers: waveform(−4) → slabs(−3) → orbit(0) → bars/warn(+3) ──
  const WAVE_W  = 10.0;   // waveform plane world width
  const WAVE_H  =  2.8;   // waveform plane world height
  const WAVE_Y  =  3.2;   // y centre of waveform plane
  const WAVE_Z  = -4.0;   // pushed back — background layer
  const ACC_CX  = -5.2;   // accuracy bar cluster centre x
  const ACC_BASE=  0.0;
  const ACC_MAX =  3.2;
  const ACC_Z   =  2.8;   // foreground layer
  const WARN_X  =  4.8;   // warning display centre x — pulled in from far edge
  const WARN_Y  =  3.8;
  const WARN_Z  =  2.8;
  const ORBIT_CX= -3.0;   // moved toward centre so scene isn't lopsided
  const ORBIT_Y =  2.0;
  const ORBIT_Z =  0.0;   // midground
  const ORBIT_R =  2.2;

  // ── Labels — leaning signs (not flat floor decals) ───────────────────────────
  // rotX: lean from vertical toward camera; rotY: face direction
  function mkSign(text, x, y, z, rotX, rotY, color, fs = 13, cw = 256, ch = 48) {
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    ctx.fillStyle = color; ctx.font = `bold ${fs}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, cw / 2, ch / 2);
    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(cw / 48, ch / 48);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    R.disposables.push(tex, geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = rotX; m.rotation.y = rotY;
    m.position.set(x, y, z);
    scene.add(m); return m;
  }

  // Camera at (-2, 5.5, 16); camera elevation angle to floor labels ≈ 14°
  // All floor labels: rotY=0 (face +Z, parallel to grid), rotX=-0.28 (slight lean
  // toward camera for legibility). No per-sign rotY skew.
  const LEAN    = -0.24;  // title lean (slight, near camera)
  const TILT    = -0.28;  // floor label lean — matches camera elevation from floor
  const FLOOR_Y = -0.44;

  // Bar labels — rotY=0, face straight toward camera (+Z direction)
  const FLOOR_Z = ACC_Z - 0.1;
  mkSign('H+0.0 98.3%', ACC_CX - 1.3, FLOOR_Y, FLOOR_Z, TILT, 0, '#00e5ff', 12, 120, 38);
  mkSign('H-0.5 98.8%', ACC_CX + 1.3, FLOOR_Y, FLOOR_Z, TILT, 0, '#00ff88', 12, 120, 38);
  mkSign('AUC (3-seed avg)', ACC_CX, FLOOR_Y - 0.35, FLOOR_Z, TILT, 0, '#446655', 10, 200, 30);

  // Floor labels — all rotY=0, TILT lean, at similar z so they read as a cohesive set.
  // SEISMOGRAM right edge ≈ x=3.17; P-WAVE left edge ≈ x=3.5 → 0.33 gap between them.
  mkSign('STREAM ORBIT',     ORBIT_CX, FLOOR_Y, 1.2,   TILT, 0, '#ffe600', 15, 256, 50);
  mkSign('SEISMOGRAM',       0.5,      FLOOR_Y, -0.5,  TILT, 0, '#33cc66', 15, 256, 50);
  mkSign('PRE-P DETECTION', 6.0,      FLOOR_Y, -0.5,  TILT, 0, '#00ff88', 14, 240, 46);
  mkSign('H-0.5s beats baseline', 6.0, FLOOR_Y - 0.35, -0.5, TILT, 0, '#336644', 10, 256, 30);

  // ── Waveform canvas plane ────────────────────────────────────────────────────
  const WV_CW = 1024, WV_CH = 256;
  const wvCanvas = document.createElement('canvas');
  wvCanvas.width = WV_CW; wvCanvas.height = WV_CH;
  const wvCtx = wvCanvas.getContext('2d');
  const wvTex = new THREE.CanvasTexture(wvCanvas);
  const wvGeo = new THREE.PlaneGeometry(WAVE_W, WAVE_H);
  const wvMat = new THREE.MeshBasicMaterial({ map: wvTex, transparent: true, opacity: 0.96, depthWrite: false });
  R.disposables.push(wvGeo, wvMat, wvTex);
  const wvMesh = new THREE.Mesh(wvGeo, wvMat);
  wvMesh.position.set(0, WAVE_Y, WAVE_Z);
  scene.add(wvMesh);

  // Which loop-relative arrival times fall inside the current window?
  function arrivalsInWindow(loopOffset, simT) {
    const lo = simT - DISP_S;
    const times = [];
    const k0 = Math.floor(lo / T_LOOP), k1 = Math.ceil(simT / T_LOOP);
    for (let k = k0; k <= k1; k++) {
      const t = k * T_LOOP + loopOffset;
      if (t >= lo && t <= simT + 0.5) times.push(t);
    }
    return times;
  }

  function tToCanvasX(t, simT) {
    return WV_CW * (1 - (simT - t) / DISP_S);
  }

  function drawWaveform(simT, detected, sigma) {
    const W = WV_CW, H = WV_CH;
    wvCtx.fillStyle = '#010d01';
    wvCtx.fillRect(0, 0, W, H);

    // Faint horizontal grid lines
    wvCtx.strokeStyle = '#061506'; wvCtx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach(g => {
      wvCtx.beginPath(); wvCtx.moveTo(0, H * g); wvCtx.lineTo(W, H * g); wvCtx.stroke();
    });

    // P-wave region bands
    for (const pt of arrivalsInWindow(TP, simT)) {
      const px = tToCanvasX(pt, simT);
      const px2 = tToCanvasX(pt + 1.2, simT);
      if (px2 > 0 && px < W) {
        wvCtx.fillStyle = 'rgba(0,255,136,0.07)';
        wvCtx.fillRect(Math.max(0, px), 0, Math.min(W, px2) - Math.max(0, px), H);
        if (px > 0 && px < W) {
          wvCtx.strokeStyle = '#00ff8855'; wvCtx.lineWidth = 1;
          wvCtx.beginPath(); wvCtx.moveTo(px, 0); wvCtx.lineTo(px, H); wvCtx.stroke();
          wvCtx.fillStyle = '#00ff8899'; wvCtx.font = '10px monospace'; wvCtx.textAlign = 'left';
          wvCtx.fillText('P', px + 3, H - 8);
        }
      }
    }

    // S-wave region bands
    for (const st of arrivalsInWindow(TS, simT)) {
      const sx = tToCanvasX(st, simT);
      if (sx > 0 && sx < W) {
        wvCtx.fillStyle = 'rgba(255,150,0,0.07)';
        wvCtx.fillRect(sx, 0, Math.min(W - sx, (7.0 / DISP_S) * W), H);
        wvCtx.strokeStyle = '#ff980055'; wvCtx.lineWidth = 1;
        wvCtx.beginPath(); wvCtx.moveTo(sx, 0); wvCtx.lineTo(sx, H); wvCtx.stroke();
        wvCtx.fillStyle = '#ff980099'; wvCtx.font = '10px monospace'; wvCtx.textAlign = 'left';
        wvCtx.fillText('S', sx + 3, H - 8);
      }
    }

    // Detection markers
    if (detected) {
      for (const dt of arrivalsInWindow(T_DETECT, simT)) {
        const dx = tToCanvasX(dt, simT);
        if (dx > 0 && dx < W) {
          wvCtx.strokeStyle = '#ffe600cc'; wvCtx.lineWidth = 2;
          wvCtx.setLineDash([4, 4]);
          wvCtx.beginPath(); wvCtx.moveTo(dx, 0); wvCtx.lineTo(dx, H); wvCtx.stroke();
          wvCtx.setLineDash([]);
          wvCtx.fillStyle = '#ffe600'; wvCtx.font = 'bold 10px monospace'; wvCtx.textAlign = 'left';
          wvCtx.fillText('▲ DETECT', dx + 3, 14);
        }
      }
    }

    // Waveform history
    const nHist = Math.ceil(DISP_S * HZ);
    const curIdx = Math.floor(simT * HZ);
    wvCtx.beginPath();
    let first = true;
    for (let i = 0; i < nHist; i++) {
      const sIdx = ((curIdx - (nHist - i)) % N_PRE + N_PRE) % N_PRE;
      const tAbs = simT - (nHist - i) / HZ;
      const v = addNoise(preWave[sIdx], tAbs, sigma);
      const x = (i / nHist) * W;
      const y = H / 2 - v * (H * 0.32);
      first ? wvCtx.moveTo(x, y) : wvCtx.lineTo(x, y);
      first = false;
    }
    wvCtx.strokeStyle = '#00cc66'; wvCtx.lineWidth = 1.5; wvCtx.stroke();

    // STA/LTA ratio overlay — bottom 28% of canvas, cyan trace + dashed trigger line
    // Maps ratio 0→H, TRIGGER*2.4→H*0.72 (trigger threshold at H*0.86)
    const R_SCALE = STA_LTA_TRIGGER * 2.4;
    const R_BOT   = H;
    const R_TOP   = H * 0.72;
    const R_RANGE = R_BOT - R_TOP;
    const R_TRIG_Y = R_BOT - (STA_LTA_TRIGGER / R_SCALE) * R_RANGE;
    wvCtx.beginPath();
    let firstR = true;
    for (let i = 0; i < nHist; i++) {
      const sIdx = ((curIdx - (nHist - i)) % N_PRE + N_PRE) % N_PRE;
      const ratio = preRatio[sIdx];
      const ry = R_BOT - Math.min(ratio / R_SCALE, 1.0) * R_RANGE;
      const rx = (i / nHist) * W;
      firstR ? wvCtx.moveTo(rx, ry) : wvCtx.lineTo(rx, ry);
      firstR = false;
    }
    wvCtx.strokeStyle = 'rgba(0,210,255,0.55)'; wvCtx.lineWidth = 1.2; wvCtx.stroke();
    wvCtx.setLineDash([3, 7]);
    wvCtx.strokeStyle = 'rgba(255,220,0,0.42)'; wvCtx.lineWidth = 1;
    wvCtx.beginPath(); wvCtx.moveTo(0, R_TRIG_Y); wvCtx.lineTo(W, R_TRIG_Y); wvCtx.stroke();
    wvCtx.setLineDash([]);
    wvCtx.fillStyle = 'rgba(255,220,0,0.38)'; wvCtx.font = '8px monospace'; wvCtx.textAlign = 'right';
    wvCtx.fillText(`STA/LTA >${STA_LTA_TRIGGER}`, W - 4, R_TRIG_Y - 3);

    // NOW cursor
    wvCtx.strokeStyle = 'rgba(255,255,255,0.22)'; wvCtx.lineWidth = 1;
    wvCtx.beginPath(); wvCtx.moveTo(W - 2, 0); wvCtx.lineTo(W - 2, H); wvCtx.stroke();

    // Status text
    wvCtx.fillStyle = '#1a3a1a'; wvCtx.font = '9px monospace'; wvCtx.textAlign = 'left';
    wvCtx.fillText(`t=${(simT % T_LOOP).toFixed(1)}s  σ=${sigma.toFixed(1)}  window=${DISP_S}s`, 6, 12);
    wvTex.needsUpdate = true;
  }

  // ── Warning/countdown canvas ──────────────────────────────────────────────────
  const WN_CW = 256, WN_CH = 200;
  const wnCanvas = document.createElement('canvas');
  wnCanvas.width = WN_CW; wnCanvas.height = WN_CH;
  const wnCtx = wnCanvas.getContext('2d');
  const wnTex = new THREE.CanvasTexture(wnCanvas);
  const wnGeo = new THREE.PlaneGeometry(3.2, 2.4);
  const wnMat = new THREE.MeshBasicMaterial({ map: wnTex, transparent: true, opacity: 0.94, depthWrite: false, side: THREE.DoubleSide });
  R.disposables.push(wnGeo, wnMat, wnTex);
  const wnMesh = new THREE.Mesh(wnGeo, wnMat);
  wnMesh.position.set(WARN_X, WARN_Y, WARN_Z);
  wnMesh.rotation.y = -0.28;   // angle toward camera to show depth
  scene.add(wnMesh);

  function drawWarning(detected, ph) {
    const W = WN_CW, H = WN_CH;
    wnCtx.clearRect(0, 0, W, H);
    if (!detected) {
      wnCtx.fillStyle = 'rgba(0,15,0,0.75)'; wnCtx.fillRect(2, 2, W-4, H-4);
      wnCtx.strokeStyle = '#162816'; wnCtx.lineWidth = 1; wnCtx.strokeRect(2, 2, W-4, H-4);
      wnCtx.fillStyle = '#1a4a1a'; wnCtx.font = '11px monospace'; wnCtx.textAlign = 'center';
      wnCtx.fillText('MONITORING', W/2, 70);
      wnCtx.fillText('PRE-P SIGNAL', W/2, 88);
    } else if (ph >= TS) {
      wnCtx.fillStyle = 'rgba(30,8,0,0.9)'; wnCtx.fillRect(2, 2, W-4, H-4);
      wnCtx.strokeStyle = '#ff980055'; wnCtx.lineWidth = 2; wnCtx.strokeRect(2, 2, W-4, H-4);
      wnCtx.fillStyle = '#ff9800'; wnCtx.font = 'bold 22px monospace'; wnCtx.textAlign = 'center';
      wnCtx.fillText('S-WAVE', W/2, 85);
      wnCtx.fillText('ARRIVED', W/2, 115);
    } else {
      const remaining = TS - ph;
      wnCtx.fillStyle = 'rgba(0,12,0,0.88)'; wnCtx.fillRect(2, 2, W-4, H-4);
      wnCtx.strokeStyle = '#00ff8855'; wnCtx.lineWidth = 2; wnCtx.strokeRect(2, 2, W-4, H-4);
      wnCtx.fillStyle = '#1a5a2a'; wnCtx.font = '10px monospace'; wnCtx.textAlign = 'center';
      wnCtx.fillText('▲ DETECTED', W/2, 22);
      wnCtx.fillText('S-WAVE IN', W/2, 46);
      wnCtx.font = 'bold 62px monospace'; wnCtx.fillStyle = '#00ff88';
      wnCtx.fillText(`${remaining.toFixed(1)}s`, W/2, 128);
      wnCtx.font = '10px monospace'; wnCtx.fillStyle = '#2a8a5a';
      wnCtx.fillText('> 8s WARNING', W/2, 162);
    }
    wnTex.needsUpdate = true;
  }

  // ── Accuracy bars ─────────────────────────────────────────────────────────────
  const ACC_VALS   = [0.983, 0.988];  // v2: H+0.0s AUC=0.983, H-0.5s AUC=0.988 (3-seed avg)
  const ACC_COLORS = [CC, CG];
  const accMeshes  = [], accMats = [];

  for (let i = 0; i < 2; i++) {
    const h = ACC_VALS[i] * ACC_MAX;
    const geo = new THREE.BoxGeometry(0.72, h, 0.52);
    const mat = new THREE.MeshPhongMaterial({
      color: ACC_COLORS[i], emissive: ACC_COLORS[i], emissiveIntensity: 0.5,
      transparent: true, opacity: 0.88,
    });
    R.disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(ACC_CX + (i - 0.5) * 1.2, ACC_BASE + h / 2, ACC_Z);
    scene.add(m);
    accMeshes.push(m); accMats.push(mat);
  }

  // ── Orbit ring (flat torus at ORBIT_Y, accumulates per-detection mod 9) ────────
  const ORBIT_N = 9;
  const orbitHits = new Array(ORBIT_N).fill(0);
  const orbitDots = [];
  let orbitFlashIdx = -1, orbitFlashAge = 99;
  let totalDetections = 0;

  const torusGeo = new THREE.TorusGeometry(ORBIT_R, 0.055, 8, 56);
  const torusMat = new THREE.MeshBasicMaterial({ color: CY, transparent: true, opacity: 0.24 });
  R.disposables.push(torusGeo, torusMat);
  const torusMesh = new THREE.Mesh(torusGeo, torusMat);
  // Tilted 55° from horizontal — shows both the ring face and its depth extent
  torusMesh.rotation.x = Math.PI * 0.31;
  torusMesh.position.set(ORBIT_CX, ORBIT_Y, ORBIT_Z);
  scene.add(torusMesh);

  const ORBIT_TILT = Math.PI * 0.31;  // must match torus tilt
  for (let i = 0; i < ORBIT_N; i++) {
    const a = (i / ORBIT_N) * Math.PI * 2;
    const geo = new THREE.SphereGeometry(0.14, 10, 6);
    const mat = new THREE.MeshPhongMaterial({
      color: CY, emissive: CY, emissiveIntensity: 0.15,
      transparent: true, opacity: 0.28,
    });
    R.disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    // Place at correct tilted-ring position
    m.position.set(
      ORBIT_CX + Math.cos(a) * ORBIT_R,
      ORBIT_Y  + Math.sin(a) * ORBIT_R * Math.cos(ORBIT_TILT),
      ORBIT_Z  + Math.sin(a) * ORBIT_R * Math.sin(ORBIT_TILT),
    );
    scene.add(m);
    orbitDots.push({ mesh: m, mat, a, i });
  }

  const orbCv = document.createElement('canvas'); orbCv.width = 128; orbCv.height = 64;
  const orbCtx = orbCv.getContext('2d');
  const orbTex = new THREE.CanvasTexture(orbCv);
  const orbGeo = new THREE.PlaneGeometry(1.9, 0.95);
  const orbMat = new THREE.MeshBasicMaterial({ map: orbTex, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  R.disposables.push(orbGeo, orbMat, orbTex);
  const orbMesh = new THREE.Mesh(orbGeo, orbMat);
  orbMesh.position.set(ORBIT_CX, ORBIT_Y + ORBIT_R * 0.9, ORBIT_Z + 0.3);
  scene.add(orbMesh);

  // Depth connector: faint line from waveform plane to orbit
  {
    const pts = [
      new THREE.Vector3(ORBIT_CX, ORBIT_Y, WAVE_Z + 0.5),
      new THREE.Vector3(ORBIT_CX, ORBIT_Y, ORBIT_Z),
    ];
    const cGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const cMat = new THREE.LineBasicMaterial({ color: CY, transparent: true, opacity: 0.18 });
    R.disposables.push(cGeo, cMat);
    scene.add(new THREE.Line(cGeo, cMat));
  }
  // Depth connector: orbit to accuracy bars
  {
    const pts = [
      new THREE.Vector3(ORBIT_CX, ORBIT_Y, ORBIT_Z),
      new THREE.Vector3(ACC_CX,   ORBIT_Y, ACC_Z),
    ];
    const cGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const cMat = new THREE.LineBasicMaterial({ color: CG, transparent: true, opacity: 0.15 });
    R.disposables.push(cGeo, cMat);
    scene.add(new THREE.Line(cGeo, cMat));
  }

  // ── Earth globe inside orbit ring ──────────────────────────────────────────
  // Procedural equirectangular texture (512×256 = standard sphere UV)
  function makeEarthTexture() {
    const W = 512, H = 256;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#1a3e7a'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2a7232';
    // North America
    g.beginPath(); g.moveTo(105,52); g.lineTo(148,38); g.lineTo(188,46);
    g.lineTo(202,64); g.lineTo(196,94); g.lineTo(172,122); g.lineTo(154,132);
    g.lineTo(144,116); g.lineTo(118,106); g.lineTo(100,78); g.closePath(); g.fill();
    // South America
    g.beginPath(); g.moveTo(154,132); g.lineTo(170,142); g.lineTo(178,162);
    g.lineTo(175,202); g.lineTo(164,218); g.lineTo(153,212); g.lineTo(148,192);
    g.lineTo(144,166); g.lineTo(148,146); g.closePath(); g.fill();
    // Europe
    g.beginPath(); g.moveTo(244,42); g.lineTo(272,36); g.lineTo(292,44);
    g.lineTo(296,60); g.lineTo(284,76); g.lineTo(264,80); g.lineTo(246,72);
    g.lineTo(240,56); g.closePath(); g.fill();
    // Africa
    g.beginPath(); g.moveTo(250,80); g.lineTo(282,74); g.lineTo(302,84);
    g.lineTo(306,112); g.lineTo(298,148); g.lineTo(284,178); g.lineTo(270,196);
    g.lineTo(256,190); g.lineTo(246,162); g.lineTo(240,130); g.lineTo(243,100);
    g.closePath(); g.fill();
    // Asia
    g.beginPath(); g.moveTo(296,44); g.lineTo(342,36); g.lineTo(392,40);
    g.lineTo(432,50); g.lineTo(456,62); g.lineTo(458,82); g.lineTo(438,96);
    g.lineTo(408,102); g.lineTo(378,96); g.lineTo(348,92); g.lineTo(318,96);
    g.lineTo(298,86); g.lineTo(294,66); g.closePath(); g.fill();
    // SE Asia
    g.beginPath(); g.moveTo(402,102); g.lineTo(432,100); g.lineTo(452,112);
    g.lineTo(456,132); g.lineTo(440,142); g.lineTo(414,134); g.lineTo(400,120);
    g.closePath(); g.fill();
    // Australia
    g.beginPath(); g.moveTo(396,162); g.lineTo(432,154); g.lineTo(456,160);
    g.lineTo(460,182); g.lineTo(448,200); g.lineTo(424,206); g.lineTo(398,200);
    g.lineTo(388,180); g.closePath(); g.fill();
    // Polar caps
    g.fillStyle = 'rgba(210,230,255,0.78)';
    g.beginPath(); g.ellipse(256, 0, 200, 28, 0, 0, Math.PI*2); g.fill();
    g.beginPath(); g.ellipse(256, 256, 200, 22, 0, 0, Math.PI*2); g.fill();
    return new THREE.CanvasTexture(c);
  }

  const EARTH_R = 1.1;
  const earthTex = makeEarthTexture();
  const earthGeo = new THREE.SphereGeometry(EARTH_R, 32, 24);
  const earthMat = new THREE.MeshBasicMaterial({ map: earthTex });
  const earthMesh = new THREE.Mesh(earthGeo, earthMat);
  earthMesh.position.set(ORBIT_CX, ORBIT_Y, ORBIT_Z);
  scene.add(earthMesh);
  R.disposables.push(earthGeo, earthMat, earthTex);

  // Epicenter — LOCAL coordinates on earthMesh so it rotates with the globe.
  // EPI_DIR is the surface normal at the epicenter in earth local space (at t=0
  // this also faces toward the camera, but will spin with the earth thereafter).
  const EPI_DIR = new THREE.Vector3(0.25, -0.18, 0.951).normalize();
  const epiLocalPos = EPI_DIR.clone().multiplyScalar(EARTH_R);
  const epiQuat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1), EPI_DIR,
  );

  // Inner ring — tight, appears first (child of earthMesh)
  const epiRingGeo = new THREE.TorusGeometry(0.14, 0.022, 6, 24);
  const epiRingMat = new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0, depthWrite: false });
  const epiRing = new THREE.Mesh(epiRingGeo, epiRingMat);
  epiRing.position.copy(epiLocalPos); epiRing.setRotationFromQuaternion(epiQuat);
  earthMesh.add(epiRing);
  R.disposables.push(epiRingGeo, epiRingMat);

  // Outer shockwave ring (child of earthMesh)
  const epiWaveGeo = new THREE.TorusGeometry(0.26, 0.014, 6, 24);
  const epiWaveMat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0, depthWrite: false });
  const epiWave = new THREE.Mesh(epiWaveGeo, epiWaveMat);
  epiWave.position.copy(epiLocalPos); epiWave.setRotationFromQuaternion(epiQuat);
  earthMesh.add(epiWave);
  R.disposables.push(epiWaveGeo, epiWaveMat);

  // Epicenter dot (child of earthMesh)
  const epiDotGeo = new THREE.SphereGeometry(0.055, 8, 8);
  const epiDotMat = new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0 });
  const epiDot = new THREE.Mesh(epiDotGeo, epiDotMat);
  epiDot.position.copy(epiLocalPos);
  earthMesh.add(epiDot);
  R.disposables.push(epiDotGeo, epiDotMat);

  let epiStart = -1;  // Date.now() when last epicenter fired; -1 = inactive

  function drawOrbitLabel(n) {
    orbCtx.clearRect(0, 0, 128, 64);
    orbCtx.fillStyle = '#443300'; orbCtx.font = '9px monospace'; orbCtx.textAlign = 'center';
    orbCtx.fillText('detections mod 9', 64, 14);
    if (n > 0) {
      orbCtx.fillStyle = '#ffe600'; orbCtx.font = 'bold 30px monospace';
      orbCtx.fillText(String(n % ORBIT_N), 64, 52);
    }
    orbTex.needsUpdate = true;
  }
  drawOrbitLabel(0);

  function fireDetection() {
    totalDetections++;
    const pos = totalDetections % ORBIT_N;
    orbitHits[pos]++;
    orbitFlashIdx = pos; orbitFlashAge = 0;
    const mx = Math.max(1, ...orbitHits);
    for (const d of orbitDots) {
      const rel = orbitHits[d.i] / mx;
      d.mesh.scale.setScalar(0.5 + rel * 2.6);
      d.mat.opacity = 0.18 + rel * 0.82;
      d.mat.emissiveIntensity = 0.12 + rel * 0.85;
    }
    drawOrbitLabel(totalDetections);
  }

  // ── P / S arrival markers — thin vertical Line markers on the waveform plane ──
  const MK_H = WAVE_H + 1.0;
  function mkMarkerLine(color) {
    // Two-point line: bottom to top of the marker height
    const pts = new Float32Array([0, -MK_H / 2, 0,   0, MK_H / 2, 0]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    // Thin glow slab for visibility (THREE.Line has no linewidth in WebGL)
    const boxGeo = new THREE.BoxGeometry(0.022, MK_H, 0.022);
    const mat = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 1.0, transparent: true, opacity: 0.0 });
    R.disposables.push(geo, boxGeo, mat);
    const m = new THREE.Mesh(boxGeo, mat);
    m.visible = false;
    scene.add(m);
    // Label cap at top
    const capGeo = new THREE.SphereGeometry(0.065, 7, 5);
    const capMat = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 1.5, transparent: true, opacity: 0.0 });
    R.disposables.push(capGeo, capMat);
    const cap = new THREE.Mesh(capGeo, capMat);
    scene.add(cap);
    return { mesh: m, mat, cap, capMat };
  }
  const pSlab = mkMarkerLine(CG);
  const sSlab = mkMarkerLine(CO);

  // ── Seismograph needle (stylus writing the waveform) ──────────────────────────
  const NEEDLE_X = WAVE_W / 2;
  const NEEDLE_Z = WAVE_Z + 0.38;

  // Tip sphere (bright pen point)
  const tipGeo = new THREE.SphereGeometry(0.11, 10, 6);
  const tipMat = new THREE.MeshPhongMaterial({ color: CY, emissive: CY, emissiveIntensity: 1.8 });
  R.disposables.push(tipGeo, tipMat);
  const tipSph = new THREE.Mesh(tipGeo, tipMat);
  tipSph.position.set(NEEDLE_X, WAVE_Y, NEEDLE_Z);
  scene.add(tipSph);

  // Arm: dynamic Line from fixed mount → tip (updated each frame)
  const armPosArr = new Float32Array(6);
  const armGeo2 = new THREE.BufferGeometry();
  armGeo2.setAttribute('position', new THREE.BufferAttribute(armPosArr, 3));
  const armLineMat = new THREE.LineBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.7 });
  R.disposables.push(armGeo2, armLineMat);
  const armLine = new THREE.Line(armGeo2, armLineMat);
  scene.add(armLine);

  // Pivot mount (small cylinder, fixed position)
  const pivotGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.18, 8);
  const pivotMat = new THREE.MeshPhongMaterial({ color: 0x888888, emissive: 0x333333 });
  R.disposables.push(pivotGeo, pivotMat);
  const pivotMesh = new THREE.Mesh(pivotGeo, pivotMat);
  pivotMesh.rotation.z = Math.PI / 2;
  pivotMesh.position.set(NEEDLE_X + 1.6, WAVE_Y, NEEDLE_Z);
  scene.add(pivotMesh);

  // Convert absolute simTime → world x on the waveform plane
  function tToWorldX(t, simT) {
    const frac = 1.0 - (simT - t) / DISP_S;  // 0=left, 1=right
    return (frac - 0.5) * WAVE_W;
  }

  // ── Detection flash ring ──────────────────────────────────────────────────────
  const flashGeo = new THREE.RingGeometry(0.45, 0.68, 22);
  const flashMat = new THREE.MeshBasicMaterial({ color: CY, transparent: true, opacity: 0, side: THREE.DoubleSide });
  R.disposables.push(flashGeo, flashMat);
  const flashRing = new THREE.Mesh(flashGeo, flashMat);
  flashRing.visible = false;
  scene.add(flashRing);
  let flashAge = 99;

  // ── Audio engine (Web Audio API — no external files) ─────────────────────────
  // AudioContext is created lazily on first user gesture (browser autoplay policy).
  let audioCtx = null;
  let soundOn = true;

  function ensureAudio() {
    if (!soundOn) return null;
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // P-wave: sharp knock/thud (compressional wave — arrives fast, high-frequency burst)
  function playPWave() {
    const ac = ensureAudio(); if (!ac) return;
    const t = ac.currentTime;

    // Main knock — swept tone (180Hz → 55Hz)
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.connect(env); env.connect(ac.destination);
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.3);
    env.gain.setValueAtTime(0.45, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.start(t); osc.stop(t + 0.45);

    // Click transient — high-freq sharp onset
    const click = ac.createOscillator();
    const clickEnv = ac.createGain();
    click.connect(clickEnv); clickEnv.connect(ac.destination);
    click.frequency.value = 700;
    clickEnv.gain.setValueAtTime(0.18, t);
    clickEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    click.start(t); click.stop(t + 0.08);
  }

  // S-wave: deep sustained rumble (shear wave — slower, larger amplitude, longer duration)
  function playSWave() {
    const ac = ensureAudio(); if (!ac) return;
    const t = ac.currentTime;
    const sr = ac.sampleRate;
    const dur = 8.0;

    // Brown noise low-pass filtered at 80 Hz — the body of the shaking
    const frames = Math.ceil(sr * dur);
    const buf = ac.createBuffer(1, frames, sr);
    const d = buf.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < frames; i++) {
      const white = Math.random() * 2 - 1;
      prev = (prev + 0.02 * white) / 1.02;
      d[i] = prev * 3.5;
    }
    const src = ac.createBufferSource();
    src.buffer = buf;

    const lpf = ac.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 90;

    const rumbleGain = ac.createGain();
    rumbleGain.gain.setValueAtTime(0.0, t);
    rumbleGain.gain.linearRampToValueAtTime(0.55, t + 1.2);
    rumbleGain.gain.setValueAtTime(0.50, t + 3.5);
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    src.connect(lpf); lpf.connect(rumbleGain); rumbleGain.connect(ac.destination);
    src.start(t); src.stop(t + dur);

    // Sawtooth tone ~35 Hz — adds shaking "body" character
    const body = ac.createOscillator();
    const bodyGain = ac.createGain();
    body.type = 'sawtooth';
    body.frequency.setValueAtTime(40, t);
    body.frequency.linearRampToValueAtTime(20, t + 5);
    bodyGain.gain.setValueAtTime(0.0, t);
    bodyGain.gain.linearRampToValueAtTime(0.22, t + 0.9);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 6);
    body.connect(bodyGain); bodyGain.connect(ac.destination);
    body.start(t); body.stop(t + 6.2);
  }

  // Detection alert: double beep (StreamDetector fires)
  function playDetect() {
    const ac = ensureAudio(); if (!ac) return;
    const t = ac.currentTime;
    for (const [delay, freq, amp] of [[0, 1100, 0.22], [0.12, 880, 0.16]]) {
      const osc = ac.createOscillator();
      const env = ac.createGain();
      osc.connect(env); env.connect(ac.destination);
      osc.type = 'sine'; osc.frequency.value = freq;
      env.gain.setValueAtTime(amp, t + delay);
      env.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.1);
      osc.start(t + delay); osc.stop(t + delay + 0.14);
    }
  }

  // ── Controls ──────────────────────────────────────────────────────────────────
  let paused = false, speedMult = 1.4, sigma = 0.0;
  const SPEEDS = { slow: 0.15, normal: 0.35, fast: 1.4 };

  function setActiveSpeed(id) {
    ['s21slow', 's21normal', 's21fast'].forEach(s =>
      document.getElementById(s)?.classList.toggle('lit', s === id)
    );
  }

  document.getElementById('s21pause')?.addEventListener('click', () => {
    paused = !paused;
    const el = document.getElementById('s21pause');
    if (el) el.textContent = paused ? '▶ PLAY' : '⏸ PAUSE';
  });
  document.getElementById('s21slow')?.addEventListener('click',   () => { speedMult = SPEEDS.slow;   setActiveSpeed('s21slow');   });
  document.getElementById('s21normal')?.addEventListener('click', () => { speedMult = SPEEDS.normal; setActiveSpeed('s21normal'); });
  document.getElementById('s21fast')?.addEventListener('click',   () => { speedMult = SPEEDS.fast;   setActiveSpeed('s21fast');   });
  document.getElementById('s21reset')?.addEventListener('click',  () => {
    simTime = 0; detected = false; lastLoop = -1;
    pSoundPlayed = false; sSoundPlayed = false;
    shakeStart = -1; camera.position.set(0, 4.6, 10.8);
  });
  document.getElementById('s21sound')?.addEventListener('click', () => {
    soundOn = !soundOn;
    const el = document.getElementById('s21sound');
    if (el) el.textContent = soundOn ? '🔊 SND' : '🔇 SND';
    ensureAudio();  // prime AudioContext on first click (satisfies browser autoplay)
  });
  document.getElementById('s21noise')?.addEventListener('click',  () => {
    sigma = sigma >= 1.5 ? 0.0 : sigma + 0.5;
    const el = document.getElementById('s21noise');
    if (el) el.textContent = `σ ${sigma.toFixed(1)}`;
  });

  // ── Overlay ───────────────────────────────────────────────────────────────────
  ov.innerHTML = `
    <div style="color:#00ff88;letter-spacing:.1em;font-size:11px">SEISMIC</div>
    <div style="color:#555;font-size:8px">P-wave Early Detection</div>
    <div style="margin-top:6px;font-size:7.5px;color:#1a3a1a;line-height:1.9">
      P-arrival: <span style="color:#00ff88">${TP}s</span><br>
      S-arrival: <span style="color:#ff9800">${TS}s</span><br>
      detect window: <span style="color:#ffe600">1s</span><br>
      S-warning: <span style="color:#00ff88">&gt;8s</span>
    </div>
    <div style="margin-top:6px;font-size:7.5px;color:#1a3a1a;line-height:1.9">
      BASE: <span style="color:#00e5ff">87.4%</span><br>
      TRI:&nbsp;&nbsp;<span style="color:#00ff88">88.4%</span><br>
      Δ:&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#ffe600">+1.0%</span>
    </div>
    <div style="margin-top:6px;font-size:7px;color:#443300;line-height:1.7">
      STEAD · 7373 eq+noise<br>
      K=128 · CYCLES=3 · 3 seeds
    </div>`;

  // ── Sim state ─────────────────────────────────────────────────────────────────
  let simTime = 0;
  let detected = false;
  let lastLoop = -1;
  let pSoundPlayed = false;   // one-shot audio flags per loop
  let sSoundPlayed = false;
  let shakeStart = -1;        // Date.now() when S-wave shake begins; -1 = inactive
  let preShakePos = null;     // camera position saved before shake
  let preShakeTarget = null;  // controls target saved before shake

  // ── Animation ─────────────────────────────────────────────────────────────────
  R.animFn = () => {
    controls.update();
    if (paused) return;

    const spd = speedMult;
    simTime += (1 / 60) * spd;

    const loopIdx = Math.floor(simTime / T_LOOP);
    const ph = simTime % T_LOOP;

    // Reset on new loop
    if (loopIdx !== lastLoop) {
      detected = false; lastLoop = loopIdx;
      pSoundPlayed = false; sSoundPlayed = false;
    }

    // P-wave sound + epicenter trigger
    if (!pSoundPlayed && ph >= TP && ph < TP + 0.4) {
      pSoundPlayed = true;
      playPWave();
      epiStart = Date.now();
    }

    // S-wave sound + camera shake at arrival
    if (!sSoundPlayed && ph >= TS && ph < TS + 0.4) {
      sSoundPlayed = true;
      playSWave();
      preShakePos    = camera.position.clone();
      preShakeTarget = controls.target.clone();
      shakeStart = Date.now();
    }

    // Fire detection via live STA/LTA — ratio computed from actual noisy signal
    if (!detected && ph > TP + 0.05) {
      if (staLtaLive(simTime, sigma) >= STA_LTA_TRIGGER) {
        detected = true;
        flashAge = 0;
        flashRing.visible = true;
        flashRing.scale.setScalar(1);
        flashRing.position.set(WAVE_W / 2, WAVE_Y, WAVE_Z + 1.5);
        fireDetection();
        playDetect();
      }
    }

    // Draw canvases
    drawWaveform(simTime, detected, sigma);
    drawWarning(detected, ph);

    // Update P/S marker lines
    function updateMarker(slab, loopOffset) {
      const t = loopIdx * T_LOOP + loopOffset;
      const prevT = (loopIdx - 1) * T_LOOP + loopOffset;
      const candidates = [t, prevT];
      let shown = false;
      for (const ct of candidates) {
        const wx = tToWorldX(ct, simTime);
        if (wx > -(WAVE_W / 2 + 0.3) && wx < WAVE_W / 2 + 0.3) {
          slab.mesh.visible = true; slab.cap.visible = true;
          slab.mesh.position.set(wx, WAVE_Y, WAVE_Z + 0.05);
          slab.cap.position.set(wx, WAVE_Y + MK_H / 2 + 0.05, WAVE_Z + 0.05);
          slab.mat.opacity += (0.85 - slab.mat.opacity) * 0.1;
          slab.capMat.opacity = slab.mat.opacity;
          shown = true; break;
        }
      }
      if (!shown) {
        slab.mat.opacity = Math.max(0, slab.mat.opacity - 0.06);
        slab.capMat.opacity = slab.mat.opacity;
        if (slab.mat.opacity <= 0) { slab.mesh.visible = false; slab.cap.visible = false; }
      }
    }
    updateMarker(pSlab, TP);
    updateMarker(sSlab, TS);

    // Needle — stylus writing the seismogram at the NOW cursor
    const curV = addNoise(preWave[Math.floor(simTime * HZ) % N_PRE], simTime, sigma);
    const tipY = WAVE_Y + curV * WAVE_H * 0.32;
    tipSph.position.set(NEEDLE_X, tipY, NEEDLE_Z);
    // Arm from pivot mount → tip
    const ap = armLine.geometry.attributes.position.array;
    ap[0] = NEEDLE_X + 1.6; ap[1] = WAVE_Y; ap[2] = NEEDLE_Z;
    ap[3] = NEEDLE_X;       ap[4] = tipY;    ap[5] = NEEDLE_Z;
    armLine.geometry.attributes.position.needsUpdate = true;

    // Flash ring
    flashAge += spd;
    if (flashAge < 55) {
      flashMat.opacity = (1 - flashAge / 55) * 0.88;
      flashRing.scale.setScalar(1 + flashAge * 0.07);
    } else if (flashRing.visible) {
      flashMat.opacity = 0;
      flashRing.scale.setScalar(1);
      flashRing.visible = false;
    }

    // Orbit dots spin on the tilted ring plane
    const now = Date.now();
    for (const d of orbitDots) {
      const a = d.a + now * 0.00028;
      d.mesh.position.set(
        ORBIT_CX + Math.cos(a) * ORBIT_R,
        ORBIT_Y  + Math.sin(a) * ORBIT_R * Math.cos(ORBIT_TILT),
        ORBIT_Z  + Math.sin(a) * ORBIT_R * Math.sin(ORBIT_TILT),
      );
    }

    // Orbit flash
    if (orbitFlashIdx >= 0 && orbitFlashAge < 40) {
      orbitFlashAge += spd;
      const mx = Math.max(1, ...orbitHits);
      const rel = orbitHits[orbitFlashIdx] / mx;
      const dot = orbitDots.find(d => d.i === orbitFlashIdx);
      if (dot) dot.mat.emissiveIntensity = 1.8 * (1 - orbitFlashAge / 40) + rel * 0.7;
    }

    // Earth rotation (real-time so it ignores speed multiplier)
    earthMesh.rotation.y = Date.now() * 0.00020;

    // Camera shake — triggered by S-wave, decays over 3.5 seconds
    if (shakeStart >= 0) {
      const sT = (Date.now() - shakeStart) / 1000;
      const SHAKE_DUR = 3.5;
      if (sT < SHAKE_DUR) {
        const env = Math.pow(1 - sT / SHAKE_DUR, 1.8);
        const amp = 0.22 * env;
        const t = Date.now() * 0.001;
        camera.position.set(
          preShakePos.x + amp * Math.sin(t * 31.7 + 1.1),
          preShakePos.y + amp * Math.sin(t * 27.3 + 2.5),
          preShakePos.z + amp * Math.sin(t * 23.1 + 0.7),
        );
      } else {
        camera.position.copy(preShakePos);
        controls.target.copy(preShakeTarget);
        shakeStart = -1;
      }
    }

    // Epicenter animation — triggered by P-wave arrival, runs in real-time
    if (epiStart >= 0) {
      const eT = (Date.now() - epiStart) / 1000;  // seconds since fired
      // Dot: flash bright then fade
      epiDotMat.opacity = eT < 0.3 ? eT / 0.3 : Math.max(0, 1.0 - (eT - 0.3) / 4.0);
      // Inner ring: appear quickly, hold, then fade
      const rA = eT < 0.2 ? eT / 0.2 : Math.max(0, 1.0 - (eT - 0.6) / 3.5);
      epiRingMat.opacity = rA * 0.92;
      epiRing.scale.setScalar(0.25 + Math.min(eT / 1.5, 1.0) * 0.75);
      // Outer shockwave: starts 0.4s in, expands fast, fades
      const wT = Math.max(0, eT - 0.4);
      const wA = wT < 0.15 ? wT / 0.15 : Math.max(0, 1.0 - (wT - 0.15) / 2.8);
      epiWaveMat.opacity = wA * 0.72;
      epiWave.scale.setScalar(0.15 + Math.min(wT * 2.0, 1.0) * 2.0);
      if (eT > 5.5) { epiStart = -1; epiDotMat.opacity = 0; epiRingMat.opacity = 0; epiWaveMat.opacity = 0; }
    }

    // Accuracy bars: TRI pulses after detection, during countdown
    if (detected && ph >= T_DETECT && ph < TS) {
      const pulse = 0.48 + 0.3 * Math.sin(now * 0.006);
      accMats[1].emissiveIntensity = pulse;
    } else {
      accMats.forEach(m => { m.emissiveIntensity += (0.5 - m.emissiveIntensity) * 0.05; });
    }
  };
}
