// ─────────────────────────────────────────────────────
//  SCENE 1 — 1/89 Fibonacci Convergence  (LOG SCALE)
// ─────────────────────────────────────────────────────
import {
  THREE, R, mkCamera, mkControls, CG, CC,
} from './shared.js';

export function buildS1() {
  const canvas = R.canvas, ov = R.ov;
  const scene = R.scene = new THREE.Scene();
  const camera = R.camera = mkCamera();
  camera.position.set(0, 7, 20);
  camera.lookAt(0, 0, 0);
  const controls = R.controls = mkControls(camera);
  controls.autoRotate = true; controls.autoRotateSpeed = .5;

  // 12 terms of the Fibonacci decimal expansion of 1/89
  const TERMS = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
  const TARGET = 1 / 89;
  const STEP = 90;          // frames per term (~1.5 s at 60 fps)
  const MAX_H = 5.5;
  let t = 0, _p = false, speed = 1;

  // Log-scale height so ALL bars are visible
  const vals = TERMS.map((f, i) => f / Math.pow(10, i + 2));
  const logV = vals.map(v => Math.log10(v));
  const logMin = Math.min(...logV), logMax = Math.max(...logV);
  function logH(i) { return MAX_H * (logV[i] - logMin) / (logMax - logMin) + .3; }

  const bars = [];
  TERMS.forEach((f, i) => {
    const h = logH(i);
    // Arc layout — evenly spread
    const angle = (i / (TERMS.length - 1) - .5) * Math.PI * 1.25;
    const Rr = 5.5;
    const cx = Math.sin(angle) * Rr, cz = -Math.cos(angle) * Rr;

    const geo = new THREE.BoxGeometry(.7, h, .7);
    R.disposables.push(geo);
    // Alternate green / cyan; accent Fibonacci blue on even Fib
    const c = (i % 2 === 0) ? CG : CC;
    const mat = new THREE.MeshPhongMaterial({ color: c, emissive: c, emissiveIntensity: .12, transparent: true, opacity: .88, shininess: 90 });
    R.disposables.push(mat);
    const bar = new THREE.Mesh(geo, mat);
    bar.position.set(cx, -3.5, cz);   // bottom at -3.5; we move y in animFn
    bar.scale.y = .001;
    bar.userData = { h, cx, cz, f, i, c, val: vals[i] };
    scene.add(bar); bars.push(bar);

    // Floor disk
    const fg = new THREE.CircleGeometry(.38, 16);
    const fm = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .2 });
    R.disposables.push(fg, fm);
    const fl = new THREE.Mesh(fg, fm);
    fl.rotation.x = -Math.PI / 2; fl.position.set(cx, -3.5, cz);
    scene.add(fl);
  });

  // Floor grid
  const grid = new THREE.GridHelper(18, 18, 0x081808, 0x040c04);
  grid.position.y = -3.5; scene.add(grid);

  // Convergence ring (grows at the top as sum increases)
  const rGeo = new THREE.TorusGeometry(1, .06, 8, 40);
  const rMat = new THREE.MeshBasicMaterial({ color: 0xff9800, transparent: true, opacity: .9 });
  R.disposables.push(rGeo, rMat);
  const ring = new THREE.Mesh(rGeo, rMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -3.5 + MAX_H + 1;
  ring.scale.setScalar(.01);
  scene.add(ring);

  // Thin orange "target" pillar at center
  const pg = new THREE.CylinderGeometry(.04, .04, MAX_H + 2, 8);
  const pm = new THREE.MeshBasicMaterial({ color: 0xff9800, transparent: true, opacity: .35 });
  R.disposables.push(pg, pm);
  const pillar = new THREE.Mesh(pg, pm);
  pillar.position.set(0, -3.5 + (MAX_H + 2) / 2, 0);
  scene.add(pillar);

  scene.add(new THREE.AmbientLight(0xffffff, .22));
  const pl = new THREE.PointLight(0x00ff88, 1.2, 35); pl.position.set(0, 10, 0); scene.add(pl);
  const pl2 = new THREE.PointLight(0x00e5ff, .7, 22); pl2.position.set(6, -1, 8); scene.add(pl2);

  ov.innerHTML = `<div style="color:#2a9060;letter-spacing:.1em">02 · 1/89</div><div style="color:#2a6048;margin-top:3px">bars: log scale</div><div style="color:#2a6048">each = F(n)/10^(n+1)</div><div style="color:#2a6048">sum → 1/89 = 0.01123...</div><div id="ovconv" style="color:#ff9800;margin-top:5px;font-size:10px;letter-spacing:.06em">0.00000000</div><div id="ovterm" style="color:#00e5ff;font-size:8px;margin-top:1px"></div>`;

  document.getElementById('p2pp').onclick = () => {
    _p = !_p;
    document.getElementById('p2pp').textContent = _p ? 'PLAY' : 'PAUSE';
    document.getElementById('p2pp').classList.toggle('lit', _p);
  };
  document.getElementById('p2rst').onclick = () => {
    t = 0;
    bars.forEach(b => { b.scale.y = .001; b.position.y = -3.5; b.material.emissiveIntensity = .12; });
    ring.scale.setScalar(.01);
  };
  document.getElementById('p2spd').onchange = e => { speed = parseFloat(e.target.value); };

  const stat = document.getElementById('p2stat');
  R.animFn = () => {
    if (!_p) t += speed;
    let sum = 0;
    const now = Date.now();
    bars.forEach((bar, i) => {
      const { h } = bar.userData;
      const prog = Math.max(0, Math.min(1, (t - i * STEP) / (STEP * .65)));
      bar.scale.y = prog || .001;
      bar.position.y = -3.5 + h * prog / 2;
      bar.material.emissiveIntensity = .08 + .55 * prog + .07 * Math.sin(now * .002 + i);
      sum += bar.userData.val * prog;
    });
    const conv = Math.min(sum / TARGET, 1);
    ring.scale.setScalar(.02 + conv * 1.5);
    ring.rotation.z += .01;
    const oc = document.getElementById('ovconv');
    if (oc) oc.textContent = sum.toFixed(10);
    const lastI = Math.min(Math.floor(t / STEP), TERMS.length - 1);
    const ot = document.getElementById('ovterm');
    if (ot && lastI >= 0 && t > 0) { const f = TERMS[lastI]; const n = lastI + 2; ot.textContent = `+ F${lastI + 1}(${f}) / 10^${n}`; }
    stat.textContent = conv >= .9999 ? 'CONVERGED ✓' : `${(conv * 100).toFixed(3)}%`;
    if (t > TERMS.length * STEP + 120 && !_p) { setTimeout(() => { t = 0; bars.forEach(b => { b.scale.y = .001; b.position.y = -3.5; b.material.emissiveIntensity = .12; }); ring.scale.setScalar(.01); }, 3500); }
  };
}
