// ─────────────────────────────────────────────────────────────────────────────
//  SCENE 12 — EXPERIMENTS
//  Two sub-modes (toggle via controls):
//    SGD  — Z/9Z loss landscape: orbit {1,2,4,5,7,8}, complement {3,6}, fixed {9}
//    TRIB — Ternary weight balance from poc_trib_3layer results
// ─────────────────────────────────────────────────────────────────────────────
import { THREE, CSS2DObject, R, mkCamera, mkControls, CG, CC, CY, CO } from './shared.js';

// ── Palette ───────────────────────────────────────────────────────────────────
const C_ORBIT  = 0x00ff88;  const CS_ORBIT  = '#00ff88';
const C_COMP   = 0xff9800;  const CS_COMP   = '#ff9800';
const C_FIXED  = 0xffffff;  const CS_FIXED  = '#ffffff';
const C_POS    = 0x00ff88;
const C_ZERO   = 0x3a4a4a;
const C_NEG    = 0xff4081;  const CS_NEG    = '#ff4081';
const C_XAV    = 0x00e5ff;  const CS_XAV    = '#00e5ff';
const C_TRIB   = 0xffe600;  const CS_TRIB   = '#ffe600';

// ── Shared state ──────────────────────────────────────────────────────────────
let _mode = 'sgd';   // 'sgd' | 'trib' | 'seismic'
let _sgdGroup, _tribGroup, _seismicGroup;

// ── STEAD seismology results (poc_tribar_seismo.py · K=128 · CYCLES=3 · 3 seeds) ──
const SEISMIC_DATA = [
  { sigma: 0.0,  base: 67.42, tri: 69.71, gap: 2.29 },
  { sigma: 0.3,  base: 68.29, tri: 70.90, gap: 2.61 },
  { sigma: 0.7,  base: 69.35, tri: 70.38, gap: 1.03 },
  { sigma: 1.0,  base: 68.46, tri: 69.24, gap: 0.78 },
  { sigma: 1.5,  base: 61.62, tri: 63.09, gap: 1.48 },
];

// ── Data from poc_trib_3layer.py (20-seed means, RTX 4090) ───────────────────
const TRIB_DATA = {
  xavier: {
    fc1: [0.295, 0.403, 0.301],
    fc2: [0.299, 0.372, 0.329],
    fc3: [0.297, 0.364, 0.338],
  },
  trib_c: {
    fc1: [0.291, 0.424, 0.285],
    fc2: [0.329, 0.351, 0.320],
    fc3: [0.334, 0.333, 0.333],
  },
  trib_d: {
    fc1: [0.287, 0.432, 0.281],
    fc2: [0.326, 0.356, 0.318],
    fc3: [0.333, 0.334, 0.333],
  },
  trib_f: {
    fc1: [0.287, 0.431, 0.282],
    fc2: [0.327, 0.355, 0.319],
    fc3: [0.334, 0.334, 0.333],
  },
};

// ── Z/9Z orbit structure ──────────────────────────────────────────────────────
const ORBIT_SET  = new Set([1, 2, 4, 5, 7, 8]);
const COMP_SET   = new Set([3, 6]);
const FIXED_NODE = 9;  // 9 ≡ 0 mod 9

function nodeColor(v) {
  if (ORBIT_SET.has(v)) return C_ORBIT;
  if (COMP_SET.has(v))  return C_COMP;
  return C_FIXED;
}
function nodeColorS(v) {
  if (ORBIT_SET.has(v)) return CS_ORBIT;
  if (COMP_SET.has(v))  return CS_COMP;
  return CS_FIXED;
}
function nodeLabel(v) {
  if (ORBIT_SET.has(v)) return 'orbit';
  if (COMP_SET.has(v))  return 'complement';
  return 'fixed point';
}

// Outer ring: nodes 1-8, angular positions
const R_RING = 3.8;
function ringAngle(v) { return ((v - 1) / 8) * Math.PI * 2 - Math.PI / 2; }
function ringPos(v, y = 0) {
  const a = ringAngle(v);
  return new THREE.Vector3(Math.cos(a) * R_RING, y, Math.sin(a) * R_RING);
}
// Target of ×2 mod 9
function orbitNext(v) { return (v * 2) % 9 || 9; }

