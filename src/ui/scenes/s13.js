// ─────────────────────────────────────────────────────────────────────────────
//  SCENE 13 — GNN MIRROR
//  The orbit graph IS the GNN computation graph. Six message-passing steps
//  complete the identity map — the network has seen itself.
//  Three fractal scales: orbit (period 6) · complement (period 2) · fixed (period 1)
// ─────────────────────────────────────────────────────────────────────────────
import { THREE, CSS2DObject, R, mkCamera, mkControls } from './shared.js';

const C_ORBIT  = 0x00ff88;  const CS_ORBIT  = '#00ff88';
const C_COMP   = 0xff9800;  const CS_COMP   = '#ff9800';
const C_FIXED  = 0xffffff;
const C_LAYER  = 0x00e5ff;  const CS_LAYER  = '#00e5ff';

const ORBIT_SEQ = [1, 2, 4, 8, 7, 5];  // ×2 mod 9 traversal order
const COMP_SEQ  = [3, 6];
const R_ORBIT   = 3.5;
const R_COMP    = 1.35;
const ARC_SEG   = 32;

function orbitPos(idx, r = R_ORBIT) {
  const a = (idx / ORBIT_SEQ.length) * Math.PI * 2 - Math.PI / 2;
  return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
}

function compPos(idx, r = R_COMP) {
  const a = (idx / COMP_SEQ.length) * Math.PI * 2 - Math.PI / 2;
  return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
}

function makeArc(fromPos, toPos, lift) {
  const mid = new THREE.Vector3().addVectors(fromPos, toPos).multiplyScalar(0.5);
  mid.y += lift;
  const pts = [];
  for (let s = 0; s <= ARC_SEG; s++) {
    const t = s / ARC_SEG, mt = 1 - t;
    pts.push(new THREE.Vector3(
      mt*mt*fromPos.x + 2*mt*t*mid.x + t*t*toPos.x,
      mt*mt*fromPos.y + 2*mt*t*mid.y + t*t*toPos.y,
      mt*mt*fromPos.z + 2*mt*t*mid.z + t*t*toPos.z,
    ));
  }
  return pts;
}

function addArrow(scene, pts, col, opacity) {
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const m = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity });
  R.disposables.push(g, m);
  scene.add(new THREE.Line(g, m));
  const tip = pts[pts.length - 3];
  const d   = new THREE.Vector3().subVectors(pts[pts.length - 1], pts[pts.length - 5]).normalize();
  const cg  = new THREE.ConeGeometry(0.09, 0.22, 7);
  const cm  = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: opacity * 1.6 });
  R.disposables.push(cg, cm);
  const cone = new THREE.Mesh(cg, cm);
  cone.position.copy(tip);
  cone.setRotationFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d)
  );
  scene.add(cone);
}

function mkPulse(scene, col, r) {
  const pg = new THREE.SphereGeometry(r, 12, 8);
  const pm = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95 });
  R.disposables.push(pg, pm);
  const mesh = new THREE.Mesh(pg, pm);
  const gg = new THREE.SphereGeometry(r * 2.4, 8, 6);
  const gm = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.10 });
  R.disposables.push(gg, gm);
  const glow = new THREE.Mesh(gg, gm);
  scene.add(mesh); scene.add(glow);
  return { mesh, glow, mat: pm, glowMat: gm };
}

function arcLerp(pts, frac) {
  const raw = frac * (pts.length - 1);
  const i0  = Math.floor(raw);
  const i1  = Math.min(i0 + 1, pts.length - 1);
  return new THREE.Vector3().lerpVectors(pts[i0], pts[i1], raw - i0);
}

