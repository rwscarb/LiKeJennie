/**
 * OLIVER 42 — Scene 11 — STANDING WAVE
 *
 * Shape: lemon body (bilateral standing wave) + ∞ at each tip + back-to-back clock at center.
 * Forward orbit ×2 mod9: 1→2→4→8→7→5
 * Backward orbit ×5 mod9: 1→5→7→8→4→2
 * 9 = void / axle. Lutz fires at tip; structure spirals to 9.
 */
import { THREE, CSS2DObject, R, mkCamera, mkControls } from './shared.js';

const C_FWD  = 0xaa44ff;
const C_BWD  = 0xff44cc;
const C_BODY = 0x443366;
const CS_FWD = '#cc66ff';
const CS_BWD = '#ff88ee';

const ORBIT_FWD = [1, 2, 4, 8, 7, 5];
const ORBIT_BWD = [1, 5, 7, 8, 4, 2];

const LEMON_L = 5.5;
const LEMON_W = 2.0;
const CLOCK_R = 1.55;
const CLOCK_Z = 0.45;
const TIP_A   = 1.05;
const N_ARC   = 192;
const TIP_SEGS = 256;

// Two-arc lemon: circles each passing through (±L, 0), tangent at (0, ±W)
// c = (W²−L²)/(2W) [<0 for lemon], r = (W²+L²)/(2W)
function lemonArcPts(L, W, N, upper) {
  const c  = (W * W - L * L) / (2 * W);
  const rc = (W * W + L * L) / (2 * W);
  const pts = [];
  if (upper) {
    const thL = Math.atan2(-c, -L);
    const thR = Math.atan2(-c,  L);
    for (let i = 0; i <= N; i++) {
      const th = thL + (thR - thL) * (i / N);
      pts.push(new THREE.Vector3(rc * Math.cos(th), c + rc * Math.sin(th), 0));
    }
  } else {
    const thL = Math.atan2( c, -L);
    const thR = Math.atan2( c,  L);
    for (let i = 0; i <= N; i++) {
      const th = thL + (thR - thL) * (i / N);
      pts.push(new THREE.Vector3(rc * Math.cos(th), -c + rc * Math.sin(th), 0));
    }
  }
  return pts;
}

// Tip lemniscate in YZ plane at x = cx
function tipLemPt(t, A, cx) {
  const s = Math.sin(t), cs = Math.cos(t);
  const d = 1 + s * s;
  return new THREE.Vector3(cx, A * cs / d, A * s * cs / d);
}

function arcLerp(pts, frac) {
  const clamped = ((frac % 1) + 1) % 1;
  const raw = clamped * (pts.length - 1);
  const i0  = Math.floor(raw);
  const i1  = Math.min(i0 + 1, pts.length - 1);
  return new THREE.Vector3().lerpVectors(pts[i0], pts[i1], raw - i0);
}