// ── Build SGD sub-scene ───────────────────────────────────────────────────────
function buildSGD(scene) {
  const grp = new THREE.Group();
  scene.add(grp);
  _sgdGroup = grp;

  // Outer ring guide
  const rg = new THREE.RingGeometry(R_RING - 0.02, R_RING + 0.02, 72);
  const rm = new THREE.MeshBasicMaterial({ color: 0x0d1a0d, side: THREE.DoubleSide });
  R.disposables.push(rg, rm);
  grp.add(new THREE.Mesh(rg, rm));

  // Cross-hair at center for fixed point
  for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const pts = [new THREE.Vector3(0,0,0), new THREE.Vector3(dx*0.6, 0, dz*0.6)];
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color: 0x3a3a3a, transparent: true, opacity: 0.4 });
    R.disposables.push(g, m);
    grp.add(new THREE.Line(g, m));
  }

  // Arrows: curved arc from node v to its ×2 mod 9 target
  const ARC_SEG = 28;
  const arcData = [];
  for (let v = 1; v <= 8; v++) {
    const tgt = orbitNext(v);
    const from = (tgt === FIXED_NODE) ? new THREE.Vector3(0,0,0) : ringPos(v);
    const to   = (tgt === FIXED_NODE) ? new THREE.Vector3(0,0,0) : ringPos(tgt);
    const srcPos = ringPos(v);  // always from ring

    // Midpoint with lift
    const mid = new THREE.Vector3().addVectors(srcPos, to).multiplyScalar(0.5);
    mid.y += 0.45;

    const pts = [];
    for (let s = 0; s <= ARC_SEG; s++) {
      const t = s / ARC_SEG;
      const mt = 1 - t;
      const p = new THREE.Vector3(
        mt*mt*srcPos.x + 2*mt*t*mid.x + t*t*to.x,
        mt*mt*srcPos.y + 2*mt*t*mid.y + t*t*to.y,
        mt*mt*srcPos.z + 2*mt*t*mid.z + t*t*to.z,
      );
      pts.push(p);
    }

    const col = nodeColor(v);
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.28 });
    R.disposables.push(g, m);
    grp.add(new THREE.Line(g, m));

    // Arrowhead
    const tip = pts[pts.length - 3];
    const d   = new THREE.Vector3().subVectors(pts[pts.length-1], pts[pts.length-5]).normalize();
    const cg  = new THREE.ConeGeometry(0.09, 0.22, 7);
    const cm  = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5 });
    R.disposables.push(cg, cm);
    const cone = new THREE.Mesh(cg, cm);
    cone.position.copy(tip);
    cone.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), d));
    grp.add(cone);

    arcData.push({ pts, col, v, tgt, lineMat: m });
  }

  // Nodes 1-8 on ring
  const nodeObjs = {};
  for (let v = 1; v <= 8; v++) {
    const pos = ringPos(v);
    const col = nodeColor(v);
    const NR  = 0.28;
    const g = new THREE.SphereGeometry(NR, 20, 14);
    const m = new THREE.MeshPhongMaterial({ color: col, emissive: col, emissiveIntensity: 0.18, transparent: true, opacity: 0.88, shininess: 90 });
    R.disposables.push(g, m);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.copy(pos);
    grp.add(mesh);

    const div = document.createElement('div');
    div.textContent = String(v);
    div.style.cssText = [
      `font-family:'Courier New',monospace`,
      `font-size:24px;font-weight:bold`,
      `color:${nodeColorS(v)}`,
      `text-shadow:0 0 8px currentColor`,
      `pointer-events:none;user-select:none`,
    ].join(';');
    const lbl = new CSS2DObject(div);
    lbl.position.set(pos.x, NR + 0.38, pos.z);
    scene.add(lbl);
    R.css2dObjects.push(lbl);

    // Ring halo
    const rg2 = new THREE.RingGeometry(NR+0.05, NR+0.18, 28);
    const rm2 = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.08 });
    R.disposables.push(rg2, rm2);
    const halo = new THREE.Mesh(rg2, rm2);
    halo.position.copy(pos);
    halo.rotation.x = -Math.PI / 2;
    grp.add(halo);

    nodeObjs[v] = { mesh, m, halo, rm2, v, col };
  }

  // Fixed point node at center
  {
    const g = new THREE.SphereGeometry(0.22, 16, 12);
    const m = new THREE.MeshPhongMaterial({ color: C_FIXED, emissive: C_FIXED, emissiveIntensity: 0.12, transparent: true, opacity: 0.55, shininess: 60 });
    R.disposables.push(g, m);
    const mesh = new THREE.Mesh(g, m);
    grp.add(mesh);
    const div = document.createElement('div');
    div.textContent = '9';
    div.style.cssText = `font-family:'Courier New',monospace;font-size:20px;font-weight:bold;color:#888;pointer-events:none;user-select:none`;
    const lbl = new CSS2DObject(div);
    lbl.position.set(0, 0.35, 0);
    scene.add(lbl);
    R.css2dObjects.push(lbl);
    nodeObjs[9] = { mesh, m };
  }

  // Animated pulses
  const mkPulse = (col) => {
    const pg = new THREE.SphereGeometry(0.14, 12, 8);
    const pm = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95 });
    R.disposables.push(pg, pm);
    const p = new THREE.Mesh(pg, pm);
    const gg = new THREE.SphereGeometry(0.30, 8, 6);
    const gm = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.10 });
    R.disposables.push(gg, gm);
    const glow = new THREE.Mesh(gg, gm);
    scene.add(p); scene.add(glow);
    return { mesh: p, glow, mat: pm, glowMat: gm };
  };

  const ORBIT_SEQ = [1, 2, 4, 8, 7, 5];
  const COMP_SEQ  = [3, 6];
  const orbitPulse = mkPulse(C_ORBIT);
  const compPulse  = mkPulse(C_COMP);

  // Center annotation
  const annDiv = document.createElement('div');
  annDiv.style.cssText = [
    `font-family:'Courier New',monospace`,
    `font-size:17px;text-align:center;line-height:1.7`,
    `pointer-events:none;user-select:none;min-width:120px`,
  ].join(';');
  const annLbl = new CSS2DObject(annDiv);
  annLbl.position.set(0, -0.35, 0);
  scene.add(annLbl);
  R.css2dObjects.push(annLbl);

  // Overlay
  R.ov.innerHTML =
    `<div style="color:#00ff88;letter-spacing:.1em">12 · SGD × ORBIT</div>` +
    `<div style="color:#ff9800;font-size:15px;margin-top:3px">θ → 2θ mod 9 &nbsp;(η=1)</div>` +
    `<div style="font-size:13px;margin-top:4px">` +
      `<span style="color:#00ff88">orbit {1,2,4,5,7,8}</span></div>` +
    `<div style="font-size:13px;margin-top:1px">` +
      `<span style="color:#ff9800">complement {3,6}</span></div>` +
    `<div style="font-size:13px;margin-top:1px">` +
      `<span style="color:#888">fixed point {9}</span></div>` +
    `<div style="color:#1a3a2a;font-size:12px;margin-top:4px">` +
      `L(θ)=−θ²/2 mod 9 &nbsp;&nbsp; ∂L/∂θ=−θ mod 9</div>`;

  const TRAVEL = 0.55, DWELL = 1.8, STEP = TRAVEL + DWELL;
  const ORBIT_T = ORBIT_SEQ.length * STEP;
  const COMP_T  = COMP_SEQ.length  * STEP * 3;  // slower for visibility

  let lastT = null;
  let orbitPhase = 0, compPhase = 0;
  let lastOStep = -1;

  const animArcFrom = (pts, frac) => {
    const raw = frac * (pts.length - 1);
    const i0 = Math.floor(raw), i1 = Math.min(i0 + 1, pts.length - 1);
    return new THREE.Vector3().lerpVectors(pts[i0], pts[i1], raw - i0);
  };

  const nodeArcFor = (v) => arcData.find(a => a.v === v);

  grp._animate = (t) => {
    const dt = lastT === null ? 0 : Math.min(t - lastT, 0.08);
    lastT = t;
    orbitPhase = (orbitPhase + dt / STEP) % ORBIT_SEQ.length;
    compPhase  = (compPhase  + dt / STEP) % COMP_SEQ.length;

    // ORBIT pulse
    const oStep = Math.floor(orbitPhase) % ORBIT_SEQ.length;
    const oFrac = orbitPhase - Math.floor(orbitPhase);
    const tFrac = TRAVEL / STEP;
    const oDwell = oFrac >= tFrac;
    const oPct   = Math.min(oFrac / tFrac, 1.0);
    const oEased = oPct < 0.5 ? 2*oPct*oPct : 1 - Math.pow(-2*oPct+2,2)/2;

    const oCur  = ORBIT_SEQ[oStep];
    const oNext = ORBIT_SEQ[(oStep + 1) % ORBIT_SEQ.length];
    const oArc  = nodeArcFor(oCur);
    if (oArc) {
      const pos = oDwell ? ringPos(oNext, 0.1) : animArcFrom(oArc.pts, oEased);
      orbitPulse.mesh.position.copy(pos);
      orbitPulse.glow.position.copy(pos);
    }
    orbitPulse.mat.opacity     = oDwell ? 1.0 : 0.7 + 0.3 * oEased;
    orbitPulse.glowMat.opacity = oDwell ? 0.18 + 0.10 * Math.sin(Date.now()/400) : 0.06;

    // COMP pulse
    const cStep = Math.floor(compPhase) % COMP_SEQ.length;
    const cFrac = compPhase - Math.floor(compPhase);
    const cDwell = cFrac >= tFrac;
    const cPct   = Math.min(cFrac / tFrac, 1.0);
    const cEased = cPct < 0.5 ? 2*cPct*cPct : 1 - Math.pow(-2*cPct+2,2)/2;
    const cCur  = COMP_SEQ[cStep];
    const cNext = COMP_SEQ[(cStep + 1) % COMP_SEQ.length];
    const cArc  = nodeArcFor(cCur);
    if (cArc) {
      const pos = cDwell ? ringPos(cNext, 0.1) : animArcFrom(cArc.pts, cEased);
      compPulse.mesh.position.copy(pos);
      compPulse.glow.position.copy(pos);
    }
    compPulse.mat.opacity     = cDwell ? 1.0 : 0.7 + 0.3 * cEased;
    compPulse.glowMat.opacity = cDwell ? 0.14 + 0.08 * Math.sin(Date.now()/300) : 0.06;

    // Node brightness
    for (let v = 1; v <= 8; v++) {
      const n = nodeObjs[v];
      const isOrbitActive = oDwell && oNext === v;
      const isCompActive  = cDwell && cNext === v;
      const active = isOrbitActive || isCompActive;
      n.m.emissiveIntensity = active ? 0.80 : 0.14;
      n.rm2.opacity         = active ? 0.40 : 0.06;
    }

    // Center annotation: show step during dwell
    if (oDwell && oStep !== lastOStep) {
      lastOStep = oStep;
      const raw2 = oCur * 2;
      annDiv.innerHTML =
        `<span style="color:#1a3a2a;font-size:15px">L(θ)=−θ²/2</span><br>` +
        `<span style="color:#00ff88;font-size:22px;font-weight:bold">${oCur}</span>` +
        `<span style="color:#1a3a2a"> × 2</span><br>` +
        `<span style="color:#1a3a2a">${raw2} mod 9 =</span><br>` +
        `<span style="color:#00ff88;font-size:22px;font-weight:bold">${oNext}</span>`;
    }
  };

  return { arcData, nodeObjs };
}

