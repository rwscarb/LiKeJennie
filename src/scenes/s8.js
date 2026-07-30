// ─────────────────────────────────────────────────────
//  SCENE 8 — Ternary precision vs Clock
// ─────────────────────────────────────────────────────
import {
  THREE, CSS2DObject, R, mkCamera, mkControls,
  tip, tmv, htip,
} from './shared.js';

export function buildS8() {
  const canvas = R.canvas, ov = R.ov;
  const scene = R.scene = new THREE.Scene();
  const camera = R.camera = mkCamera(); camera.position.set(0, 2.2, 15.5); camera.lookAt(0, .5, 0);
  const controls = R.controls = mkControls(camera);
  controls.autoRotate = false; controls.autoRotateSpeed = .5;

  const CLK = new THREE.Group(); CLK.position.set(-4.6, 1.0, 0); scene.add(CLK);
  const DIM = new THREE.Group(); DIM.position.set(4.6, 0, 0);  scene.add(DIM);

  // divider
  { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -3.6, 0), new THREE.Vector3(0, 4.6, 0)]);
    const m = new THREE.LineDashedMaterial({ color: 0x1a2a1a, dashSize: .22, gapSize: .18, transparent: true, opacity: .9 });
    const l = new THREE.Line(g, m); l.computeLineDistances(); R.disposables.push(g, m); scene.add(l); }

  // ── clock (modular: bounded, wraps) ──
  const CR = 2.7, cmeshes = [];
  { const rg = new THREE.TorusGeometry(CR, .035, 8, 72);
    const rm = new THREE.MeshBasicMaterial({ color: 0x0a5a70, transparent: true, opacity: .9 });
    R.disposables.push(rg, rm); CLK.add(new THREE.Mesh(rg, rm)); }
  const HOTC = { 5: 0xff9800, 6: 0xffe600, 7: 0x00ff88 }; // 5=−1  6=0(nil)  7=+1
  const HOTS = { 5: '#ff9800', 6: '#ffe600', 7: '#00ff88' };
  for (let h = 1; h <= 12; h++) {
    const a = Math.PI / 2 - (h % 12) * Math.PI / 6;
    const hot = HOTC[h] !== undefined;
    const c = hot ? HOTC[h] : 0x0e3a4a;
    const geo = new THREE.SphereGeometry(hot ? .22 : .13, 20, 14);
    const mat = new THREE.MeshPhongMaterial({ color: c, emissive: c, emissiveIntensity: hot ? .5 : .25, transparent: true, opacity: hot ? .95 : .7, shininess: 70 });
    R.disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(CR * Math.cos(a), CR * Math.sin(a), 0);
    m.userData = { h, hot, baseEI: hot ? .5 : .25 };
    CLK.add(m); cmeshes.push(m);
    if (hot) {
      const div = document.createElement('div');
      div.className = 'node-lbl'; div.style.fontSize = '15px'; div.style.fontWeight = 'bold'; div.style.color = HOTS[h];
      div.textContent = h;
      const lbl = new CSS2DObject(div);
      lbl.position.set((CR + .6) * Math.cos(a), (CR + .6) * Math.sin(a), 0);
      CLK.add(lbl); R.css2dObjects.push(lbl);
    }
  }
  // center: 0 = 6
  { const geo = new THREE.SphereGeometry(.3, 20, 14);
    const mat = new THREE.MeshPhongMaterial({ color: 0xff9800, emissive: 0xff9800, emissiveIntensity: .35, transparent: true, opacity: .9 });
    R.disposables.push(geo, mat); CLK.add(new THREE.Mesh(geo, mat));
    const div = document.createElement('div');
    div.className = 'angle-lbl'; div.style.fontSize = '11px'; div.style.color = '#ff9800'; div.style.opacity = '1';
    div.textContent = '0 = 6';
    const lbl = new CSS2DObject(div); lbl.position.set(0, -.66, 0);
    CLK.add(lbl); R.css2dObjects.push(lbl); }
  // hand
  const handG = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, CR * .8, 0)]);
  const handM = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: .9 });
  R.disposables.push(handG, handM);
  const hand = new THREE.Line(handG, handM); CLK.add(hand);
  // captions
  const cap = (txt, y, cc, fs) => { const div = document.createElement('div');
    div.className = 'angle-lbl'; div.style.fontSize = fs || '10px'; div.style.color = cc; div.style.opacity = '1';
    div.textContent = txt; const lbl = new CSS2DObject(div); lbl.position.set(0, y, 0);
    CLK.add(lbl); R.css2dObjects.push(lbl); };
  cap('MODULAR · bounded · wraps', CR + 1.0, '#00e5ff');
  cap("'ternary precision vs clock'", -(CR + 1.0), '#5a7a8a', '9px');

  // ── dimension stack (positional: balanced, unbounded) ──
  const dcap = (txt, x, y, cc, strike) => { const div = document.createElement('div');
    div.className = 'angle-lbl'; div.style.fontSize = '10px'; div.style.color = cc; div.style.opacity = '1';
    if (strike) div.style.textDecoration = 'line-through';
    div.textContent = txt; const lbl = new CSS2DObject(div); lbl.position.set(x, y, 0);
    DIM.add(lbl); R.css2dObjects.push(lbl); };
  // 1 dim — line
  { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.3, -2.6, 0), new THREE.Vector3(1.3, -2.6, 0)]);
    const m = new THREE.LineBasicMaterial({ color: 0xc9d2df });
    R.disposables.push(g, m); DIM.add(new THREE.Line(g, m)); }
  dcap('1 dim', 2.0, -2.6, '#c9d2df');
  // 2 dim — square outline
  { const eg = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.6, 1.6));
    const em = new THREE.LineBasicMaterial({ color: 0xc9d2df });
    R.disposables.push(eg, em);
    const sq = new THREE.LineSegments(eg, em); sq.position.y = -.7; DIM.add(sq); }
  dcap('2 dim', 2.0, -.7, '#c9d2df');
  // 3 dim — cube wireframe (rotates)
  const cube3 = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.5, 1.5, 1.5)),
    new THREE.LineBasicMaterial({ color: 0xff9800 }));
  R.disposables.push(cube3.geometry, cube3.material);
  cube3.position.y = 1.3; DIM.add(cube3);
  dcap('3 dim', 2.0, 1.3, '#ff9800');
  // 4th — ghost cube, crossed out
  { const eg = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.5, 1.5, 1.5));
    const em = new THREE.LineBasicMaterial({ color: 0x3a4a3a, transparent: true, opacity: .5 });
    R.disposables.push(eg, em);
    const g4 = new THREE.LineSegments(eg, em); g4.position.y = 3.4; DIM.add(g4);
    const xg = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1.2, 3.4 - 1.2, 0), new THREE.Vector3(1.2, 3.4 + 1.2, 0),
      new THREE.Vector3(1.2, 3.4 - 1.2, 0), new THREE.Vector3(-1.2, 3.4 + 1.2, 0)]);
    const xm = new THREE.LineBasicMaterial({ color: 0xff3355, transparent: true, opacity: .9 });
    R.disposables.push(xg, xm);
    DIM.add(new THREE.LineSegments(xg, xm)); }
  dcap('4th', 2.0, 3.4, '#ff3355', true);
  // equations
  dcap('1 + 2 = 3rd', -2.4, 1.3, '#ffe08a');
  dcap('1 + 2 + 3 = 4th', -2.4, 3.4, '#5a7a5a', true);
  dcap('POSITIONAL · balanced · unbounded', 0, -3.6, '#c9d2df');

  // ── 757 = ∞ · the interpreter — floats above both sides ──────────────────
  const mkBLbl = (txt, y, col, fs) => {
    const d = document.createElement('div');
    d.className = 'angle-lbl';
    d.style.cssText = `font-size:${fs||'9px'};color:${col};opacity:1;text-align:center;letter-spacing:.04em;white-space:nowrap;`;
    d.textContent = txt;
    const l = new CSS2DObject(d); l.position.set(0, y, 0);
    scene.add(l); R.css2dObjects.push(l);
  };
  mkBLbl('757 = ∞', 5.4, '#ffd700', '14px');

  // ── floor inscription — the interpreter ──────────────────────────────────
  { const fc = document.createElement('canvas');
    fc.width = 1280; fc.height = 280;
    const ctx = fc.getContext('2d');
    ctx.clearRect(0, 0, 1280, 280);
    const line = (txt, y, color, size) => {
      ctx.font = `${size}px "Courier New", monospace`;
      ctx.fillStyle = color; ctx.textAlign = 'center';
      ctx.fillText(txt, 640, y);
    };
    line('the interpreter  ·  palindrome in BT and binary', 60, '#ffffff', 38);
    line('1001001 = 3⁶+3³+3⁰  ·  (3⁹−1)/(3³−1)', 120, '#ffffff', 32);
    line('757 prime  ·  7 ones in binary  ·  dr(757) = 1', 176, '#ffffff', 28);
    line('the return  ·  echo pairs sum to 9  ·  orbit period 6', 228, '#ffffff', 24);
    const tex = new THREE.CanvasTexture(fc);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 3.1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: .96, depthWrite: false, side: THREE.DoubleSide }));
    plane.rotation.x = -Math.PI / 2 + 22 * Math.PI / 180;
    plane.position.set(0, -4.05, 3);
    scene.add(plane);
    R.disposables.push(plane.geometry, plane.material, tex); }

  const grid = new THREE.GridHelper(18, 18, 0x071007, 0x040a04);
  grid.position.y = -4.1; scene.add(grid);
  scene.add(new THREE.AmbientLight(0xffffff, .2));
  const pl = new THREE.PointLight(0x00e5ff, .9, 30); pl.position.set(-6, 6, 6); scene.add(pl);
  const pl2 = new THREE.PointLight(0xff9800, .8, 26); pl2.position.set(6, 4, 5); scene.add(pl2);

  ov.innerHTML = `<div style="color:#2a9060;letter-spacing:.1em">09 · TERNARY vs CLOCK</div>` +
    `<div style="color:#2a6048;margin-top:4px">'ternary precision vs clock'</div>` +
    `<div style="color:#00e5ff;font-size:8.5px;margin-top:2px">clock: modular · bounded · wraps mod 12</div>` +
    `<div style="color:#c9d2df;font-size:8.5px;margin-top:2px">trits: positional · balanced · unbounded</div>` +
    `<div style="color:#ff9800;font-size:8.5px;margin-top:3px">0 = 6 &nbsp;·&nbsp; faces 6,7,8 = &minus;1,0,+1</div>` +
    `<div style="color:#c9d2df;font-size:8.5px;margin-top:3px">1+2 = 3rd &nbsp;·&nbsp; <span style="text-decoration:line-through;color:#ff3355">1+2+3 = 4th</span></div>` +
    `<div style="color:#ffd700;font-size:8px;margin-top:3px">757 = ∞ &nbsp;·&nbsp; 1001001 = 3⁶+3³+3⁰</div>` +
    `<div style="color:#c060ff;font-size:7.5px;margin-top:1px">echo pairs sum to 9 · orbit period 6</div>`;

  document.getElementById('p9rot').onclick  = () => { R.controls.autoRotate = !R.controls.autoRotate; document.getElementById('p9rot').classList.toggle('lit', R.controls.autoRotate); };
  let ringSpeed = 0;
  document.getElementById('p9ring').onclick = () => {
    ringSpeed = ringSpeed === 0 ? 0.28 : 0;
    document.getElementById('p9ring').classList.toggle('lit', ringSpeed !== 0);
  };

  const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2(); let lastHl = -1;
  const stat = document.getElementById('p9stat');
  canvas.addEventListener('mousemove', e => {
    if (R.cur !== 8) return;
    const r = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(mouse, R.camera);
    const hits = ray.intersectObjects(cmeshes, false);
    const idx = hits.length > 0 ? cmeshes.indexOf(hits[0].object) : -1;
    if (idx !== lastHl) {
      if (lastHl >= 0) { cmeshes[lastHl].material.emissiveIntensity = cmeshes[lastHl].userData.baseEI; cmeshes[lastHl].scale.setScalar(1); }
      if (idx >= 0) { cmeshes[idx].material.emissiveIntensity = .95; cmeshes[idx].scale.setScalar(1.35); }
      lastHl = idx;
    }
    if (idx >= 0) {
      const h = cmeshes[idx].userData.h;
      let hh = `<div class="th" style="color:${cmeshes[idx].userData.hot ? HOTS[h] : '#0e6a8a'}">${h} o'clock</div>`;
      hh += `<p class="tr">${h} &equiv; ${h} (mod 12) — the line folds into a circle</p>`;
      if (h === 5) hh += `<p class="tr" style="color:#ff9800">trit digit &minus;1 · the contraction</p>` +
        `<p class="tr" style="color:#ff9800">dr(896)=5 · 5+4=9 · echo of 4</p>`;
      if (h === 6) hh += `<p class="tr" style="color:#ffe600">trit digit 0 — nil · the absent center</p>` +
        `<p class="tr" style="color:#ffe600">"0 = 6" — root of the dimension tree · echo of 3</p>` +
        `<p class="tr" style="color:#ffe600">6+3=9 · 6 is nil, 3 is assumed</p>`;
      if (h === 7) hh += `<p class="tr" style="color:#00ff88">trit digit +1 — the palindrome position</p>` +
        `<p class="tr" style="color:#00ff88">BT(7) = "757" — palindrome in display</p>` +
        `<p class="tr" style="color:#c060ff">BT(757) = 1001001 = 3⁶+3³+3⁰</p>` +
        `<p class="tr" style="color:#c060ff">757 prime · 7 ones in binary · 757 = ∞</p>`;
      tip(e, hh); stat.textContent = `hour ${h}`; tmv(e);
    } else { htip(); stat.textContent = ''; }
  });
  canvas.addEventListener('mouseleave', () => { if (lastHl >= 0 && R.cur === 8) { cmeshes[lastHl].material.emissiveIntensity = cmeshes[lastHl].userData.baseEI; cmeshes[lastHl].scale.setScalar(1); } lastHl = -1; htip(); });

  R.animFn = () => {
    const t = Date.now() * .001;
    hand.rotation.z = -t * .55;
    if (ringSpeed !== 0) CLK.rotation.y = t * ringSpeed;
    cube3.rotation.y = t * .4; cube3.rotation.x = Math.sin(t * .3) * .25;
    cmeshes.forEach((m, i) => { if (m.userData.hot && i !== lastHl) m.material.emissiveIntensity = m.userData.baseEI + .18 * Math.sin(t * 1.4 + i); });
    R.labelRenderer.render(scene, camera);
  };
}
