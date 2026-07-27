// ─────────────────────────────────────────────────────
//  SCENE 0 — 3D Divisor Lattice
// ─────────────────────────────────────────────────────
import {
  THREE, CSS2DObject, R, mkCamera, mkControls,
  CG, CC, nodeHex, nodeCls,
  tip, tmv, htip, ntip,
} from './shared.js';

export function buildS0() {
  const canvas = R.canvas, ov = R.ov;
  const scene = R.scene = new THREE.Scene();
  const camera = R.camera = mkCamera(); camera.position.set(0, 0, 13);
  const controls = R.controls = mkControls(camera);
  controls.autoRotate = true; controls.autoRotateSpeed = 0.6;

  const left = [1, 2, 4, 8, 16, 32, 64, 128], right = [7, 14, 28, 56, 112, 224, 448, 896];
  const sGeo = new THREE.SphereGeometry(.38, 24, 16);
  R.disposables.push(sGeo);
  const meshes = [];
  [...left, ...right].forEach((n, i) => {
    const isL = i < 8, row = i % 8;
    const c = nodeHex(n);
    const mat = new THREE.MeshPhongMaterial({ color: c, emissive: c, emissiveIntensity: .28, shininess: 70, transparent: true, opacity: .92 });
    R.disposables.push(mat);
    const m = new THREE.Mesh(sGeo, mat);
    const xPos = isL ? -2.8 : 2.8;
    m.position.set(xPos, 3.5 - row, 0);
    m.userData = { n, c }; scene.add(m); meshes.push(m);
    // always-visible label
    const div = document.createElement('div');
    div.className = 'node-lbl';
    div.style.color = nodeCls(n).c;
    div.textContent = n;
    const lbl = new CSS2DObject(div);
    lbl.position.set(isL ? -1.6 : 1.6, 3.5 - row, 0);
    scene.add(lbl); R.css2dObjects.push(lbl);
  });
  const mkLine = (pts, c, op) => { const g = new THREE.BufferGeometry().setFromPoints(pts); const m = new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: op }); R.disposables.push(g, m); return new THREE.Line(g, m); };
  for (let i = 0; i < 7; i++) {
    scene.add(mkLine([new THREE.Vector3(-2.8, 3.5 - i - .42, 0), new THREE.Vector3(-2.8, 3.5 - (i + 1) + .42, 0)], CG, .4));
    scene.add(mkLine([new THREE.Vector3(2.8, 3.5 - i - .42, 0), new THREE.Vector3(2.8, 3.5 - (i + 1) + .42, 0)], CC, .4));
  }
  for (let i = 0; i < 8; i++) {
    const y = 3.5 - i;
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-2.42, y, 0), new THREE.Vector3(2.42, y, 0)]);
    const m = new THREE.LineDashedMaterial({ color: 0x203040, dashSize: .14, gapSize: .14, transparent: true, opacity: .7 });
    const l = new THREE.Line(g, m); l.computeLineDistances(); R.disposables.push(g, m); scene.add(l);
  }
  scene.add(new THREE.AmbientLight(0xffffff, .15));
  const pl = new THREE.PointLight(0x00ff88, 1.3, 30); pl.position.set(0, 0, 10); scene.add(pl);
  const pl2 = new THREE.PointLight(0x00e5ff, .7, 20); pl2.position.set(-5, 5, -5); scene.add(pl2);

  ov.innerHTML = `<div style="color:#2a8060;letter-spacing:.1em">01 · DIVISOR LATTICE</div><div style="color:#2a5a40;margin-top:4px">left&nbsp; : 2^k</div><div style="color:#2a5a40">right : 7·2^k</div><div style="color:#2a5a40">dash&nbsp; : ×7 links</div><div style="color:#2a5a40">line&nbsp; : ×2 links</div>`;

  const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2(); let lastHl = -1;
  const stat = document.getElementById('p1stat');
  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(mouse, R.camera);
    const hits = ray.intersectObjects(meshes);
    const idx = hits.length > 0 ? meshes.indexOf(hits[0].object) : -1;
    if (idx !== lastHl) {
      if (lastHl >= 0) { meshes[lastHl].material.emissiveIntensity = .28; meshes[lastHl].scale.setScalar(1); }
      if (idx >= 0) { meshes[idx].material.emissiveIntensity = .95; meshes[idx].scale.setScalar(1.35); }
      lastHl = idx;
    }
    if (idx >= 0) { const n = meshes[idx].userData.n; tip(e, ntip(n, idx < 8 ? `= 2^${idx}` : `= 7 × 2^${idx - 8}`)); stat.textContent = `n = ${n}`; }
    else { htip(); stat.textContent = ''; }
    if (idx >= 0) tmv(e);
  });
  canvas.addEventListener('mouseleave', () => { if (lastHl >= 0) { meshes[lastHl].material.emissiveIntensity = .28; meshes[lastHl].scale.setScalar(1); } lastHl = -1; htip(); stat.textContent = ''; });
  R.animFn = () => {};
}
