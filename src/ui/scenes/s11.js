/**
 * OLIVER 42 — Scene 11
 *
 * The complement: {3, 6, 9} under ×2 mod 9.
 * 3 → 6 → 3 → 6 … (2-cycle). 9 collapses to nil — the absent void at the bridge.
 * Bernoulli lemniscate (∞): right loop = 3, left loop = 6, crossing = absent 9.
 * 42 cycles = 2 × F₈ = 2 × 21. The complement's answer to jennie21.
 */
import {
  THREE, CSS2DObject, R, mkCamera, mkControls,
  tip, tmv, htip,
} from './shared.js';

const C3  = 0xaa44ff;  // violet — node 3
const C6  = 0xff44cc;  // rose   — node 6
const C9  = 0x1a1122;  // void   — node 9 (absent)
const CS3 = '#cc66ff';
const CS6 = '#ff66cc';
const CS9 = '#333344';

// ── Bernoulli lemniscate ───────────────────────────────────────────────────────
const A = 4.0;
function lemPt(t) {
  const s = Math.sin(t), c = Math.cos(t);
  const d = 1 + s * s;
  return new THREE.Vector3(A * c / d, A * s * c / d, 0);
}

// BT in Wife's notation (5=−1, 6=0, 7=+1 centered on 6)
function toBT(n) {
  if (n === 0) return '6';
  const digits = [];
  let x = n;
  while (x !== 0) {
    const r = ((x % 3) + 3) % 3;
    if      (r === 0) { digits.push('6'); x =  x / 3; }
    else if (r === 1) { digits.push('7'); x = (x - 1) / 3; }
    else              { digits.push('5'); x = (x + 1) / 3; }
  }
  return digits.reverse().join('');
}