// ── Build TRIB sub-scene ──────────────────────────────────────────────────────
function buildTRIB(scene) {
  const grp = new THREE.Group();
  scene.add(grp);
  _tribGroup = grp;

  const METHODS = ['xavier', 'trib_c', 'trib_d', 'trib_f'];
  const METHOD_LABELS = { xavier: 'xav', trib_c: 'C', trib_d: 'D', trib_f: 'F' };
  const METHOD_COLORS = { xavier: C_XAV, trib_c: C_TRIB, trib_d: C_COMP, trib_f: C_ORBIT };
  const LAYERS = ['fc1', 'fc2', 'fc3'];
  const LAYER_X = [-3.6, 0, 3.6];
  const BAR_SCALE = 4.5;
  const BAR_W = 0.38, BAR_GAP = 0.52, LAYER_GAP = 3.6;
  const SEG_COLORS = [C_POS, C_ZERO, C_NEG];  // +1, 0, -1

  // Build stacked bars for each layer × method
  LAYERS.forEach((layer, li) => {
    const lx = LAYER_X[li];

    METHODS.forEach((method, mi) => {
      const mx = (mi - (METHODS.length - 1) / 2) * BAR_GAP;
      const fracs = TRIB_DATA[method][layer];  // [pos, zero, neg]

      let yBase = 0;
      fracs.forEach((frac, fi) => {
        const h = frac * BAR_SCALE;
        const g = new THREE.BoxGeometry(BAR_W, h, BAR_W);
        const col = SEG_COLORS[fi];
        const isFC3Trib = li === 2 && method !== 'xavier';
        const emissive = isFC3Trib ? col : 0x000000;
        const emissInt = isFC3Trib ? 0.15 : 0;
        const m = new THREE.MeshPhongMaterial({
          color: col, emissive, emissiveIntensity: emissInt,
          transparent: true, opacity: isFC3Trib ? 0.95 : 0.75,
          shininess: 40,
        });
        R.disposables.push(g, m);
        const mesh = new THREE.Mesh(g, m);
        mesh.position.set(lx + mx, yBase + h / 2, 0);
        grp.add(mesh);
        yBase += h;
      });

      // Method label under bar
      const div = document.createElement('div');
      div.textContent = METHOD_LABELS[method];
      div.style.cssText = [
        `font-family:'Courier New',monospace`,
        `font-size:12px;font-weight:bold`,
        `color:${new THREE.Color(METHOD_COLORS[method]).getStyle()}`,
        `text-align:center;pointer-events:none;user-select:none`,
      ].join(';');
      const lbl = new CSS2DObject(div);
      lbl.position.set(lx + mx, -0.3, 0);
      scene.add(lbl);
      R.css2dObjects.push(lbl);
    });

    // Layer header
    const hDiv = document.createElement('div');
    const isFC3 = li === 2;
    hDiv.textContent = layer.toUpperCase();
    hDiv.style.cssText = [
      `font-family:'Courier New',monospace`,
      `font-size:${isFC3 ? 18 : 15}px;font-weight:bold`,
      `color:${isFC3 ? CS_TRIB : '#3a6a5a'}`,
      `text-align:center;pointer-events:none;user-select:none`,
      isFC3 ? `text-shadow:0 0 10px ${CS_TRIB}` : '',
    ].join(';');
    const hLbl = new CSS2DObject(hDiv);
    hLbl.position.set(lx, BAR_SCALE + 0.5, 0);
    scene.add(hLbl);
    R.css2dObjects.push(hLbl);
  });

  // Legend: +1 / 0 / -1
  [
    { label: '+1 (positive)', col: CS_ORBIT, dx: -1.1 },
    { label: '0  (zero)',     col: '#3a4a4a', dx: 0 },
    { label: '−1 (negative)', col: CS_NEG,   dx: 1.1 },
  ].forEach(({ label, col, dx }) => {
    const div = document.createElement('div');
    div.textContent = label;
    div.style.cssText = [
      `font-family:'Courier New',monospace`,
      `font-size:12px;color:${col}`,
      `pointer-events:none;user-select:none`,
    ].join(';');
    const lbl = new CSS2DObject(div);
    lbl.position.set(dx * 2, -0.85, 0);
    scene.add(lbl);
    R.css2dObjects.push(lbl);
  });

  // fc3 "33/33/33" annotation
  const annDiv = document.createElement('div');
  annDiv.innerHTML =
    `<div style="color:${CS_TRIB};font-size:14px;letter-spacing:.06em;text-align:center">33 · 33 · 33</div>` +
    `<div style="color:#3a6a5a;font-size:11px;text-align:center">C/D/F lock to exact thirds</div>`;
  annDiv.style.cssText = `pointer-events:none;user-select:none`;
  const annLbl = new CSS2DObject(annDiv);
  annLbl.position.set(LAYER_X[2], BAR_SCALE + 1.4, 0);
  scene.add(annLbl);
  R.css2dObjects.push(annLbl);

  // Accuracy row
  const accDiv = document.createElement('div');
  accDiv.innerHTML =
    `<span style="color:${CS_XAV}">xav 98.5%</span>` +
    ` &nbsp;·&nbsp; <span style="color:${CS_TRIB}">C 97.4%</span>` +
    ` &nbsp;·&nbsp; <span style="color:${CS_COMP}">D 98.2%</span>` +
    ` &nbsp;·&nbsp; <span style="color:${CS_ORBIT}">F 98.1%</span>`;
  accDiv.style.cssText = [
    `font-family:'Courier New',monospace`,
    `font-size:12px;text-align:center`,
    `pointer-events:none;user-select:none`,
  ].join(';');
  const accLbl = new CSS2DObject(accDiv);
  accLbl.position.set(0, -1.55, 0);
  scene.add(accLbl);
  R.css2dObjects.push(accLbl);

  R.ov.innerHTML =
    `<div style="color:${CS_TRIB};letter-spacing:.1em">12 · TRIB BALANCE</div>` +
    `<div style="color:#3a6a5a;font-size:14px;margin-top:3px">3-layer ternary weight dist.</div>` +
    `<div style="font-size:12px;margin-top:4px;color:#3a5a3a">fc3 Tribonacci cascade</div>` +
    `<div style="font-size:12px;color:${CS_TRIB}">→ exact 33/33/33 balance</div>` +
    `<div style="font-size:11px;margin-top:4px;color:#1a3a2a">D=64→64→64→16</div>` +
    `<div style="font-size:11px;color:#1a3a2a">sep=0.7σ · 5000 steps · 20 seeds</div>` +
    `<div style="font-size:11px;color:#1a3a2a">RTX 4090 · Adam lr=3e-4</div>`;

  grp._animate = (t) => {
    // Gentle breathing on fc3 bars
    const breath = 0.008 * Math.sin(t * 1.2);
    grp.children.forEach((c, i) => { if (c.isMesh) c.scale.y = 1 + breath * (i % 3 === 0 ? 1 : 0); });
  };
}

