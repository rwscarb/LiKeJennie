// ── Panel 5 · Greek Alphabet ─────────────────────────
import {
  THREE, CSS2DObject, R, mkCamera, mkControls,
  tip, htip,
} from './shared.js';

export function buildS4() {
  const canvas = R.canvas, ov = R.ov;
  const scene = R.scene = new THREE.Scene();
  const camera = R.camera = mkCamera(); camera.position.set(0, 8, 18);
  camera.lookAt(0, 0, 0);
  const controls = R.controls = mkControls(camera);
  controls.autoRotate = true; controls.autoRotateSpeed = 0.45;

  const GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π', 'ρ', 'σ', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω'];
  const NAMES = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa',
    'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi', 'rho', 'sigma', 'tau', 'upsilon',
    'phi', 'chi', 'psi', 'omega'];
  // idx=15(π), 18(τ), 20(φ), 23(ω)
  const SPECIAL = {
    15: { c: 0xff9800, cs: '#ff9800', note: 'τ(896) = 16', note2: '16 active experts / token' },
    18: { c: 0x00e5ff, cs: '#00e5ff', note: 'τ — the divisor function', note2: 'symbol comes from here' },
    20: { c: 0xffe600, cs: '#ffe600', note: 'φ = golden ratio', note2: 'F₈ = 21 = 3 × 7' },
    23: { c: 0xff2d78, cs: '#ff2d78', note: 'τ(6272) = 24', note2: '6272 = 2⁷×7² symmetric ext.' },
  };

  const Rr = 6, N = 24;
  const meshes = [];

  GREEK.forEach((letter, i) => {
    const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
    const x = Rr * Math.cos(angle), z = Rr * Math.sin(angle);
    const sp = SPECIAL[i];
    const radius = sp ? 0.55 : 0.18;
    const c = sp ? sp.c : 0x0d1f0d;
    const ei = sp ? 0.55 : 0.04;

    const geo = new THREE.SphereGeometry(radius, 20, 14);
    const mat = new THREE.MeshPhongMaterial({ color: c, emissive: c, emissiveIntensity: ei, transparent: true, opacity: sp ? 0.9 : 0.55 });
    R.disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 0, z);
    m.userData = { i, letter, name: NAMES[i], sp };
    scene.add(m); meshes.push(m);

    // angle label (always visible)
    const deg = Math.round((i / N) * 360);
    const adiv = document.createElement('div');
    adiv.className = 'angle-lbl';
    adiv.style.color = sp ? sp.cs : '#2a4030';
    adiv.textContent = deg + '°';
    const albl = new CSS2DObject(adiv);
    const outerR = Rr + 1.15;
    albl.position.set(outerR * Math.cos(angle), 0, outerR * Math.sin(angle));
    scene.add(albl); R.css2dObjects.push(albl);

    if (sp) {
      const rg = new THREE.TorusGeometry(radius + 0.18, 0.04, 8, 40);
      const rm = new THREE.MeshBasicMaterial({ color: sp.c, transparent: true, opacity: 0.35 });
      R.disposables.push(rg, rm);
      const ring = new THREE.Mesh(rg, rm);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, 0, z);
      scene.add(ring);
    }
  });

  // connecting ring path (dim)
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
    pts.push(new THREE.Vector3(Rr * Math.cos(angle), 0, Rr * Math.sin(angle)));
  }
  const ringCurve = new THREE.BufferGeometry().setFromPoints(pts);
  const ringLine = new THREE.Line(ringCurve, new THREE.LineBasicMaterial({ color: 0x0a2010, transparent: true, opacity: 0.5 }));
  R.disposables.push(ringCurve, ringLine.material);
  scene.add(ringLine);

  // spokes from center to special nodes
  const spokePairs = [[15, 0xff9800], [18, 0x00e5ff], [20, 0xffe600], [23, 0xff2d78]];
  spokePairs.forEach(([i, c]) => {
    const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
    const pts2 = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(Rr * Math.cos(angle), 0, Rr * Math.sin(angle))];
    const sg = new THREE.BufferGeometry().setFromPoints(pts2);
    const sm = new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.22 });
    R.disposables.push(sg, sm);
    scene.add(new THREE.Line(sg, sm));
  });

  const grid = new THREE.GridHelper(18, 18, 0x060606, 0x040404);
  grid.position.y = -0.9; scene.add(grid);
  scene.add(new THREE.AmbientLight(0xffffff, 0.12));
  const pl = new THREE.PointLight(0xffe600, 1.0, 30); pl.position.set(0, 10, 0); scene.add(pl);
  const pl2 = new THREE.PointLight(0xff9800, 0.7, 22); pl2.position.set(-7, 4, -7); scene.add(pl2);
  const pl3 = new THREE.PointLight(0x00e5ff, 0.6, 20); pl3.position.set(7, 4, 7); scene.add(pl3);

  ov.innerHTML = `<div style="color:#2a9060;letter-spacing:.1em">05 · GREEK LETTERS</div>` +
    `<div style="color:#2a6048;margin-top:4px">24 letters — 4 signals</div>` +
    `<div style="margin-top:7px;font-size:9px;line-height:2.1">` +
    `<div><span style="color:#ff9800">π = 16th</span>&nbsp;<span style="color:#2a6048">→ τ(896)=16</span></div>` +
    `<div><span style="color:#00e5ff">τ = 19th</span>&nbsp;<span style="color:#2a6048">→ divisor fn</span></div>` +
    `<div><span style="color:#ffe600">φ = 21st</span>&nbsp;<span style="color:#2a6048">→ F₈=3×7</span></div>` +
    `<div><span style="color:#ff2d78">ω = 24th</span>&nbsp;<span style="color:#2a6048">→ τ(6272)=24</span></div>` +
    `</div>`;

  // hover/tooltip
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let lastHl = -1;
  canvas.addEventListener('mousemove', e => {
    if (R.cur !== 4) return;
    const r = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(mouse, R.camera);
    const hits = ray.intersectObjects(meshes);
    const idx2 = hits.length > 0 ? meshes.indexOf(hits[0].object) : -1;
    if (idx2 !== lastHl) {
      if (lastHl >= 0) { const m = meshes[lastHl]; m.material.emissiveIntensity = m.userData.sp ? 0.55 : 0.04; m.scale.setScalar(1); }
      if (idx2 >= 0) { meshes[idx2].material.emissiveIntensity = 0.95; meshes[idx2].scale.setScalar(1.35); }
      lastHl = idx2;
    }
    if (idx2 >= 0) {
      const d = meshes[idx2].userData;
      const deg2 = Math.round((d.i / N) * 360);
      let h = `<div class="th" style="color:${d.sp ? d.sp.cs : '#808060'}">${d.letter} (${d.name})</div>`;
      h += `<p class="tr">position: <b>${d.i + 1}</b> of 24 &nbsp;·&nbsp; <b>${deg2}°</b></p>`;
      if (d.sp) { h += `<p class="tr"><b style="color:${d.sp.cs}">${d.sp.note}</b></p>`; if (d.sp.note2) h += `<p class="tr" style="color:#2a6048">${d.sp.note2}</p>`; }
      else h += `<p class="tr" style="color:#2a5040">no signal detected</p>`;
      tip(e, h);
    } else htip();
  });
  canvas.addEventListener('mouseleave', () => {
    if (lastHl >= 0) { const m = meshes[lastHl]; m.material.emissiveIntensity = m.userData.sp ? 0.55 : 0.04; m.scale.setScalar(1); }
    lastHl = -1; htip();
  });

  R.animFn = () => {
    const t = Date.now() * .001;
    [15, 18, 20, 23].forEach((i, j) => {
      meshes[i].material.emissiveIntensity = 0.45 + 0.3 * Math.sin(t * 1.8 + j * 0.9);
    });
  };
}