export function buildS11() {
  const scene  = R.scene  = new THREE.Scene();
  R.camera     = mkCamera();
  R.camera.position.set(0, 3.5, 15);
  R.camera.lookAt(0, 0, 0);
  R.controls   = mkControls(R.camera);
  R.controls.autoRotate      = true;
  R.controls.autoRotateSpeed = 0.18;

  scene.add(new THREE.AmbientLight(0x060414, 3.5));
  const pl1 = new THREE.PointLight(C_FWD, 2.2, 20); pl1.position.set( 3, 3,  5); scene.add(pl1);
  const pl2 = new THREE.PointLight(C_BWD, 1.8, 20); pl2.position.set(-3, -3, -5); scene.add(pl2);

  // ── Lemon body ───────────────────────────────────────────────────────────────
  const upperPts = lemonArcPts(LEMON_L, LEMON_W, N_ARC, true);
  const lowerPts = lemonArcPts(LEMON_L, LEMON_W, N_ARC, false);

  function addTube(pts, color, radius, opacity) {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const geo   = new THREE.TubeGeometry(curve, pts.length, radius, 5, false);
    const mat   = new THREE.MeshPhongMaterial({
      color, emissive: color, emissiveIntensity: 0.20,
      transparent: true, opacity, shininess: 40,
    });
    R.disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    return mat;
  }

  const upperMat = addTube(upperPts, C_BODY, 0.055, 0.72);
  const lowerMat = addTube(lowerPts, C_BODY, 0.055, 0.72);

  // Tips (cusps) as glowing points
  for (const sx of [-1, 1]) {
    const g = new THREE.SphereGeometry(0.11, 12, 8);
    const m = new THREE.MeshPhongMaterial({ color: 0x6633aa, emissive: 0x6633aa, emissiveIntensity: 1.0, transparent: true, opacity: 0.90 });
    R.disposables.push(g, m);
    const mesh = new THREE.Mesh(g, m); mesh.position.set(sx * LEMON_L, 0, 0);
    scene.add(mesh);
  }

  // ── Tip lemniscates ──────────────────────────────────────────────────────────
  function addTipLem(cx, color) {
    const pts = [];
    for (let i = 0; i <= TIP_SEGS; i++) pts.push(tipLemPt((i / TIP_SEGS) * Math.PI * 2, TIP_A, cx));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
    const geo   = new THREE.TubeGeometry(curve, TIP_SEGS, 0.028, 5, true);
    const mat   = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.30, transparent: true, opacity: 0.48 });
    R.disposables.push(geo, mat);
    scene.add(new THREE.Mesh(geo, mat));
  }
  addTipLem(-LEMON_L, C_BWD);
  addTipLem( LEMON_L, C_FWD);

  // ── Traveler spheres ─────────────────────────────────────────────────────────
  function mkSphere(r, color) {
    const g = new THREE.SphereGeometry(r, 14, 9);
    const m = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 1.0, transparent: true, opacity: 0.95 });
    R.disposables.push(g, m);
    const mesh = new THREE.Mesh(g, m); scene.add(mesh);
    return mesh;
  }
  const travFwd    = mkSphere(0.17, C_FWD);
  const travBwd    = mkSphere(0.17, C_BWD);
  const tipTravFwd = mkSphere(0.13, C_FWD);
  const tipTravBwd = mkSphere(0.13, C_BWD);

  // Tail helper
  const TAIL = 22;
  function mkTail(color) {
    const arr  = new Float32Array((TAIL + 1) * 3);
    const geo  = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(arr, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.28 });
    R.disposables.push(geo, mat);
    scene.add(new THREE.Line(geo, mat));
    return { arr, attr, geo, hist: [] };
  }
  function pushTail(tail, pos) {
    tail.hist.push(pos.clone());
    if (tail.hist.length > TAIL) tail.hist.shift();
    for (let i = 0; i < tail.hist.length; i++) {
      tail.arr[i*3] = tail.hist[i].x; tail.arr[i*3+1] = tail.hist[i].y; tail.arr[i*3+2] = tail.hist[i].z;
    }
    tail.attr.needsUpdate = true;
    tail.geo.setDrawRange(0, tail.hist.length);
  }
  const tailFwd = mkTail(C_FWD);
  const tailBwd = mkTail(C_BWD);

  // Full lemon contour (CW): upper left→right, lower right→left
  const contour = [...upperPts, ...[...lowerPts].reverse()];

  // ── Back-to-back clocks ──────────────────────────────────────────────────────
  function addRing(z, color, opacity) {
    const geo = new THREE.TorusGeometry(CLOCK_R, 0.022, 6, 80);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity });
    R.disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat); m.position.set(0, 0, z); scene.add(m);
  }
  addRing( CLOCK_Z, C_FWD, 0.55);
  addRing(-CLOCK_Z, C_BWD, 0.42);

  // Clock nodes: 6 positions equally spaced, CW from top
  const nodeAngles = ORBIT_FWD.map((_, i) => Math.PI / 2 - (i / 6) * Math.PI * 2);
  const fwdNodeMats = [], bwdNodeMats = [];

  for (let i = 0; i < 6; i++) {
    const a  = nodeAngles[i];
    const x  = CLOCK_R * Math.cos(a);
    const y  = CLOCK_R * Math.sin(a);

    // Front node
    { const g = new THREE.SphereGeometry(0.095, 10, 7);
      const m = new THREE.MeshPhongMaterial({ color: C_FWD, emissive: C_FWD, emissiveIntensity: 0.22, transparent: true, opacity: 0.72 });
      R.disposables.push(g, m);
      const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, CLOCK_Z); scene.add(mesh);
      fwdNodeMats.push(m); }

    // Back node (x-mirrored for back-face)
    { const g = new THREE.SphereGeometry(0.095, 10, 7);
      const m = new THREE.MeshPhongMaterial({ color: C_BWD, emissive: C_BWD, emissiveIntensity: 0.22, transparent: true, opacity: 0.58 });
      R.disposables.push(g, m);
      const mesh = new THREE.Mesh(g, m); mesh.position.set(-x, y, -CLOCK_Z); scene.add(mesh);
      bwdNodeMats.push(m); }

    // Label (forward orbit value)
    { const div = document.createElement('div');
      div.textContent = String(ORBIT_FWD[i]);
      div.style.cssText = `font-family:'Courier New',monospace;font-size:10px;font-weight:bold;color:${CS_FWD};pointer-events:none;user-select:none`;
      const lbl = new CSS2DObject(div);
      lbl.position.set(x * 1.28, y * 1.28, CLOCK_Z);
      scene.add(lbl); R.css2dObjects.push(lbl); }
  }

  // Dynamic clock hands
  function mkHand(z, color) {
    const arr  = new Float32Array([0, 0, z, CLOCK_R * 0.82, 0, z]);
    const geo  = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(arr, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.92 });
    R.disposables.push(geo, mat);
    const line = new THREE.Line(geo, mat); scene.add(line);
    return { arr, attr };
  }
  const handFwd = mkHand( CLOCK_Z, C_FWD);
  const handBwd = mkHand(-CLOCK_Z, C_BWD);

  // ── Center void ──────────────────────────────────────────────────────────────
  { const g = new THREE.TorusGeometry(0.20, 0.038, 8, 40);
    const m = new THREE.MeshBasicMaterial({ color: 0x2a1a44, transparent: true, opacity: 0.45 });
    R.disposables.push(g, m); scene.add(new THREE.Mesh(g, m)); }
  { const div = document.createElement('div');
    div.textContent = '9';
    div.style.cssText = `font-family:'Courier New',monospace;font-size:9px;color:#333355;pointer-events:none;user-select:none`;
    const lbl = new CSS2DObject(div); lbl.position.set(0, 0.32, 0);
    scene.add(lbl); R.css2dObjects.push(lbl); }

  // ── Overlay ──────────────────────────────────────────────────────────────────
  R.ov.innerHTML =
    `<div style="color:${CS_FWD};letter-spacing:.1em">11 · OLIVER 42</div>` +
    `<div style="color:#553377;font-size:11px;margin-top:3px">🍋 lemon · ∞ · ‖‖ clock</div>` +
    `<div style="font-size:10px;margin-top:5px;line-height:1.9">` +
      `<span style="color:${CS_FWD}">→</span> ×2: 1·2·4·8·7·5<br>` +
      `<span style="color:${CS_BWD}">←</span> ×5: 1·5·7·8·4·2<br>` +
      `<span style="color:#553377">⊙</span> 9 = void · axle` +
    `</div>` +
    `<div style="margin-top:8px;padding-top:5px;border-top:1px solid #1a0830">` +
      `<span id="s11_state" style="font-family:'Courier New',monospace;font-size:13px;color:${CS_FWD};letter-spacing:.09em">→1 ←1</span>` +
    `</div>`;

  if (R.clkDisplay) {
    R.clkDisplay.innerHTML =
      `<div style="color:#aa44ff;letter-spacing:.1em">11 · OLIVER 42</div>` +
      `<div style="color:#553377;margin-top:3px;font-size:8px">lemon · ∞ · back-to-back</div>`;
  }

  const rotBtn = document.getElementById('p11rot');
  if (rotBtn) rotBtn.onclick = () => {
    R.controls.autoRotate = !R.controls.autoRotate;
    rotBtn.classList.toggle('lit', R.controls.autoRotate);
  };

  // ── Animation ─────────────────────────────────────────────────────────────────
  const LOOP_T   = 9.0;    // lemon traverse period
  const TIP_T    = 2.8;    // tip lemniscate period
  const ORBIT_T  = LOOP_T / 6;  // seconds per orbit step
  let   startTime = null;

  R.animFn = (now) => {
    if (startTime === null) startTime = now;
    const elapsed = (now - startTime) / 1000;

    // ── Lemon travelers ──────────────────────────────────────────────────────
    const frac = (elapsed / LOOP_T) % 1;
    const posFwd = arcLerp(contour, frac);
    const posBwd = arcLerp(contour, 1 - frac);
    travFwd.position.copy(posFwd);
    travBwd.position.copy(posBwd);
    pushTail(tailFwd, posFwd);
    pushTail(tailBwd, posBwd);

    // Standing wave glow: peaks when travelers cross (frac ≈ 0 or 0.5)
    const wave = Math.abs(Math.cos(frac * Math.PI * 2));
    upperMat.emissiveIntensity = 0.12 + 0.30 * wave;
    lowerMat.emissiveIntensity = 0.12 + 0.30 * wave;

    // ── Tip lemniscate travelers ──────────────────────────────────────────────
    const tipFrac = (elapsed / TIP_T) % 1;
    tipTravFwd.position.copy(tipLemPt( tipFrac * Math.PI * 2, TIP_A,  LEMON_L));
    tipTravBwd.position.copy(tipLemPt(-tipFrac * Math.PI * 2, TIP_A, -LEMON_L));

    // ── Clock ─────────────────────────────────────────────────────────────────
    const rawStep  = (elapsed / ORBIT_T) % 6;
    const orbitIdx = Math.floor(rawStep) % 6;
    const stepFrac = rawStep - Math.floor(rawStep);

    // Smooth hand sweep between nodes
    const aFrom = nodeAngles[orbitIdx];
    const aTo   = nodeAngles[(orbitIdx + 1) % 6];
    let dA = aTo - aFrom;
    if (dA >  Math.PI) dA -= Math.PI * 2;
    if (dA < -Math.PI) dA += Math.PI * 2;
    const handAngle = aFrom + dA * stepFrac;

    const hx = CLOCK_R * 0.82 * Math.cos(handAngle);
    const hy = CLOCK_R * 0.82 * Math.sin(handAngle);

    // Forward hand
    handFwd.arr[3] = hx;  handFwd.arr[4] = hy;  handFwd.arr[5] =  CLOCK_Z;
    handFwd.attr.needsUpdate = true;

    // Backward hand (x-mirrored → CCW)
    handBwd.arr[3] = -hx; handBwd.arr[4] = hy;  handBwd.arr[5] = -CLOCK_Z;
    handBwd.attr.needsUpdate = true;

    // Highlight active clock nodes
    const bwdIdx = (6 - orbitIdx) % 6;
    for (let i = 0; i < 6; i++) {
      const fAct = i === orbitIdx;
      fwdNodeMats[i].emissiveIntensity = fAct ? 1.3 : 0.18;
      fwdNodeMats[i].opacity           = fAct ? 1.0 : 0.62;
      const bAct = i === bwdIdx;
      bwdNodeMats[i].emissiveIntensity = bAct ? 1.0 : 0.18;
      bwdNodeMats[i].opacity           = bAct ? 0.90 : 0.48;
    }

    // ── HUD updates ───────────────────────────────────────────────────────────
    const fwdVal = ORBIT_FWD[orbitIdx];
    const bwdVal = ORBIT_BWD[(6 - orbitIdx) % 6];
    const cycle  = (Math.floor(elapsed / LOOP_T) % 42) + 1;
    const el = document.getElementById('s11_state');
    if (el) el.textContent = `→${fwdVal} ←${bwdVal}  [${String(cycle).padStart(2,'0')}/42]`;

    if (R.clkDisplay) {
      R.clkDisplay.innerHTML =
        `<div style="color:#aa44ff;letter-spacing:.1em">11 · OLIVER 42</div>` +
        `<div style="color:#553377;margin-top:3px;font-size:8px">→${fwdVal} · ←${bwdVal}</div>`;
    }
  };
}