// ── Build SEISMIC sub-scene ──────────────────────────────────────────────────
function buildSEISMIC(scene) {
  const grp = new THREE.Group();
  scene.add(grp);
  _seismicGroup = grp;

  const C_BASE  = 0x3a7aaa;  const CS_BASE  = '#3a7aaa';
  const C_TRI   = 0x00ff88;  const CS_TRI   = '#00ff88';
  const C_GAP   = 0xffe600;  const CS_GAP   = '#ffe600';
  const C_AXIS  = 0x1a2a2a;

  const BAR_W   = 0.42;
  const BAR_GAP = 0.14;
  const GRP_GAP = 1.4;
  const Y_FLOOR = 55;    // % floor for chart
  const Y_SCALE = 0.35;  // units per %

  SEISMIC_DATA.forEach((d, i) => {
    const cx = (i - 2) * GRP_GAP;

    // Baseline bar
    const bh = (d.base - Y_FLOOR) * Y_SCALE;
    const bg = new THREE.BoxGeometry(BAR_W, bh, BAR_W);
    const bm = new THREE.MeshPhongMaterial({ color: C_BASE, transparent: true, opacity: 0.75 });
    R.disposables.push(bg, bm);
    const bMesh = new THREE.Mesh(bg, bm);
    bMesh.position.set(cx - BAR_W/2 - BAR_GAP/2, bh/2, 0);
    grp.add(bMesh);

    // Tribar bar
    const th = (d.tri - Y_FLOOR) * Y_SCALE;
    const tg = new THREE.BoxGeometry(BAR_W, th, BAR_W);
    const tm = new THREE.MeshPhongMaterial({ color: C_TRI, emissive: C_TRI, emissiveIntensity: 0.12, transparent: true, opacity: 0.88 });
    R.disposables.push(tg, tm);
    const tMesh = new THREE.Mesh(tg, tm);
    tMesh.position.set(cx + BAR_W/2 + BAR_GAP/2, th/2, 0);
    grp.add(tMesh);

    // Gap bracket line
    const gPts = [
      new THREE.Vector3(cx + BAR_W/2 + BAR_GAP/2 + BAR_W/2 + 0.1, (d.base - Y_FLOOR) * Y_SCALE, 0),
      new THREE.Vector3(cx + BAR_W/2 + BAR_GAP/2 + BAR_W/2 + 0.1, (d.tri  - Y_FLOOR) * Y_SCALE, 0),
    ];
    const gg = new THREE.BufferGeometry().setFromPoints(gPts);
    const gm = new THREE.LineBasicMaterial({ color: C_GAP, transparent: true, opacity: 0.7 });
    R.disposables.push(gg, gm);
    grp.add(new THREE.Line(gg, gm));

    // σ label
    const sDiv = document.createElement('div');
    sDiv.textContent = `σ=${d.sigma}`;
    sDiv.style.cssText = [
      `font-family:'Courier New',monospace`,
      `font-size:11px;color:#3a6a5a`,
      `text-align:center;pointer-events:none;user-select:none`,
    ].join(';');
    const sLbl = new CSS2DObject(sDiv);
    sLbl.position.set(cx, -0.4, 0);
    scene.add(sLbl);
    R.css2dObjects.push(sLbl);

    // Gap label
    const gDiv = document.createElement('div');
    gDiv.textContent = `+${d.gap.toFixed(2)}%`;
    gDiv.style.cssText = [
      `font-family:'Courier New',monospace`,
      `font-size:10px;font-weight:bold;color:${CS_GAP}`,
      `text-align:center;pointer-events:none;user-select:none`,
    ].join(';');
    const gLbl = new CSS2DObject(gDiv);
    gLbl.position.set(cx + BAR_W + BAR_GAP + 0.32, ((d.base + d.tri) / 2 - Y_FLOOR) * Y_SCALE, 0);
    scene.add(gLbl);
    R.css2dObjects.push(gLbl);
  });

  // Floor gridline at 65%
  for (const pct of [60, 65, 70]) {
    const y = (pct - Y_FLOOR) * Y_SCALE;
    const gl = [new THREE.Vector3(-3.6, y, 0), new THREE.Vector3(3.6, y, 0)];
    const gg = new THREE.BufferGeometry().setFromPoints(gl);
    const gm = new THREE.LineBasicMaterial({ color: C_AXIS, transparent: true, opacity: 0.35 });
    R.disposables.push(gg, gm);
    grp.add(new THREE.Line(gg, gm));

    const pDiv = document.createElement('div');
    pDiv.textContent = `${pct}%`;
    pDiv.style.cssText = `font-family:'Courier New',monospace;font-size:10px;color:#1a3a2a;pointer-events:none`;
    const pLbl = new CSS2DObject(pDiv);
    pLbl.position.set(-4.1, y, 0);
    scene.add(pLbl);
    R.css2dObjects.push(pLbl);
  }

  // Legend
  [
    { label: 'baseline MLP', col: CS_BASE, dx: -1.1 },
    { label: 'tribar',       col: CS_TRI,  dx:  0.6 },
    { label: 'gap',          col: CS_GAP,  dx:  2.0 },
  ].forEach(({ label, col, dx }) => {
    const div = document.createElement('div');
    div.textContent = label;
    div.style.cssText = [
      `font-family:'Courier New',monospace`,
      `font-size:12px;color:${col}`,
      `pointer-events:none;user-select:none`,
    ].join(';');
    const lbl = new CSS2DObject(div);
    lbl.position.set(dx, -0.9, 0);
    scene.add(lbl);
    R.css2dObjects.push(lbl);
  });

  grp._animate = (t) => {
    // Tribar bars breathe gently
    grp.children.forEach((c, i) => {
      if (c.isMesh && i % 2 === 1) c.scale.y = 1 + 0.005 * Math.sin(t * 0.8 + i);
    });
  };
}

