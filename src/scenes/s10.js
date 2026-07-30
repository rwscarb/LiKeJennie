// ─────────────────────────────────────────────────────
//  SCENE 10 — MOD-9 ORBIT CYCLE
//  Step-by-step: start at 1, multiply by 2, take mod 9, repeat.
//  Pulse dwells at each node so the viewer can read the step.
// ─────────────────────────────────────────────────────
import {
  THREE, CSS2DObject, R, mkCamera, mkControls, CG, CC, CY, CO,
} from './shared.js';

const ORBIT  = [1, 2, 4, 8, 7, 5];
const ABSENT = [3, 6, 9];
const DRIVER = new Set([2, 4, 7]);
const ECHO   = [[1, 8], [2, 7], [4, 5]];
const M      = ORBIT.length;
const R_ORB  = 3.8;
const R_ABS  = 1.55;
const NODE_R = 0.32;
const ABS_R  = 0.20;
const ARC_SEG = 32;

// Timing: each step = TRAVEL_T (moving) + DWELL_T (sitting)
const TRAVEL_T = 0.7;   // seconds to move between nodes
const DWELL_T  = 2.2;   // seconds to pause at node
const STEP_T   = TRAVEL_T + DWELL_T;
const ORBIT_T  = M * STEP_T; // seconds for one full orbit

function orbitAngle(i) {
  return (i / M) * Math.PI * 2 - Math.PI / 2;
}
function orbitPos(i, y = 0) {
  const a = orbitAngle(i);
  return new THREE.Vector3(Math.cos(a) * R_ORB, y, Math.sin(a) * R_ORB);
}
function absentPos(i, y = 0) {
  const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
  return new THREE.Vector3(Math.cos(a) * R_ABS, y, Math.sin(a) * R_ABS);
}
function orbitColor(v) {
  if (DRIVER.has(v)) return CO;
  if (v === 1)       return CY;
  return CG;
}
function colorHex(v) {
  if (DRIVER.has(v)) return '#ff9800';
  if (v === 1)       return '#ffe600';
  return '#00ff88';
}

