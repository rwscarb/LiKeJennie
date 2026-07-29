// ─────────────────────────────────────────────────────
//  SCENE 9 — jennie22: Fibonacci × Tribonacci period rings
// ─────────────────────────────────────────────────────
import {
  THREE, CSS2DObject, R, mkCamera, mkControls,
  tip, tmv, htip,
} from './shared.js';

const PHI_T = 1.8392867552141612;
const ORBIT = new Set([1, 2, 4, 5, 7, 8]);
const COL_ORBIT = 0xff4081, COL_AXIS = 0xc060ff, COL_ZERO = 0x555566;
const SCOL_ORBIT = '#ff4081', SCOL_AXIS = '#c060ff', SCOL_ZERO = '#555566';

function seqColor(v) {
  return v === 0 ? COL_ZERO : ORBIT.has(v) ? COL_ORBIT : COL_AXIS;
}
function seqSColor(v) {
  return v === 0 ? SCOL_ZERO : ORBIT.has(v) ? SCOL_ORBIT : SCOL_AXIS;
}

function fibMod9(n) {
  const s = [0, 1];
  while (s.length < n) s.push((s[s.length - 1] + s[s.length - 2]) % 9);
  return s.slice(0, n);
}
function tribMod9(n) {
  const s = [0, 1, 1];
  while (s.length < n) s.push((s[s.length - 1] + s[s.length - 2] + s[s.length - 3]) % 9);
  return s.slice(0, n);
}

const FP = 24, TP = 39;
const fibSeq = fibMod9(FP), tribSeq = tribMod9(TP);

