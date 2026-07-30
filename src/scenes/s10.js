// ─────────────────────────────────────────────────────
//  SCENE 10 — MOD-9 ORBIT CYCLE
//  ×2 mod 9 orbit {1,2,4,8,7,5}, echo pairs, driver group,
//  absent trio {3,6,9}, animated pulse.
// ─────────────────────────────────────────────────────
import {
  THREE, CSS2DObject, R, mkCamera, mkControls, CG, CC, CY, CO,
} from './shared.js';

const ORBIT   = [1, 2, 4, 8, 7, 5];
const ABSENT  = [3, 6, 9];
const DRIVER  = new Set([2, 4, 7]);
const ECHO    = [[1, 8], [2, 7], [4, 5]];
const M       = ORBIT.length;
const R_ORB   = 3.8;
const R_ABS   = 1.55;
const NODE_R  = 0.32;
const ABS_R   = 0.20;
const ARC_SEG = 28;
const PULSE_DUR = 3.6; // seconds per full orbit

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

  // Guide rings in XZ plane
  const addRing = (r, col) => {
    const g = new THREE.RingGeometry(r - 0.015, r + 0.015, 72);
    const m = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide });
    R.disposables.push(g, m);
    scene.add(new THREE.Mesh(g, m));
  };
  addRing(R_ORB, 0x0a1a0a);
  addRing(R_ABS, 0x080c08);

  // Echo pair lines
  ECHO.forEach(([a, b]) => {
    const ia = ORBIT.indexOf(a), ib = ORBIT.indexOf(b);
    const pts = [orbitPos(ia), orbitPos(ib)];
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color: 0x1a3a2a, transparent: true, opacity: 0.5 });
    R.disposables.push(g, m);
    scene.add(new THREE.Line(g, m));
  });

  // Orbit arc arrows
  const arcPtSets = [];
  for (let i = 0; i < M; i++) {
    const a0 = orbitAngle(i);
    let da = orbitAngle((i + 1) % M) - a0;
    if (da > Math.PI)  da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    const pts = [];
    for (let s = 0; s <= ARC_SEG; s++) {
      const frac = s / ARC_SEG;
      const aa = a0 + da * frac;
      const lift = 0.08 * Math.sin(frac * Math.PI);
      pts.push(new THREE.Vector3(Math.cos(aa) * R_ORB, lift, Math.sin(aa) * R_ORB));
    }
    arcPtSets.push(pts);
    const col = orbitColor(ORBIT[i]);
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.4 });
    R.disposables.push(g, m);
    scene.add(new THREE.Line(g, m));

    // Arrowhead cone near dest
    const tip = pts[pts.length - 3];
    const d   = new THREE.Vector3().subVectors(pts[pts.length - 1], pts[pts.length - 4]).normalize();
    const cg  = new THREE.ConeGeometry(0.08, 0.22, 8);
    const cm  = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6 });
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
    const m = new THREE.MeshPhongMaterial({ color: col, emissive: col, emissiveIntensity: 0.3, transparent: true, opacity: 0.92, shininess: 110 });
    R.disposables.push(g, m);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.copy(pos);
    scene.add(mesh);

    // Floor glow ring
    const rg = new THREE.RingGeometry(NODE_R + 0.05, NODE_R + 0.20, 32);
    const rm = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.15 });
    R.disposables.push(rg, rm);
    const ring = new THREE.Mesh(rg, rm);
    ring.position.copy(pos);
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);

    // Label
    const div = document.createElement('div');
    div.textContent = String(v);
    const isDriver = DRIVER.has(v);
    div.style.cssText = [
      `font-family:'Courier New',monospace`,
      `font-size:${isDriver ? 15 : 13}px`,
      `font-weight:bold`,
      `color:${isDriver ? '#ff9800' : v === 1 ? '#ffe600' : '#00ff88'}`,
      `text-shadow:0 0 8px currentColor`,
      `pointer-events:none;user-select:none`,
    ].join(';');
    const lbl = new CSS2DObject(div);
    lbl.position.set(pos.x, NODE_R + 0.38, pos.z);
    scene.add(lbl);
    R.css2dObjects.push(lbl);

    nodeObjs.push({ mesh, ring, m, rm, v, i });
  });

  // Absent trio
  ABSENT.forEach((v, i) => {
    const pos = absentPos(i);
    const g = new THREE.SphereGeometry(ABS_R, 14, 10);
    const m = new THREE.MeshPhongMaterial({ color: 0x0e180e, emissive: 0x060c06, transparent: true, opacity: 0.45, shininess: 20 });
    R.disposables.push(g, m);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.copy(pos);
    scene.add(mesh);

    const div = document.createElement('div');
    div.textContent = String(v);
    div.style.cssText = [
      `font-family:'Courier New',monospace`,
      `font-size:10px`,
      `color:${v === 6 ? '#253545' : '#1a2a1a'}`,
      `pointer-events:none;user-select:none`,
    ].join(';');
    const lbl = new CSS2DObject(div);
    lbl.position.set(pos.x, ABS_R + 0.28, pos.z);
    scene.add(lbl);
    R.css2dObjects.push(lbl);
  });

  // Center label
  const cd = document.createElement('div');
  cd.innerHTML = `<div style="font-family:'Courier New',monospace;font-size:8.5px;color:#2a5a3a;text-align:center;line-height:1.7;pointer-events:none">×2 mod 9</div>`;
  const cl = new CSS2DObject(cd);
  cl.position.set(0, 0.1, 0);
  scene.add(cl);
  R.css2dObjects.push(cl);

  // Pulse
  const pg = new THREE.SphereGeometry(0.15, 14, 10);
  const pm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
  R.disposables.push(pg, pm);
  const pulse = new THREE.Mesh(pg, pm);
  scene.add(pulse);

  const pgg = new THREE.SphereGeometry(0.30, 10, 8);
  const pgm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 });
  R.disposables.push(pgg, pgm);
  const pGlow = new THREE.Mesh(pgg, pgm);
  scene.add(pGlow);

  // OV writeup
  R.ov.innerHTML =
    `<div style="color:#4ac880;letter-spacing:.1em">10 · ORBIT CYCLE</div>` +
    `<div style="color:#ff9800;font-size:8px;margin-top:2px">×2 mod 9 · period 6</div>` +
    `<div style="color:#5a8a6a;font-size:7.5px;margin-top:2px">1→2→4→8→7→5→1</div>` +
    `<div style="font-size:7px;margin-top:2px">` +
      `<span style="color:#ff9800">driver {2,4,7}</span>&nbsp;` +
      `<span style="color:#00ff88">echo {1,5,8}</span></div>` +
    `<div style="color:#5a7a8a;font-size:7px;margin-top:2px">echo pairs: 1↗8 · 2↗7 · 4↗5</div>` +
    `<div style="color:#1a2a1a;font-size:7px;margin-top:1px">absent: 3, 6, 9</div>`;

  // Animation
  R.animFn = (t) => {
    controls.update();

    // Pulse along arc path
    const phase = (t / PULSE_DUR) % 1;
    const seg   = phase * M;
    const segI  = Math.floor(seg) % M;
    const segF  = seg - Math.floor(seg);
    const pts   = arcPtSets[segI];
    const raw   = segF * (pts.length - 1);
    const pi0   = Math.floor(raw), pi1 = Math.min(pi0 + 1, pts.length - 1);
    const pPos  = new THREE.Vector3().lerpVectors(pts[pi0], pts[pi1], raw - pi0);
    pulse.position.copy(pPos);
    pGlow.position.copy(pPos);

    const srcCol = new THREE.Color(orbitColor(ORBIT[segI]));
    pm.color.copy(srcCol);
    pgm.color.copy(srcCol);

    // Node brightness follows pulse proximity
    nodeObjs.forEach(({ m, rm, i }) => {
      const dist = Math.abs(((seg - i) % M + M) % M);
      const near = Math.min(dist, M - dist);
      const b = Math.max(0, 1 - near * 1.1);
      m.emissiveIntensity = 0.22 + b * 0.70;
      rm.opacity = 0.10 + b * 0.38;
    });
  };
}