export function buildS10() {
  const scene    = R.scene    = new THREE.Scene();
  const camera   = R.camera   = mkCamera();
  camera.position.set(0, 10.5, 5);
  camera.lookAt(0, 0, 0);
  const controls = R.controls = mkControls(camera);
  controls.target.set(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(5, 10, 8);
  scene.add(dir);

  // Guide rings
  const addRing = (r, col) => {
    const g = new THREE.RingGeometry(r - 0.015, r + 0.015, 72);
    const m = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide });
    R.disposables.push(g, m);
    scene.add(new THREE.Mesh(g, m));
  };
  addRing(R_ORB, 0x0d200d);
  addRing(R_ABS, 0x080c08);

  // Echo pair lines
  const echoMats = [];
  ECHO.forEach(([a, b]) => {
    const ia = ORBIT.indexOf(a), ib = ORBIT.indexOf(b);
    const pts = [orbitPos(ia), orbitPos(ib)];
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color: 0x1a4a2a, transparent: true, opacity: 0.35 });
    R.disposables.push(g, m);
    scene.add(new THREE.Line(g, m));
    echoMats.push({ m, a, b });
  });

  // Orbit arc arrows
  const arcPtSets = [];
  const arcMats = [];
  for (let i = 0; i < M; i++) {
    const a0 = orbitAngle(i);
    let da = orbitAngle((i + 1) % M) - a0;
    if (da > Math.PI)  da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    const pts = [];
    for (let s = 0; s <= ARC_SEG; s++) {
      const frac = s / ARC_SEG;
      const aa = a0 + da * frac;
      const lift = 0.12 * Math.sin(frac * Math.PI);
      pts.push(new THREE.Vector3(Math.cos(aa) * R_ORB, lift, Math.sin(aa) * R_ORB));
    }
    arcPtSets.push(pts);
    const col = orbitColor(ORBIT[i]);
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.35 });
    R.disposables.push(g, m);
    scene.add(new THREE.Line(g, m));
    arcMats.push(m);

    // Arrowhead cone
    const tip = pts[pts.length - 3];
    const d   = new THREE.Vector3().subVectors(pts[pts.length - 1], pts[pts.length - 4]).normalize();
    const cg  = new THREE.ConeGeometry(0.10, 0.26, 8);
    const cm  = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55 });
    R.disposables.push(cg, cm);
    const cone = new THREE.Mesh(cg, cm);
    cone.position.copy(tip);
    cone.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), d));
    scene.add(cone);
  }

  // Orbit nodes
  const nodeObjs = [];
  ORBIT.forEach((v, i) => {
    const pos = orbitPos(i);
    const col = orbitColor(v);
    const g = new THREE.SphereGeometry(NODE_R, 24, 16);
    const m = new THREE.MeshPhongMaterial({ color: col, emissive: col, emissiveIntensity: 0.22, transparent: true, opacity: 0.92, shininess: 110 });
    R.disposables.push(g, m);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.copy(pos);
    scene.add(mesh);

    const rg = new THREE.RingGeometry(NODE_R + 0.05, NODE_R + 0.22, 32);
    const rm = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.10 });
    R.disposables.push(rg, rm);
    const ring = new THREE.Mesh(rg, rm);
    ring.position.copy(pos);
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);

    const div = document.createElement('div');
    div.textContent = String(v);
    const isDriver = DRIVER.has(v);
    div.style.cssText = [
      `font-family:'Courier New',monospace`,
      `font-size:${isDriver ? 16 : 14}px`,
      `font-weight:bold`,
      `color:${colorHex(v)}`,
      `text-shadow:0 0 10px currentColor`,
      `pointer-events:none;user-select:none`,
      `transition:font-size 0.2s`,
    ].join(';');
    const lbl = new CSS2DObject(div);
    lbl.position.set(pos.x, NODE_R + 0.42, pos.z);
    scene.add(lbl);
    R.css2dObjects.push(lbl);

    nodeObjs.push({ mesh, ring, m, rm, lbl, div, v, i, col });
  });

  // Absent trio
  ABSENT.forEach((v, i) => {
    const pos = absentPos(i);
    const g = new THREE.SphereGeometry(ABS_R, 14, 10);
    const m = new THREE.MeshPhongMaterial({ color: 0x0e180e, emissive: 0x060c06, transparent: true, opacity: 0.40, shininess: 20 });
    R.disposables.push(g, m);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.copy(pos);
    scene.add(mesh);

    const div = document.createElement('div');
    div.textContent = String(v);
    div.style.cssText = [
      `font-family:'Courier New',monospace`,
      `font-size:10px`,
      `color:${v === 6 ? '#253545' : '#1e2e1e'}`,
      `pointer-events:none;user-select:none`,
    ].join(';');
    const lbl = new CSS2DObject(div);
    lbl.position.set(pos.x, ABS_R + 0.28, pos.z);
    scene.add(lbl);
    R.css2dObjects.push(lbl);
  });

  // Step annotation: shows "N × 2 = 2N  →  mod 9 = M" during dwell
  const stepDiv = document.createElement('div');
  stepDiv.style.cssText = [
    `font-family:'Courier New',monospace`,
    `font-size:11px`,
    `text-align:center`,
    `line-height:1.8`,
    `pointer-events:none`,
    `user-select:none`,
    `min-width:140px`,
  ].join(';');
  const stepLbl = new CSS2DObject(stepDiv);
  stepLbl.position.set(0, 0.15, 0);
  scene.add(stepLbl);
  R.css2dObjects.push(stepLbl);

  // Pulse sphere
  const pg = new THREE.SphereGeometry(0.17, 14, 10);
  const pm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
  R.disposables.push(pg, pm);
  const pulse = new THREE.Mesh(pg, pm);
  scene.add(pulse);

  const pgg = new THREE.SphereGeometry(0.38, 10, 8);
  const pgm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.10 });
  R.disposables.push(pgg, pgm);
  const pGlow = new THREE.Mesh(pgg, pgm);
  scene.add(pGlow);

  // OV
  R.ov.innerHTML =
    `<div style="color:#4ac880;letter-spacing:.1em">10 · ORBIT CYCLE</div>` +
    `<div style="color:#ff9800;font-size:8px;margin-top:2px">×2 mod 9 · period 6</div>` +
    `<div style="color:#5a8a6a;font-size:7.5px;margin-top:2px">1→2→4→8→7→5→1</div>` +
    `<div style="font-size:7px;margin-top:2px">` +
      `<span style="color:#ff9800">driver {2,4,7}</span>&nbsp;` +
      `<span style="color:#00ff88">echo {1,5,8}</span></div>` +
    `<div style="color:#5a7a8a;font-size:7px;margin-top:2px">1↔8 · 2↔7 · 4↔5 (sum 9)</div>` +
    `<div style="color:#1e2e1e;font-size:7px;margin-top:1px">absent: 3, 6, 9</div>`;

  // ── Animation ─────────────────────────────────────────────────────────
  let lastStepI = -1;

  R.animFn = (t) => {
    controls.update();

    // Step timing: where are we in the orbit cycle?
    const cycleT  = t % ORBIT_T;
    const stepRaw = cycleT / STEP_T;
    const stepI   = Math.floor(stepRaw) % M;
    const stepF   = stepRaw - Math.floor(stepRaw); // 0..1 within this step

    // First TRAVEL_T/STEP_T fraction = moving, rest = dwelling
    const travelFrac = TRAVEL_T / STEP_T;
    const isDwelling = stepF >= travelFrac;
    const travelPct  = Math.min(stepF / travelFrac, 1.0);

    // Smooth ease-in-out for travel
    const eased = travelPct < 0.5
      ? 2 * travelPct * travelPct
      : 1 - Math.pow(-2 * travelPct + 2, 2) / 2;

    // Pulse position: travel along arc from stepI to stepI+1
    const pts    = arcPtSets[stepI];
    const raw    = eased * (pts.length - 1);
    const pi0    = Math.floor(raw), pi1 = Math.min(pi0 + 1, pts.length - 1);
    const pPos   = new THREE.Vector3().lerpVectors(pts[pi0], pts[pi1], raw - pi0);

    // During dwell, snap pulse to destination node
    const destI  = (stepI + 1) % M;
    const destPos = orbitPos(destI, isDwelling ? 0.12 : pPos.y);
    const finalPos = isDwelling ? destPos : pPos;
    pulse.position.copy(finalPos);
    pGlow.position.copy(finalPos);

    // Pulse color = source node color while traveling, dest color while dwelling
    const activeI = isDwelling ? destI : stepI;
    const srcCol = new THREE.Color(orbitColor(ORBIT[activeI]));
    pm.color.copy(srcCol);
    pgm.color.copy(srcCol);

    // Pulse glow breathes during dwell
    const breathPct = isDwelling ? (stepF - travelFrac) / (1 - travelFrac) : 0;
    const glowBeat  = 0.08 + 0.14 * Math.sin(breathPct * Math.PI * 2);
    pgm.opacity = isDwelling ? glowBeat : 0.08;
    pm.opacity  = isDwelling ? 1.0 : 0.75 + 0.25 * eased;

    // Node brightness
    nodeObjs.forEach(({ m, rm, i }) => {
      const isActive = isDwelling ? (i === destI) : (i === stepI);
      const isNext   = !isDwelling && (i === destI);
      m.emissiveIntensity  = isActive ? 0.90 : isNext ? 0.35 + 0.25 * eased : 0.15;
      rm.opacity           = isActive ? 0.50 : isNext ? 0.15 + 0.15 * eased : 0.08;
    });

    // Arc brightness: light up the active arc while traveling
    arcMats.forEach((m, i) => {
      m.opacity = (i === stepI && !isDwelling) ? 0.35 + 0.50 * eased : 0.25;
    });

    // Step annotation (update once per step)
    if (isDwelling && stepI !== lastStepI) {
      lastStepI = stepI;
      const cur  = ORBIT[stepI];
      const next = ORBIT[destI];
      const raw2 = cur * 2;
      const col  = colorHex(next);
      stepDiv.innerHTML =
        `<span style="color:#3a5a3a;font-size:9px">start</span><br>` +
        `<span style="color:${colorHex(cur)};font-size:15px;font-weight:bold">${cur}</span><br>` +
        `<span style="color:#2a4a2a;font-size:9px">× 2 = ${raw2}</span><br>` +
        `<span style="color:#2a4a2a;font-size:9px">${raw2} mod 9 =</span><br>` +
        `<span style="color:${col};font-size:15px;font-weight:bold">${next}</span>`;
    }
    if (!isDwelling && stepI !== lastStepI - 1 && lastStepI !== stepI) {
      // clear mid-travel
      const cur = ORBIT[stepI];
      stepDiv.innerHTML =
        `<span style="color:#2a4a2a;font-size:9px">× 2 mod 9</span><br>` +
        `<span style="color:${colorHex(cur)};font-size:13px;font-weight:bold">${cur} →</span>`;
    }
  };
}