export function buildS9() {
  const canvas = R.canvas, ov = R.ov;
  const scene = R.scene = new THREE.Scene();
  const camera = R.camera = mkCamera();
  camera.position.set(0, 0, 22); camera.lookAt(0, 0, 0);
  const controls = R.controls = mkControls(camera);
  controls.autoRotate = true; controls.autoRotateSpeed = .4;

  function floatLbl(txt, x, y, z, color, fs) {
    const div = document.createElement('div');
    div.className = 'angle-lbl';
    div.style.fontSize = fs || '11px';
    div.style.color = color || '#fff';
    div.style.opacity = '1';
    div.textContent = txt;
    const lbl = new CSS2DObject(div);
    lbl.position.set(x, y, z);
    scene.add(lbl);
    R.css2dObjects.push(lbl);
  }

  function buildRing(seq, R_ring, cx, cy) {
    const count = seq.length;
    const grp = new THREE.Group();
    grp.position.set(cx, cy, 0);
    scene.add(grp);

    const rg = new THREE.TorusGeometry(R_ring, .025, 8, 120);
    const rm = new THREE.MeshBasicMaterial({ color: 0x1a1a2e, transparent: true, opacity: .7 });
    R.disposables.push(rg, rm);
    grp.add(new THREE.Mesh(rg, rm));

    const meshes = [];
    for (let i = 0; i < count; i++) {
      const a = Math.PI / 2 - i * (2 * Math.PI / count);
      const v = seq[i];
      const isZero = v === 0;
      const inOrbit = ORBIT.has(v);
      const col = seqColor(v);
      const rad = isZero ? .09 : inOrbit ? .16 : .13;
      const ei = isZero ? .1 : inOrbit ? .5 : .3;
      const geo = new THREE.SphereGeometry(rad, 16, 10);
      const mat = new THREE.MeshPhongMaterial({
        color: col, emissive: col, emissiveIntensity: ei,
        transparent: true, opacity: isZero ? .5 : .85, shininess: 60,
      });
      R.disposables.push(geo, mat);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(R_ring * Math.cos(a), R_ring * Math.sin(a), 0);
      m.userData = { i, v, inOrbit, isZero, baseEI: ei };
      grp.add(m);
      meshes.push(m);
    }
    return { grp, meshes };
  }

  const { grp: fibGrp, meshes: fibMeshes } = buildRing(fibSeq, 4.2, -5.5, 0);
  const { grp: tribGrp, meshes: tribMeshes } = buildRing(tribSeq, 5.2, 6.0, 0);

  // divider
  { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(.5, -6, 0), new THREE.Vector3(.5, 6, 0)]);
    const m = new THREE.LineDashedMaterial({ color: 0x1a2a1a, dashSize: .2, gapSize: .15, transparent: true, opacity: .6 });
    const l = new THREE.Line(g, m); l.computeLineDistances(); R.disposables.push(g, m); scene.add(l); }

  // labels
  floatLbl('Fibonacci mod 9', -5.5, 5.8, 0, '#ff9800', '12px');
  floatLbl('period = 24 = 3×8 = 3×F₆', -5.5, 5.1, 0, '#ff9800', '10px');
  floatLbl('Tribonacci mod 9', 6.0, 6.5, 0, '#ff4081', '12px');
  floatLbl('period = 39 = 3×13 = 3×F₇', 6.0, 5.8, 0, '#ff4081', '10px');
  floatLbl('F₇ = T₆ = 13', 6.0, 5.1, 0, '#c060ff', '10px');
  floatLbl('φ = 1.618', -5.5, -5.6, 0, '#ff9800', '10px');
  floatLbl('φᵀ = 1.839', 6.0, -6.2, 0, '#ff4081', '10px');
  floatLbl('cascade: 1 : φᵀ : φᵀ²', 6.0, -6.9, 0, '#ffe033', '9px');

  ov.innerHTML = `
    <div style="line-height:1.55;font-size:.58rem">
      <span style="color:#ff9800">&#9679;</span> Fibonacci&nbsp;&nbsp;
      <span style="color:#ff4081">&#9679;</span> Tribonacci<br>
      <span style="color:#ff4081">&#9632;</span> orbit {1,2,4,5,7,8}&nbsp;&nbsp;
      <span style="color:#c060ff">&#9632;</span> axis {3,6}&nbsp;&nbsp;
      <span style="color:#555566">&#9632;</span> zero<br>
      <span style="color:#ffe033">F&#8327; = T&#8326; = 13 &nbsp;&middot;&nbsp; T&#8327; = 24 = Fib period</span>
    </div>`;

  // auto-rotate button
  const rotBtn = document.getElementById('p10rot');
  if (rotBtn) {
    rotBtn.classList.toggle('lit', controls.autoRotate);
    rotBtn.onclick = () => {
      controls.autoRotate = !controls.autoRotate;
      rotBtn.classList.toggle('lit', controls.autoRotate);
    };
  }

  const stat = document.getElementById('p10stat');
  let lastFib = -1, lastTrib = -1;

  canvas.addEventListener('mousemove', e => {
    if (R.cur !== 9) return;
    const bnd = canvas.getBoundingClientRect();
    const mx = ((e.clientX - bnd.left) / bnd.width) * 2 - 1;
    const my = -((e.clientY - bnd.top) / bnd.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: mx, y: my }, camera);

    if (lastFib >= 0) { fibMeshes[lastFib].material.emissiveIntensity = fibMeshes[lastFib].userData.baseEI; fibMeshes[lastFib].scale.setScalar(1); }
    if (lastTrib >= 0) { tribMeshes[lastTrib].material.emissiveIntensity = tribMeshes[lastTrib].userData.baseEI; tribMeshes[lastTrib].scale.setScalar(1); }
    lastFib = -1; lastTrib = -1;

    const hits = ray.intersectObjects([...fibMeshes, ...tribMeshes]);
    if (hits.length > 0) {
      const m = hits[0].object;
      const { i, v, inOrbit, isZero } = m.userData;
      const isFib = fibMeshes.includes(m);
      if (isFib) { lastFib = i; fibMeshes[i].material.emissiveIntensity = 1; fibMeshes[i].scale.setScalar(1.4); }
      else        { lastTrib = i; tribMeshes[i].material.emissiveIntensity = 1; tribMeshes[i].scale.setScalar(1.4); }
      const seq = isFib ? 'Fibonacci' : 'Tribonacci';
      const period = isFib ? FP : TP;
      const sCol = seqSColor(v);
      let h = `<div class="th" style="color:${sCol}">${seq}[${i}] = ${v}</div>`;
      h += `<p class="tr">${seq} index ${i} of ${period - 1} &nbsp;&middot;&nbsp; value ${v} mod 9</p>`;
      h += `<p class="tr">${isZero ? 'zero — gap in the orbit' : inOrbit ? 'orbit member {1,2,4,5,7,8}' : 'axis {3,6} — complement of orbit'}</p>`;
      if (!isFib && i === 6 && v === 13 % 9) h += `<p class="tr" style="color:#ffe033">T₆ = 13 — the handshake value</p>`;
      if (!isFib && i === 7) h += `<p class="tr" style="color:#c060ff">T₇ = 24 = Fibonacci period</p>`;
      tip(e, h); if (stat) stat.textContent = `${seq}[${i}] = ${v}`; tmv(e);
    } else {
      htip(); if (stat) stat.textContent = '';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (R.cur !== 9) return;
    if (lastFib >= 0) { fibMeshes[lastFib].material.emissiveIntensity = fibMeshes[lastFib].userData.baseEI; fibMeshes[lastFib].scale.setScalar(1); }
    if (lastTrib >= 0) { tribMeshes[lastTrib].material.emissiveIntensity = tribMeshes[lastTrib].userData.baseEI; tribMeshes[lastTrib].scale.setScalar(1); }
    lastFib = -1; lastTrib = -1; htip();
  });

  R.animFn = () => {
    const t = Date.now() * .001;
    fibGrp.rotation.z += .003;
    tribGrp.rotation.z -= .002;
    fibMeshes.forEach((m, i) => { if (i !== lastFib && m.userData.inOrbit) m.material.emissiveIntensity = m.userData.baseEI + .2 * Math.abs(Math.sin(t * 1.2 + i * .4)); });
    tribMeshes.forEach((m, i) => { if (i !== lastTrib && m.userData.inOrbit) m.material.emissiveIntensity = m.userData.baseEI + .2 * Math.abs(Math.sin(t * 1.1 + i * .3)); });
    R.labelRenderer.render(scene, camera);
  };
}