function easeInOut(x) {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

export function buildS13() {
  const scene = new THREE.Scene();
  R.scene = scene;
  R.camera = mkCamera();
  R.camera.position.set(0, 7.5, 4.5);
  R.camera.lookAt(0, 0, 0);
  mkControls();

  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const dl = new THREE.DirectionalLight(0xffffff, 0.6);
  dl.position.set(5, 8, 5);
  scene.add(dl);

  // ── Ring guides ──
  for (const [r, col] of [[R_ORBIT, 0x0a2010], [R_COMP, 0x1a0f00]]) {
    const g = new THREE.RingGeometry(r - 0.025, r + 0.025, 72);
    const m = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide });
    R.disposables.push(g, m);
    scene.add(new THREE.Mesh(g, m));
  }

  // ── Orbit edges ──
  const orbitArcs = [];
  for (let i = 0; i < ORBIT_SEQ.length; i++) {
    const pts = makeArc(orbitPos(i), orbitPos((i + 1) % ORBIT_SEQ.length), 0.40);
    addArrow(scene, pts, C_ORBIT, 0.18);
    orbitArcs.push(pts);
  }

  // ── Complement edges ──
  const compArcs = [];
  for (let i = 0; i < COMP_SEQ.length; i++) {
    const pts = makeArc(compPos(i), compPos((i + 1) % COMP_SEQ.length), 0.28);
    addArrow(scene, pts, C_COMP, 0.20);
    compArcs.push(pts);
  }

  // ── Orbit nodes ──
  const orbitMeshes = [];
  for (let i = 0; i < ORBIT_SEQ.length; i++) {
    const v   = ORBIT_SEQ[i];
    const pos = orbitPos(i);
    const g   = new THREE.SphereGeometry(0.30, 20, 14);
    const m   = new THREE.MeshPhongMaterial({
      color: C_ORBIT, emissive: C_ORBIT, emissiveIntensity: 0.15,
      transparent: true, opacity: 0.85, shininess: 80,
    });
    R.disposables.push(g, m);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.copy(pos);
    scene.add(mesh);

    const div = document.createElement('div');
    div.textContent = String(v);
    div.style.cssText = [
      `font-family:'Courier New',monospace;font-size:22px;font-weight:bold`,
      `color:${CS_ORBIT};text-shadow:0 0 8px ${CS_ORBIT}`,
      `pointer-events:none;user-select:none`,
    ].join(';');
    const lbl = new CSS2DObject(div);
    lbl.position.set(pos.x, 0.56, pos.z);
    scene.add(lbl);
    R.css2dObjects.push(lbl);

    orbitMeshes.push({ mesh, mat: m, v, i });
  }

  // ── Complement nodes ──
  const compMeshes = [];
  for (let i = 0; i < COMP_SEQ.length; i++) {
    const v   = COMP_SEQ[i];
    const pos = compPos(i);
    const g   = new THREE.SphereGeometry(0.22, 16, 12);
    const m   = new THREE.MeshPhongMaterial({
      color: C_COMP, emissive: C_COMP, emissiveIntensity: 0.15,
      transparent: true, opacity: 0.80, shininess: 60,
    });
    R.disposables.push(g, m);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.copy(pos);
    scene.add(mesh);

    const div = document.createElement('div');
    div.textContent = String(v);
    div.style.cssText = [
      `font-family:'Courier New',monospace;font-size:18px;font-weight:bold`,
      `color:${CS_COMP};text-shadow:0 0 6px ${CS_COMP}`,
      `pointer-events:none;user-select:none`,
    ].join(';');
    const lbl = new CSS2DObject(div);
    lbl.position.set(pos.x, 0.42, pos.z);
    scene.add(lbl);
    R.css2dObjects.push(lbl);

    compMeshes.push({ mesh, mat: m, v, i });
  }

  // ── Fixed point (center) ──
  {
    const g = new THREE.SphereGeometry(0.18, 16, 12);
    const m = new THREE.MeshPhongMaterial({
      color: C_FIXED, emissive: C_FIXED, emissiveIntensity: 0.12,
      transparent: true, opacity: 0.55, shininess: 50,
    });
    R.disposables.push(g, m);
    scene.add(new THREE.Mesh(g, m));
    const div = document.createElement('div');
    div.textContent = '9';
    div.style.cssText = `font-family:'Courier New',monospace;font-size:15px;font-weight:bold;color:#666;pointer-events:none;user-select:none`;
    const lbl = new CSS2DObject(div);
    lbl.position.set(0, 0.30, 0);
    scene.add(lbl);
    R.css2dObjects.push(lbl);
  }

  // ── Period labels ──
  for (const { pos, text, col, size } of [
    { pos: new THREE.Vector3(R_ORBIT + 0.55, 0, 0), text: 'period 6', col: CS_ORBIT, size: '11px' },
    { pos: new THREE.Vector3(R_COMP  + 0.42, 0, 0), text: 'period 2', col: CS_COMP,  size: '10px' },
    { pos: new THREE.Vector3(0.28,    0, 0),         text: 'period 1', col: '#555',   size: '9px'  },
  ]) {
    const div = document.createElement('div');
    div.textContent = text;
    div.style.cssText = [
      `font-family:'Courier New',monospace;font-size:${size}`,
      `color:${col};opacity:0.50;letter-spacing:.08em`,
      `pointer-events:none;user-select:none`,
    ].join(';');
    const lbl = new CSS2DObject(div);
    lbl.position.copy(pos);
    scene.add(lbl);
    R.css2dObjects.push(lbl);
  }

  // ── Pulses ──
  const orbitPulse = mkPulse(scene, C_ORBIT, 0.16);
  const compPulse  = mkPulse(scene, C_COMP,  0.12);

  // ── Layer counter label ──
  const layerDiv = document.createElement('div');
  layerDiv.style.cssText = [
    `font-family:'Courier New',monospace;font-size:20px;font-weight:bold;text-align:center`,
    `color:${CS_LAYER};letter-spacing:.12em;text-shadow:0 0 10px ${CS_LAYER}`,
    `pointer-events:none;user-select:none`,
  ].join(';');
  const layerLbl = new CSS2DObject(layerDiv);
  layerLbl.position.set(0, -0.52, 0);
  scene.add(layerLbl);
  R.css2dObjects.push(layerLbl);

  // ── Mirror flash label ──
  const mirrorDiv = document.createElement('div');
  mirrorDiv.style.cssText = [
    `font-family:'Courier New',monospace;font-size:13px;text-align:center;line-height:1.8`,
    `color:${CS_LAYER};letter-spacing:.14em`,
    `pointer-events:none;user-select:none;opacity:0`,
  ].join(';');
  mirrorDiv.innerHTML = `LAYER 6 = IDENTITY<br><span style="font-size:10px;color:#888;letter-spacing:.06em">the network has seen itself</span>`;
  const mirrorLbl = new CSS2DObject(mirrorDiv);
  mirrorLbl.position.set(0, 1.6, 0);
  scene.add(mirrorLbl);
  R.css2dObjects.push(mirrorLbl);

  // ── Overlay ──
  R.ov.innerHTML =
    `<div style="color:${CS_LAYER};letter-spacing:.1em">13 · GNN MIRROR</div>` +
    `<div style="color:#00ff88;font-size:14px;margin-top:3px">6 layers → identity map</div>` +
    `<div style="font-size:12px;margin-top:5px;line-height:1.7">` +
      `<span style="color:#00ff88">●</span> orbit {1,2,4,8,7,5}<br>` +
      `<span style="color:#ff9800">●</span> complement {3,6}<br>` +
      `<span style="color:#666">●</span> fixed {9}` +
    `</div>` +
    `<div style="color:#1a3a2a;font-size:11px;margin-top:6px">each layer = one ×2 mod 9 step</div>`;

  // ── Animation ──
  const TRAVEL = 0.52, DWELL = 1.4, STEP = TRAVEL + DWELL;
  const tFrac  = TRAVEL / STEP;
  let lastT    = null;
  let oPhase   = 0, cPhase = 0;
  let mirrorAlpha = 0;

  R.animFn = (t) => {
    const dt = lastT === null ? 0 : Math.min(t - lastT, 0.08);
    lastT = t;

    oPhase = (oPhase + dt / STEP) % ORBIT_SEQ.length;
    cPhase = (cPhase + dt / (STEP * 3)) % COMP_SEQ.length;

    // ── Orbit pulse ──
    const oStep = Math.floor(oPhase) % ORBIT_SEQ.length;
    const oFrac = oPhase - Math.floor(oPhase);
    const oPct  = Math.min(oFrac / tFrac, 1.0);
    const oPos  = arcLerp(orbitArcs[oStep], oFrac < tFrac ? easeInOut(oPct) : 1.0);
    orbitPulse.mesh.position.copy(oPos);
    orbitPulse.glow.position.copy(oPos);

    for (const { mat, i } of orbitMeshes) {
      const active = (i === oStep);
      mat.emissiveIntensity = active ? 0.70 : 0.12;
      mat.opacity = active ? 1.0 : 0.82;
    }

    // Layer counter + mirror flash at step 0 return
    const isReturn = (oStep === 0 && oFrac < 0.20);
    mirrorAlpha = isReturn
      ? Math.min(mirrorAlpha + dt * 2.5, 1.0)
      : Math.max(mirrorAlpha - dt * 1.8, 0.0);
    mirrorDiv.style.opacity = mirrorAlpha.toFixed(3);
    layerDiv.textContent = isReturn ? 'L6 → L0' : `LAYER ${oStep + 1}`;
    layerDiv.style.color = isReturn ? CS_LAYER : CS_LAYER;
    layerDiv.style.opacity = isReturn ? '1' : '0.70';

    // ── Complement pulse ──
    const cStep = Math.floor(cPhase) % COMP_SEQ.length;
    const cFrac = cPhase - Math.floor(cPhase);
    const cPct  = Math.min(cFrac / tFrac, 1.0);
    const cPos  = arcLerp(compArcs[cStep], cFrac < tFrac ? easeInOut(cPct) : 1.0);
    compPulse.mesh.position.copy(cPos);
    compPulse.glow.position.copy(cPos);

    for (const { mat, i } of compMeshes) {
      mat.emissiveIntensity = (i === cStep) ? 0.55 : 0.12;
    }
  };
}