export function buildS11() {
  const canvas = R.canvas, ov = R.ov;
  const scene  = R.scene  = new THREE.Scene();
  const camera = R.camera = mkCamera();
  camera.position.set(0, 1.5, 13);
  camera.lookAt(0, 0, 0);
  const controls = R.controls = mkControls(camera);
  controls.autoRotate      = true;
  controls.autoRotateSpeed = 0.22;

  // ── Build lemniscate curve segments ────────────────────────────────────────
  const SEGS = 384;
  const HALF = SEGS / 2;

  // Right loop  (t: −π/2 → +π/2)  — node 3
  const rightPts = [];
  for (let i = 0; i <= HALF; i++) {
    rightPts.push(lemPt(-Math.PI / 2 + (i / HALF) * Math.PI));
  }
  // Left loop (t: +π/2 → +3π/2) — node 6
  const leftPts = [];
  for (let i = 0; i <= HALF; i++) {
    leftPts.push(lemPt(Math.PI / 2 + (i / HALF) * Math.PI));
  }

  const makeTube = (pts, color, opacity = 0.80) => {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const geo   = new THREE.TubeGeometry(curve, HALF, 0.055, 6, false);
    const mat   = new THREE.MeshPhongMaterial({
      color, emissive: color, emissiveIntensity: 0.30,
      transparent: true, opacity, shininess: 60,
    });
    R.disposables.push(geo, mat);
    return new THREE.Mesh(geo, mat);
  };

  scene.add(makeTube(rightPts, C3));
  scene.add(makeTube(leftPts,  C6));

  // ── Apex nodes ──────────────────────────────────────────────────────────────
  const node3pos = lemPt(0);          // (+A, 0, 0) — right apex
  const node6pos = lemPt(Math.PI);    // (−A, 0, 0) — left apex
  const node9pos = new THREE.Vector3(0, 0, 0); // crossing = void

  const makeApex = (pos, color, radius = 0.30) => {
    const geo = new THREE.SphereGeometry(radius, 24, 16);
    const mat = new THREE.MeshPhongMaterial({
      color, emissive: color, emissiveIntensity: 0.45,
      transparent: true, opacity: 0.92, shininess: 80,
    });
    R.disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    m.userData = { baseEI: 0.45 };
    scene.add(m);
    return m;
  };

  const mesh3 = makeApex(node3pos, C3);
  const mesh6 = makeApex(node6pos, C6);

  // Bridge void — a dim ring where 9 should be
  { const geo = new THREE.TorusGeometry(0.26, 0.045, 8, 40);
    const mat = new THREE.MeshBasicMaterial({ color: 0x2a1a44, transparent: true, opacity: 0.30 });
    R.disposables.push(geo, mat);
    scene.add(new THREE.Mesh(geo, mat)); }

  // ── CSS2D labels ────────────────────────────────────────────────────────────
  const lbl = (txt, pos, color, size = '14px') => {
    const div = document.createElement('div');
    div.className = 'node-lbl';
    div.textContent = txt;
    div.style.cssText = `font-size:${size};color:${color};`;
    const o = new CSS2DObject(div);
    o.position.copy(pos);
    scene.add(o);
    R.css2dObjects.push(o);
    return o;
  };

  lbl('3',             node3pos.clone().add(new THREE.Vector3(0.75,  0.55, 0)), CS3, '18px');
  lbl(`BT: ${toBT(3)}`, node3pos.clone().add(new THREE.Vector3(0.75, -0.10, 0)), '#7744aa', '9px');
  lbl('6',             node6pos.clone().add(new THREE.Vector3(-0.75,  0.55, 0)), CS6, '18px');
  lbl(`BT: ${toBT(6)}`, node6pos.clone().add(new THREE.Vector3(-0.75, -0.10, 0)), '#aa4488', '9px');
  lbl('—',             new THREE.Vector3(0, 0.52, 0), CS9, '20px'); // 9 as the dash

  // ── Pulsing traveler ────────────────────────────────────────────────────────
  const travGeo = new THREE.SphereGeometry(0.17, 16, 10);
  const travMat = new THREE.MeshPhongMaterial({
    color: C3, emissive: C3, emissiveIntensity: 1.0,
    transparent: true, opacity: 0.95,
  });
  R.disposables.push(travGeo, travMat);
  const traveler = new THREE.Mesh(travGeo, travMat);
  scene.add(traveler);

  // Tail
  const TAIL = 18;
  const tailArr  = new Float32Array((TAIL + 1) * 3);
  const tailGeo  = new THREE.BufferGeometry();
  const tailAttr = new THREE.BufferAttribute(tailArr, 3);
  tailAttr.setUsage(THREE.DynamicDrawUsage);
  tailGeo.setAttribute('position', tailAttr);
  const tailMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 });
  R.disposables.push(tailGeo, tailMat);
  scene.add(new THREE.Line(tailGeo, tailMat));
  const tailHistory = [];

  // ── Background clock ring (∞ inside the clock) ─────────────────────────────
  const CKR = 6.8;
  { const geo = new THREE.TorusGeometry(CKR, 0.020, 6, 120);
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a0830, transparent: true, opacity: 0.50 });
    R.disposables.push(geo, mat);
    scene.add(new THREE.Mesh(geo, mat)); }

  for (let h = 1; h <= 12; h++) {
    const a   = Math.PI / 2 - (h % 12) * (Math.PI / 6);
    const cx  = CKR * Math.cos(a);
    const cy  = CKR * Math.sin(a);
    const isC = h % 3 === 0; // cardinal (multiple of 3) — oliver42 nodes
    const is9 = h === 9;

    const r   = isC ? 0.14 : 0.07;
    const col = is9 ? 0x1a0820 : isC ? 0x553377 : 0x0a0818;
    const geo = new THREE.SphereGeometry(r, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: isC ? 0.55 : 0.20 });
    R.disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx, cy, 0);
    scene.add(m);

    if (isC) {
      const text = is9 ? '—' : String(h);
      const color = is9 ? '#1a0820' : '#553377';
      lbl(text, new THREE.Vector3(cx * 1.11, cy * 1.11, 0), color, '9px');
    }
  }

  // ── Lighting ────────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0x080618, 2.5));
  const pl3 = new THREE.PointLight(C3, 3.0, 22);
  pl3.position.set(5, 4, 4);
  scene.add(pl3);
  const pl6 = new THREE.PointLight(C6, 2.5, 22);
  pl6.position.set(-5, 3, 4);
  scene.add(pl6);

  // ── Hover tooltip (raycasting on the apex meshes) ──────────────────────────
  const hoverables = [mesh3, mesh6];
  let lastHl = -1;

  canvas.addEventListener('mousemove', (e) => {
    if (R.cur !== 10) return; // scene index 10 = oliver42
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects(hoverables);
    if (hits.length > 0) {
      const m = hits[0].object;
      const val = m === mesh3 ? 3 : 6;
      const cs  = m === mesh3 ? CS3 : CS6;
      const echo = m === mesh3 ? 6 : 3; // 3↔6 are each other's echo in the 2-cycle
      let h = `<div class="th" style="color:${cs}">${val}</div>`;
      h += `<p class="tr">BT: <b>${toBT(val)}</b></p>`;
      h += `<p class="tr">×2 mod 9 → <b>${echo}</b> (2-cycle)</p>`;
      h += `<p class="tr" style="color:#888aaa">complement of jennie21 orbit</p>`;
      tip(e, h);
      m.material.emissiveIntensity = 1.2;
      tmv(e);
    } else {
      htip();
      hoverables.forEach(m => { m.material.emissiveIntensity = m.userData.baseEI; });
    }
  });
  canvas.addEventListener('mouseleave', () => { if (R.cur === 10) htip(); });

  // ── Controls ────────────────────────────────────────────────────────────────
  const rotBtn = document.getElementById('p11rot');
  if (rotBtn) {
    rotBtn.onclick = () => {
      controls.autoRotate = !controls.autoRotate;
      rotBtn.classList.toggle('lit', controls.autoRotate);
    };
  }

  // ── Clock display ───────────────────────────────────────────────────────────
  if (R.clkDisplay) {
    R.clkDisplay.innerHTML =
      `<div style="color:#aa44ff;letter-spacing:.1em">11 · OLIVER 42</div>` +
      `<div style="color:#553377;margin-top:3px;font-size:8px">3 → 6 → 3 · the complement breathes</div>`;
  }

  // ── Animation ────────────────────────────────────────────────────────────────
  const LOOP_T   = 5.0;  // seconds per full lemniscate loop
  let startTime  = null;

  R.animFn = (now) => {
    if (startTime === null) startTime = now;
    const elapsed = (now - startTime) / 1000;

    const rawLoops = elapsed / LOOP_T;
    const cycle    = (Math.floor(rawLoops) % 42) + 1;
    const t        = (rawLoops % 1) * Math.PI * 2;

    // Traveler
    const pos = lemPt(t);
    traveler.position.copy(pos);

    // Color follows which loop we're in
    const inRight = t < Math.PI / 2 || t > 3 * Math.PI / 2;
    const col = inRight ? C3 : C6;
    travMat.color.setHex(col);
    travMat.emissive.setHex(col);

    // Dim at the bridge crossing
    const d9 = pos.length();
    travMat.opacity = 0.95 - 0.72 * Math.max(0, 1 - d9 / 0.5);

    // Apex pulse when traveler is near
    const d3 = pos.distanceTo(node3pos);
    const d6 = pos.distanceTo(node6pos);
    mesh3.material.emissiveIntensity = 0.45 + 2.2 * Math.max(0, 1 - d3 / 1.0);
    mesh6.material.emissiveIntensity = 0.45 + 2.2 * Math.max(0, 1 - d6 / 1.0);

    // Tail
    tailHistory.push(pos.clone());
    if (tailHistory.length > TAIL) tailHistory.shift();
    for (let i = 0; i < tailHistory.length; i++) {
      tailArr[i * 3]     = tailHistory[i].x;
      tailArr[i * 3 + 1] = tailHistory[i].y;
      tailArr[i * 3 + 2] = tailHistory[i].z;
    }
    tailAttr.needsUpdate = true;
    tailGeo.setDrawRange(0, tailHistory.length);

    // Cycle counter in clock display
    if (R.clkDisplay) {
      R.clkDisplay.innerHTML =
        `<div style="color:#aa44ff;letter-spacing:.1em">11 · OLIVER 42</div>` +
        `<div style="color:#553377;margin-top:3px;font-size:8px">cycle ${String(cycle).padStart(2, '0')} / 42</div>`;
    }
  };
}
