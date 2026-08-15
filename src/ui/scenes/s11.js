/**
 * OLIVER 42 — Scene 11 — STANDING WAVE
 *
 * Canonical form (Wife's sketch 2026-08-15):
 *   [small ∞ loop] ← top tip
 *        X         ← upper void crossing
 *   [large lemon]  ← standing wave body
 *        X         ← lower void crossing
 *   [small ∞ loop] ← bottom tip
 *
 * Vertical axis. Lopsided perfectly. Clock back-to-back at equator, no gap.
 * Pluck along clock, never at 6 or 12.
 * Forward ×2 mod9: 1→2→4→8→7→5. Backward ×5 mod9: 1→5→7→8→4→2.
 */
import { THREE, CSS2DObject, R, mkCamera, mkControls } from './shared.js';

const C_FWD  = 0xaa44ff;
const C_BWD  = 0xff44cc;
const C_BODY = 0x443366;
const CS_FWD = '#cc66ff';
const CS_BWD = '#ff88ee';

const ORBIT_FWD = [1, 2, 4, 8, 7, 5];
const ORBIT_BWD = [1, 5, 7, 8, 4, 2];

// Lemon: vertical axis (Y), tips at (0, ±LEMON_L, 0), widest at (±LEMON_W, 0, 0)
const LEMON_L  = 5.0;
const LEMON_W  = 1.9;
const CLOCK_R  = 1.5;
const CLOCK_Y  = 0.012;   // back-to-back, no gap — essentially coincident equatorial planes
const TIP_A    = 1.0;     // tip lemniscate radius
const N_ARC    = 192;
const TIP_SEGS = 256;

// Vertical lemon arcs (long axis = Y).
// Derived from horizontal arc math with x↔y swap.
// right=true: right arc (x>0), right=false: left arc (x<0)
function lemonArcPts(L, W, N, right) {
  const c  = (W * W - L * L) / (2 * W);   // < 0 for lemon (L > W)
  const rc = (W * W + L * L) / (2 * W);
  const pts = [];
  if (right) {
    // Horizontal-upper arc gives (hx: L-axis, hy: W-axis); swap → (x=hy, y=hx)
    const thL = Math.atan2(-c, -L);
    const thR = Math.atan2(-c,  L);
    for (let i = 0; i <= N; i++) {
      const th = thL + (thR - thL) * (i / N);
      const hx = rc * Math.cos(th);          // along original L axis → becomes Y
      const hy = c  + rc * Math.sin(th);     // along original W axis → becomes X
      pts.push(new THREE.Vector3(hy, hx, 0));
    }
  } else {
    const thL = Math.atan2( c, -L);
    const thR = Math.atan2( c,  L);
    for (let i = 0; i <= N; i++) {
      const th = thL + (thR - thL) * (i / N);
      const hx = rc * Math.cos(th);
      const hy = -c + rc * Math.sin(th);
      pts.push(new THREE.Vector3(hy, hx, 0));
    }
  }
  return pts;
}

