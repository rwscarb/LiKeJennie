// ─────────────────────────────────────────────────────────────────────────────
//  SCENE 13 — GNN MIRROR
//  Three nested copies of the orbit ring, each at 1/3 scale of the previous.
//  Self-similar: the same 6-node directed cycle at r=3.5, r=1.17, r=0.39.
//  GNN layer pulse traverses all three scales simultaneously.
//  Six layers → identity map → "the network has seen itself."
// ─────────────────────────────────────────────────────────────────────────────
import { THREE, CSS2DObject, R, mkCamera, mkControls } from './shared.js';

const C_ORBIT = 0x00ff88;  const CS_ORBIT = '#00ff88';
const C_COMP  = 0xff9800;  const CS_COMP  = '#ff9800';
const C_LAYER = 0x00e5ff;  const CS_LAYER = '#00e5ff';

// Three fractal radii: each is 1/3 of the previous
const ORBIT_SEQ = [1, 2, 4, 8, 7, 5];
const SCALES    = [3.5, 3.5 / 3, 3.5 / 9];  // ≈ 3.50, 1.17, 0.39
const ARC_SEG   = 28;

function ringPos(idx, r) {
  const a = (idx / ORBIT_SEQ.length) * Math.PI * 2 - Math.PI / 2;
  return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
}

function makeArc(from, to, lift) {
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  mid.y += lift;
  const pts = [];
  for (let s = 0; s <= ARC_SEG; s++) {
    const t = s / ARC_SEG, mt = 1 - t;
    pts.push(new THREE.Vector3(
      mt*mt*from.x + 2*mt*t*mid.x + t*t*to.x,
      mt*mt*from.y + 2*mt*t*mid.y + t*t*to.y,
      mt*mt*from.z + 2*mt*t*mid.z + t*t*to.z,
    ));
  }
  return pts;
}

function addEdge(scene, pts, col, opacity) {
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const m = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity });
  R.disposables.push(g, m);
  scene.add(new THREE.Line(g, m));
  const tip = pts[pts.length - 3];
  const d   = new THREE.Vector3().subVectors(pts[pts.length - 1], pts[pts.length - 5]).normalize();
  const cg  = new THREE.ConeGeometry(0.06 * (opacity / 0.20), 0.16 * (opacity / 0.20), 6);
  const cm  = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: Math.min(opacity * 1.8, 1) });
  R.disposables.push(cg, cm);
  const cone = new THREE.Mesh(cg, cm);
  cone.position.copy(tip);
  cone.setRotationFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d)
  );
  scene.add(cone);
}

function mkPulse(scene, col, r) {
  const pg = new THREE.SphereGeometry(r, 10, 7);
  const pm = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95 });
  R.disposables.push(pg, pm);
  const mesh = new THREE.Mesh(pg, pm);
  const gg = new THREE.SphereGeometry(r * 2.2, 7, 5);
  const gm = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12 });
  R.disposables.push(gg, gm);
  const glow = new THREE.Mesh(gg, gm);
  scene.add(mesh); scene.add(glow);
  return { mesh, glow };
}