// ── Public API ────────────────────────────────────────────────────────────────
export function setS12Mode(m) {
  _mode = m;
  if (_sgdGroup)     _sgdGroup.visible     = (m === 'sgd');
  if (_tribGroup)    _tribGroup.visible    = (m === 'trib');
  if (_seismicGroup) _seismicGroup.visible = (m === 'seismic');

  if (R.ov && _sgdGroup && _mode === 'sgd') {
    R.ov.innerHTML =
      `<div style="color:#00ff88;letter-spacing:.1em">12 · SGD × ORBIT</div>` +
      `<div style="color:#ff9800;font-size:15px;margin-top:3px">θ → 2θ mod 9 &nbsp;(η=1)</div>` +
      `<div style="font-size:13px;margin-top:4px"><span style="color:#00ff88">orbit {1,2,4,5,7,8}</span></div>` +
      `<div style="font-size:13px;margin-top:1px"><span style="color:#ff9800">complement {3,6}</span></div>` +
      `<div style="font-size:13px;margin-top:1px"><span style="color:#888">fixed point {9}</span></div>` +
      `<div style="color:#1a3a2a;font-size:12px;margin-top:4px">L(θ)=−θ²/2 mod 9 &nbsp;&nbsp; ∂L/∂θ=−θ mod 9</div>`;
  } else if (R.ov && _tribGroup && _mode === 'trib') {
    R.ov.innerHTML =
      `<div style="color:${CS_TRIB};letter-spacing:.1em">12 · TRIB BALANCE</div>` +
      `<div style="color:#3a6a5a;font-size:14px;margin-top:3px">3-layer ternary weight dist.</div>` +
      `<div style="font-size:12px;margin-top:4px;color:#3a5a3a">fc3 Tribonacci cascade</div>` +
      `<div style="font-size:12px;color:${CS_TRIB}">→ exact 33/33/33 balance</div>` +
      `<div style="font-size:11px;margin-top:4px;color:#1a3a2a">D=64→64→64→16 · 20 seeds · 4090</div>`;
  } else if (R.ov && _seismicGroup && _mode === 'seismic') {
    R.ov.innerHTML =
      `<div style="color:#00ff88;letter-spacing:.1em">12 · SEISMIC</div>` +
      `<div style="color:#3a6a5a;font-size:14px;margin-top:3px">STEAD earthquake vs noise</div>` +
      `<div style="font-size:12px;margin-top:4px;color:#3a5a3a">tribar &gt; baseline at all σ</div>` +
      `<div style="font-size:12px;color:#ffe600">peak gap +2.61% at σ=0.3</div>` +
      `<div style="font-size:11px;margin-top:4px;color:#1a3a2a">K=128 · CYCLES=3 · 3 seeds · 7373 eq/noise</div>`;
  }
}

export function buildS12() {
  const scene    = R.scene    = new THREE.Scene();
  const camera   = R.camera   = mkCamera();
  camera.position.set(0, 10, 8);
  camera.lookAt(0, 0, 0);
  const controls = R.controls = mkControls(camera);
  controls.target.set(0, 0, 0);
  controls.autoRotate      = false;
  controls.enableDamping   = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(4, 8, 6);
  scene.add(dir);

  _mode = 'sgd';
  buildSGD(scene);
  buildTRIB(scene);
  buildSEISMIC(scene);
  _tribGroup.visible    = false;
  _seismicGroup.visible = false;

  R.animFn = (t) => {
    controls.update();
    if (_mode === 'sgd'     && _sgdGroup?._animate)     _sgdGroup._animate(t);
    if (_mode === 'trib'    && _tribGroup?._animate)    _tribGroup._animate(t);
    if (_mode === 'seismic' && _seismicGroup?._animate) _seismicGroup._animate(t);
  };
}