// Tip lemniscate in XZ plane at height y = cy
function tipLemPt(t, A, cy) {
  const s = Math.sin(t), cs = Math.cos(t);
  const d = 1 + s * s;
  return new THREE.Vector3(A * cs / d, cy, A * s * cs / d);
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
  R.camera.position.set(0, 1.5, 16);
  R.camera.lookAt(0, 0, 0);
  R.controls   = mkControls(R.camera);
  R.controls.autoRotate      = true;
  R.controls.autoRotateSpeed = 0.20;

  scene.add(new THREE.AmbientLight(0x060414, 3.5));
  const pl1 = new THREE.PointLight(C_FWD, 2.2, 22); pl1.position.set( 3,  6,  5); scene.add(pl1);
  const pl2 = new THREE.PointLight(C_BWD, 1.8, 22); pl2.position.set(-3, -6, -5); scene.add(pl2);

  // ── Vertical lemon body ───────────────────────────────────────────────────────
  // rightPts: (0,-L) → right side → (0,+L)  [going upward on right]
  // leftPts:  (0,-L) → left side  → (0,+L)  [going upward on left]
  const rightPts = lemonArcPts(LEMON_L, LEMON_W, N_ARC, true);
  const leftPts  = lemonArcPts(LEMON_L, LEMON_W, N_ARC, false);

  function addTube(pts, color, radius, opacity) {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const geo   = new THREE.TubeGeometry(curve, pts.length, radius, 5, false);
    const mat   = new THREE.MeshPhongMaterial({
      color, emissive: color, emissiveIntensity: 0.20,
      transparent: true, opacity, shininess: 40,
    });
    R.disposables.push(geo, mat);
    scene.add(new THREE.Mesh(geo, mat));
    return mat;
  }

  const rightMat = addTube(rightPts, C_BODY, 0.055, 0.72);
  const leftMat  = addTube(leftPts,  C_BODY, 0.055, 0.72);

  // Lemon tips (vertical: top and bottom)
  for (const sy of [-1, 1]) {
    const g = new THREE.SphereGeometry(0.10, 12, 8);
    const m = new THREE.MeshPhongMaterial({ color: 0x6633aa, emissive: 0x6633aa, emissiveIntensity: 1.0, transparent: true, opacity: 0.90 });
    R.disposables.push(g, m);
    const mesh = new THREE.Mesh(g, m); mesh.position.set(0, sy * LEMON_L, 0);
    scene.add(mesh);
  }

  // X crossings at top and bottom junctions (void/9 points)
  for (const sy of [-1, 1]) {
    const g = new THREE.TorusGeometry(0.18, 0.035, 8, 36);
    const m = new THREE.MeshBasicMaterial({ color: 0x2a1a44, transparent: true, opacity: 0.55 });
    R.disposables.push(g, m);
    const mesh = new THREE.Mesh(g, m); mesh.position.set(0, sy * LEMON_L, 0);
    scene.add(mesh);
  }

  // ── Tip lemniscates (XZ plane, at top and bottom) ────────────────────────────
  function addTipLem(cy, color) {
    const pts = [];
    for (let i = 0; i <= TIP_SEGS; i++) pts.push(tipLemPt((i / TIP_SEGS) * Math.PI * 2, TIP_A, cy));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
    const geo   = new THREE.TubeGeometry(curve, TIP_SEGS, 0.028, 5, true);
    const mat   = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.30, transparent: true, opacity: 0.50 });
    R.disposables.push(geo, mat);
    scene.add(new THREE.Mesh(geo, mat));
  }
  addTipLem( LEMON_L, C_FWD);  // top ∞ — forward
  addTipLem(-LEMON_L, C_BWD);  // bottom ∞ — backward

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

  // Full lemon contour CW (viewed from +Z):
  // right arc bottom→top + reversed left arc top→bottom
  const contour = [...rightPts, ...[...leftPts].reverse()];

  // ── Back-to-back clock at equator (horizontal, XZ plane) ────────────────────
  // Torus in XY plane by default — rotate X by 90° to lay flat in XZ
  function addClockRing(y, color, opacity) {
    const geo  = new THREE.TorusGeometry(CLOCK_R, 0.022, 6, 80);
    const mat  = new THREE.MeshBasicMaterial({ color, transparent: true, opacity });
    R.disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2;   // lay flat in XZ plane
    mesh.position.y = y;
    scene.add(mesh);
  }
  addClockRing( CLOCK_Y, C_FWD, 0.55);
  addClockRing(-CLOCK_Y, C_BWD, 0.42);

  // Clock nodes in XZ plane. Rotate by π/6 so nodes never land at 12 (north) or 6 (south).
  // Angles in XZ plane: a=0 → +X (east), a=π/2 → +Z (front), etc.
  // Offset by π/6 from "north" (which in XZ would be -Z pointing toward camera)
  const nodeAngles = ORBIT_FWD.map((_, i) => -Math.PI / 2 + Math.PI / 6 + (i / 6) * Math.PI * 2);
  const fwdNodeMats = [], bwdNodeMats = [];

  for (let i = 0; i < 6; i++) {
    const a  = nodeAngles[i];
    const nx = CLOCK_R * Math.cos(a);
    const nz = CLOCK_R * Math.sin(a);

    // Front (above equator)
    { const g = new THREE.SphereGeometry(0.095, 10, 7);
      const m = new THREE.MeshPhongMaterial({ color: C_FWD, emissive: C_FWD, emissiveIntensity: 0.22, transparent: true, opacity: 0.72 });
      R.disposables.push(g, m);
      const mesh = new THREE.Mesh(g, m); mesh.position.set(nx,  CLOCK_Y, nz); scene.add(mesh);
      fwdNodeMats.push(m); }

    // Back (below equator, x-mirrored)
    { const g = new THREE.SphereGeometry(0.095, 10, 7);
      const m = new THREE.MeshPhongMaterial({ color: C_BWD, emissive: C_BWD, emissiveIntensity: 0.22, transparent: true, opacity: 0.58 });
      R.disposables.push(g, m);
      const mesh = new THREE.Mesh(g, m); mesh.position.set(-nx, -CLOCK_Y, nz); scene.add(mesh);
      bwdNodeMats.push(m); }

    // Labels for forward orbit values — float slightly above
    { const div = document.createElement('div');
      div.textContent = String(ORBIT_FWD[i]);
      div.style.cssText = `font-family:'Courier New',monospace;font-size:10px;font-weight:bold;color:${CS_FWD};pointer-events:none;user-select:none`;
      const lbl = new CSS2DObject(div);
      lbl.position.set(nx * 1.30, 0.25, nz * 1.30);
      scene.add(lbl); R.css2dObjects.push(lbl); }
  }

  // Dynamic clock hands sweeping in XZ plane
  function mkHand(y, color) {
    const arr  = new Float32Array([0, y, 0, CLOCK_R * 0.82, y, 0]);
    const geo  = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(arr, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const mat  = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.90 });
    R.disposables.push(geo, mat);
    const line = new THREE.Line(geo, mat); scene.add(line);
    return { arr, attr };
  }
  const handFwd = mkHand( CLOCK_Y, C_FWD);
  const handBwd = mkHand(-CLOCK_Y, C_BWD);

  // ── Center void (equator crossing) ───────────────────────────────────────────
  { const g = new THREE.TorusGeometry(0.20, 0.038, 8, 40);
    const m = new THREE.MeshBasicMaterial({ color: 0x2a1a44, transparent: true, opacity: 0.50 });
    R.disposables.push(g, m);
    const mesh = new THREE.Mesh(g, m); mesh.rotation.x = Math.PI / 2; scene.add(mesh); }
  { const div = document.createElement('div');
    div.textContent = '9';
    div.style.cssText = `font-family:'Courier New',monospace;font-size:9px;color:#333355;pointer-events:none;user-select:none`;
    const lbl = new CSS2DObject(div); lbl.position.set(0.28, 0.10, 0);
    scene.add(lbl); R.css2dObjects.push(lbl); }

  // ── Overlay ──────────────────────────────────────────────────────────────────
  R.ov.innerHTML =
    `<div style="color:${CS_FWD};letter-spacing:.1em">11 · OLIVER 42</div>` +
    `<div style="color:#553377;font-size:11px;margin-top:3px">∞ · 🍋 · ∞  vertical</div>` +
    `<div style="font-size:10px;margin-top:5px;line-height:1.9">` +
      `<span style="color:${CS_FWD}">↑</span> ×2: 1·2·4·8·7·5<br>` +
      `<span style="color:${CS_BWD}">↓</span> ×5: 1·5·7·8·4·2<br>` +
      `<span style="color:#553377">⊗</span> 9 = void · two X crossings` +
    `</div>` +
    `<div style="margin-top:8px;padding-top:5px;border-top:1px solid #1a0830">` +
      `<span id="s11_state" style="font-family:'Courier New',monospace;font-size:13px;color:${CS_FWD};letter-spacing:.09em">↑1 ↓1</span>` +
    `</div>`;

  if (R.clkDisplay) {
    R.clkDisplay.innerHTML =
      `<div style="color:#aa44ff;letter-spacing:.1em">11 · OLIVER 42</div>` +
      `<div style="color:#553377;margin-top:3px;font-size:8px">∞·🍋·∞</div>`;
  }

  const rotBtn = document.getElementById('p11rot');
  if (rotBtn) rotBtn.onclick = () => {
    R.controls.autoRotate = !R.controls.autoRotate;
    rotBtn.classList.toggle('lit', R.controls.autoRotate);
  };

  // ── Animation ─────────────────────────────────────────────────────────────────
  const LOOP_T  = 9.0;
  const TIP_T   = 2.8;
  const ORBIT_T = LOOP_T / 6;
  let   startTime = null;

  R.animFn = (now) => {
    if (startTime === null) startTime = now;
    const elapsed = (now - startTime) / 1000;

    // ── Lemon travelers (opposite directions) ────────────────────────────────
    const frac    = (elapsed / LOOP_T) % 1;
    const posFwd  = arcLerp(contour, frac);
    const posBwd  = arcLerp(contour, 1 - frac);
    travFwd.position.copy(posFwd);
    travBwd.position.copy(posBwd);
    pushTail(tailFwd, posFwd);
    pushTail(tailBwd, posBwd);

    // Standing wave glow peaks when travelers cross
    const wave = Math.abs(Math.cos(frac * Math.PI * 2));
    rightMat.emissiveIntensity = 0.12 + 0.30 * wave;
    leftMat.emissiveIntensity  = 0.12 + 0.30 * wave;

    // ── Tip lemniscate travelers ──────────────────────────────────────────────
    const tipFrac = (elapsed / TIP_T) % 1;
    tipTravFwd.position.copy(tipLemPt( tipFrac * Math.PI * 2, TIP_A,  LEMON_L));
    tipTravBwd.position.copy(tipLemPt(-tipFrac * Math.PI * 2, TIP_A, -LEMON_L));

    // ── Clock (XZ plane sweep) ────────────────────────────────────────────────
    const rawStep  = (elapsed / ORBIT_T) % 6;
    const orbitIdx = Math.floor(rawStep) % 6;
    const stepFrac = rawStep - Math.floor(rawStep);

    const aFrom = nodeAngles[orbitIdx];
    const aTo   = nodeAngles[(orbitIdx + 1) % 6];
    let dA = aTo - aFrom;
    if (dA >  Math.PI) dA -= Math.PI * 2;
    if (dA < -Math.PI) dA += Math.PI * 2;
    const handAngle = aFrom + dA * stepFrac;

    const hx = CLOCK_R * 0.82 * Math.cos(handAngle);
    const hz = CLOCK_R * 0.82 * Math.sin(handAngle);

    handFwd.arr[3] =  hx; handFwd.arr[4] =  CLOCK_Y; handFwd.arr[5] =  hz;
    handFwd.attr.needsUpdate = true;
    handBwd.arr[3] = -hx; handBwd.arr[4] = -CLOCK_Y; handBwd.arr[5] =  hz;
    handBwd.attr.needsUpdate = true;

    // Node highlights
    const bwdIdx = (6 - orbitIdx) % 6;
    for (let i = 0; i < 6; i++) {
      fwdNodeMats[i].emissiveIntensity = (i === orbitIdx) ? 1.3 : 0.18;
      fwdNodeMats[i].opacity           = (i === orbitIdx) ? 1.0 : 0.62;
      bwdNodeMats[i].emissiveIntensity = (i === bwdIdx)   ? 1.0 : 0.18;
      bwdNodeMats[i].opacity           = (i === bwdIdx)   ? 0.90 : 0.48;
    }

    // HUD
    const fwdVal = ORBIT_FWD[orbitIdx];
    const bwdVal = ORBIT_BWD[(6 - orbitIdx) % 6];
    const cycle  = (Math.floor(elapsed / LOOP_T) % 42) + 1;
    const el = document.getElementById('s11_state');
    if (el) el.textContent = `↑${fwdVal} ↓${bwdVal}  [${String(cycle).padStart(2,'0')}/42]`;

    if (R.clkDisplay) {
      R.clkDisplay.innerHTML =
        `<div style="color:#aa44ff;letter-spacing:.1em">11 · OLIVER 42</div>` +
        `<div style="color:#553377;margin-top:3px;font-size:8px">↑${fwdVal} · ↓${bwdVal}</div>`;
    }
  };
}