function easeInOut(x) {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

function arcLerp(pts, frac) {
  const raw = frac * (pts.length - 1);
  const i0  = Math.floor(raw);
  const i1  = Math.min(i0 + 1, pts.length - 1);
  return new THREE.Vector3().lerpVectors(pts[i0], pts[i1], raw - i0);
}

export function buildS13() {
  const scene = new THREE.Scene();
  R.scene = scene;
  R.camera = mkCamera();
  R.camera.position.set(0, 7.5, 4.5);
  R.camera.lookAt(0, 0, 0);
  R.controls = mkControls(R.camera);

  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const dl = new THREE.DirectionalLight(0xffffff, 0.6);
  dl.position.set(5, 8, 5);
  scene.add(dl);

  // Node sizes scale with ring
  const NODE_R   = [0.28, 0.11, 0.045];
  // Edge lifts scale too
  const LIFTS    = [0.38, 0.14, 0.05];
  // Edge opacities: outer bright, inner faint (depth cue)
  const OPACITIES = [0.20, 0.30, 0.40];

  // ── Scale labels (CSS2D) ──
  const scaleLabels = ['scale 1', 'scale ⅓', 'scale ¹⁄₉'];
  for (let si = 0; si < SCALES.length; si++) {
    const r   = SCALES[si];
    const div = document.createElement('div');
    div.textContent = scaleLabels[si];
    div.style.cssText = [
      `font-family:'Courier New',monospace;font-size:${13 - si}px;font-weight:bold`,
      `color:${CS_ORBIT};opacity:${0.75 - si * 0.08};letter-spacing:.09em`,
      `pointer-events:none;user-select:none`,
    ].join(';');
    const lbl = new CSS2DObject(div);
    lbl.position.set(r + NODE_R[si] + 0.18, 0, 0);
    scene.add(lbl);
    R.css2dObjects.push(lbl);
  }

  // ── Build three fractal rings ──
  const allArcs     = [];   // allArcs[si][edgeIdx] = pts[]
  const allMeshes   = [];   // allMeshes[si][nodeIdx] = {mesh, mat}

  for (let si = 0; si < SCALES.length; si++) {
    const r       = SCALES[si];
    const nr      = NODE_R[si];
    const lift    = LIFTS[si];
    const opacity = OPACITIES[si];

    // Ring guide
    const rg = new THREE.RingGeometry(r - nr * 0.3, r + nr * 0.3, 64);
    const rm = new THREE.MeshBasicMaterial({ color: 0x0a2010, side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
    R.disposables.push(rg, rm);
    scene.add(new THREE.Mesh(rg, rm));

    // Edges
    const arcs = [];
    for (let i = 0; i < ORBIT_SEQ.length; i++) {
      const from = ringPos(i, r);
      const to   = ringPos((i + 1) % ORBIT_SEQ.length, r);
      const pts  = makeArc(from, to, lift);
      addEdge(scene, pts, C_ORBIT, opacity);
      arcs.push(pts);
    }
    allArcs.push(arcs);

    // Nodes
    const meshes = [];
    for (let i = 0; i < ORBIT_SEQ.length; i++) {
      const v   = ORBIT_SEQ[i];
      const pos = ringPos(i, r);
      const g   = new THREE.SphereGeometry(nr, 16, 10);
      const m   = new THREE.MeshPhongMaterial({
        color: C_ORBIT, emissive: C_ORBIT, emissiveIntensity: 0.15,
        transparent: true, opacity: 0.85, shininess: 80,
      });
      R.disposables.push(g, m);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.copy(pos);
      scene.add(mesh);

      // Labels only on outer ring (inner ones too small)
      if (si === 0) {
        const div = document.createElement('div');
        div.textContent = String(v);
        div.style.cssText = [
          `font-family:'Courier New',monospace;font-size:21px;font-weight:bold`,
          `color:${CS_ORBIT};text-shadow:0 0 8px ${CS_ORBIT}`,
          `pointer-events:none;user-select:none`,
        ].join(';');
        const lbl = new CSS2DObject(div);
        lbl.position.set(pos.x, nr + 0.32, pos.z);
        scene.add(lbl);
        R.css2dObjects.push(lbl);
      }

      meshes.push({ mesh, mat: m, i });
    }
    allMeshes.push(meshes);
  }

  // ── Scale connector lines: each outer node → corresponding inner node ──
  // Connect scale 0→1 and scale 1→2 with faint radial lines
  for (let ci = 0; ci < SCALES.length - 1; ci++) {
    for (let i = 0; i < ORBIT_SEQ.length; i++) {
      const from = ringPos(i, SCALES[ci]);
      const to   = ringPos(i, SCALES[ci + 1]);
      const pts  = [from, to];
      const g    = new THREE.BufferGeometry().setFromPoints(pts);
      const m    = new THREE.LineBasicMaterial({
        color: C_ORBIT, transparent: true,
        opacity: ci === 0 ? 0.06 : 0.10,
      });
      R.disposables.push(g, m);
      scene.add(new THREE.Line(g, m));
    }
  }

  // ── Center fixed point ──
  {
    const g = new THREE.SphereGeometry(0.015, 10, 7);
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 });
    R.disposables.push(g, m);
    scene.add(new THREE.Mesh(g, m));
    const div = document.createElement('div');
    div.textContent = '9';
    div.style.cssText = `font-family:'Courier New',monospace;font-size:9px;color:#444;pointer-events:none;user-select:none`;
    const lbl = new CSS2DObject(div);
    lbl.position.set(0.06, 0.04, 0);
    scene.add(lbl);
    R.css2dObjects.push(lbl);
  }

  // ── Pulses: one per scale ──
  const pulses = [
    mkPulse(scene, C_ORBIT, 0.15),   // outer
    mkPulse(scene, C_ORBIT, 0.060),  // mid
    mkPulse(scene, C_ORBIT, 0.024),  // inner
  ];

  // ── Layer counter label ──
  const layerDiv = document.createElement('div');
  layerDiv.style.cssText = [
    `font-family:'Courier New',monospace;font-size:20px;font-weight:bold;text-align:center`,
    `color:${CS_LAYER};letter-spacing:.12em;text-shadow:0 0 10px ${CS_LAYER}`,
    `pointer-events:none;user-select:none`,
  ].join(';');
  const layerLbl = new CSS2DObject(layerDiv);
  layerLbl.position.set(0, -0.55, 0);
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
  mirrorLbl.position.set(0, 1.5, 0);
  scene.add(mirrorLbl);
  R.css2dObjects.push(mirrorLbl);

  // ── Overlay ──
  R.ov.innerHTML =
    `<div style="color:${CS_LAYER};letter-spacing:.1em">13 · GNN MIRROR</div>` +
    `<div style="color:#00ff88;font-size:14px;margin-top:3px">6 layers → identity map</div>` +
    `<div style="font-size:12px;margin-top:5px;line-height:1.7">` +
      `<span style="color:#00ff88">●</span> orbit {1,2,4,8,7,5} — 3 scales<br>` +
      `<span style="color:#00ff88;opacity:.5">·</span> each ring = ×⅓ of previous<br>` +
      `<span style="color:#888">·</span> same directed 6-cycle at every scale` +
    `</div>` +
    `<div style="color:#1a3a2a;font-size:11px;margin-top:6px">each layer = one ×2 mod 9 step</div>`;

  // ── Animation ──
  const TRAVEL = 0.50, DWELL = 1.4, STEP = TRAVEL + DWELL;
  const tFrac  = TRAVEL / STEP;
  let lastT    = null;
  let oPhase   = 0;
  let mirrorAlpha = 0;

  R.animFn = (t) => {
    const dt = lastT === null ? 0 : Math.min(t - lastT, 0.08);
    lastT = t;
    oPhase = (oPhase + dt / STEP) % ORBIT_SEQ.length;

    const oStep = Math.floor(oPhase) % ORBIT_SEQ.length;
    const oFrac = oPhase - Math.floor(oPhase);
    const oPct  = Math.min(oFrac / tFrac, 1.0);
    const interp = oFrac < tFrac ? easeInOut(oPct) : 1.0;

    // Move all three scale pulses in sync along their respective rings
    for (let si = 0; si < SCALES.length; si++) {
      const pos = arcLerp(allArcs[si][oStep], interp);
      pulses[si].mesh.position.copy(pos);
      pulses[si].glow.position.copy(pos);
    }

    // Highlight active node at all three scales
    for (let si = 0; si < SCALES.length; si++) {
      for (const { mat, i } of allMeshes[si]) {
        const active = (i === oStep);
        mat.emissiveIntensity = active ? 0.70 : 0.12;
        mat.opacity = active ? 1.0 : 0.82;
      }
    }

    // Mirror flash
    const isReturn = (oStep === 0 && oFrac < 0.82);
    mirrorAlpha = isReturn
      ? Math.min(mirrorAlpha + dt * 1.8, 1.0)
      : Math.max(mirrorAlpha - dt * 0.9, 0.0);
    mirrorDiv.style.opacity = mirrorAlpha.toFixed(3);
    layerDiv.textContent    = isReturn ? 'L6 → L0' : `LAYER ${oStep + 1}`;
    layerDiv.style.opacity  = isReturn ? '1' : '0.70';
  };
}
