// ─────────────────────────────────────────────────────
//  SCENE 8 — Ternary precision vs Clock
//  Clock ring is the base; dimension tower rises from its center.
// ─────────────────────────────────────────────────────
import {
  THREE, CSS2DObject, R, mkCamera, mkControls,
  tip, tmv, htip,
} from './shared.js';

export function buildS8() {
  const canvas = R.canvas, ov = R.ov;
  const scene = R.scene = new THREE.Scene();
  // Camera elevated to frame clock base + tower together
  const camera = R.camera = mkCamera();
  camera.position.set(2.5, 5.5, 17); camera.lookAt(0, 1.5, 0);
  const controls = R.controls = mkControls(camera);
  controls.autoRotate = true; controls.autoRotateSpeed = .35;

  // ── Clock ring — the base ─────────────────────────────
  const CLK_Y = -4.0;
  const CR = 2.5, cmeshes = [];
  const CLK = new THREE.Group(); CLK.position.set(0, CLK_Y, 0); scene.add(CLK);

  { const rg = new THREE.TorusGeometry(CR, .038, 8, 80);
    const rm = new THREE.MeshBasicMaterial({ color: 0x0a5a70, transparent: true, opacity: .9 });
    R.disposables.push(rg, rm); CLK.add(new THREE.Mesh(rg, rm)); }

  const HOTC = { 6: 0xff9800, 7: 0xffe600, 8: 0x00ff88 };
  const HOTS = { 6: '#ff9800', 7: '#ffe600', 8: '#00ff88' };
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
      lbl.position.set((CR + .65) * Math.cos(a), (CR + .65) * Math.sin(a), 0);
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
    const lbl = new CSS2DObject(div); lbl.position.set(0, -.72, 0);
    CLK.add(lbl); R.css2dObjects.push(lbl); }

  // clock hand
  const handG = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, CR * .8, 0)]);
  const handM = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: .9 });
  R.disposables.push(handG, handM);
  const hand = new THREE.Line(handG, handM); CLK.add(hand);

  // caption ring labels
  const cap = (txt, y, cc, fs) => {
    const div = document.createElement('div');
    div.className = 'angle-lbl'; div.style.fontSize = fs || '10px'; div.style.color = cc; div.style.opacity = '1';
    div.textContent = txt;
    const lbl = new CSS2DObject(div); lbl.position.set(0, y, 0);
    CLK.add(lbl); R.css2dObjects.push(lbl);
  };
  cap('MODULAR · bounded · wraps', CR + 1.05, '#00e5ff');
  cap("'ternary precision vs clock'", -(CR + 1.0), '#5a7a8a', '9px');

  // ×3/2 arc (h=1 to h=6, inner radius)
  { const a1 = Math.PI / 2 - 1 * Math.PI / 6;
    const a6 = Math.PI / 2 - 6 * Math.PI / 6;
    const R_ARC = CR * 0.62;
    const arcPts = [];
    for (let i = 0; i <= 36; i++) {
      const frac = i / 36;
      const ang  = a1 + frac * (a6 - a1);
      arcPts.push(new THREE.Vector3(R_ARC * Math.cos(ang), R_ARC * Math.sin(ang), 0));
    }
    const arcG = new THREE.BufferGeometry().setFromPoints(arcPts);
    const arcM = new THREE.LineDashedMaterial({ color: 0xffd700, dashSize: .14, gapSize: .09, transparent: true, opacity: .5 });
    const arcL = new THREE.Line(arcG, arcM); arcL.computeLineDistances();
    R.disposables.push(arcG, arcM); CLK.add(arcL);
    const aMid = a1 + 0.5 * (a6 - a1);
    const dArc = document.createElement('div');
    dArc.className = 'angle-lbl';
    dArc.style.cssText = 'font-size:8px;color:#ffd700;opacity:.8;text-align:center;white-space:nowrap;';
    dArc.textContent = '×3/2';
    const lArc = new CSS2DObject(dArc);
    lArc.position.set((R_ARC - .5) * Math.cos(aMid), (R_ARC - .5) * Math.sin(aMid), 0);
    CLK.add(lArc); R.css2dObjects.push(lArc);
    const dSub = document.createElement('div');
    dSub.className = 'angle-lbl';
    dSub.style.cssText = 'font-size:7px;color:#8a7030;opacity:.75;white-space:nowrap;';
    dSub.textContent = '640→960';
    const lSub = new CSS2DObject(dSub);
    lSub.position.set((R_ARC - .5) * Math.cos(aMid), (R_ARC - .5) * Math.sin(aMid) - .36, 0);
    CLK.add(lSub); R.css2dObjects.push(lSub); }

  // 4.5 balance axis
  { const a45 = Math.PI / 2 - 4.5 * Math.PI / 6;
    const ax = Math.cos(a45), ay = Math.sin(a45);
    const axG = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3( ax * CR * 1.18,  ay * CR * 1.18, 0),
      new THREE.Vector3(-ax * CR * 1.18, -ay * CR * 1.18, 0),
    ]);
    const axM = new THREE.LineDashedMaterial({ color: 0xffd700, dashSize: .12, gapSize: .10, transparent: true, opacity: .32 });
    const axL = new THREE.Line(axG, axM); axL.computeLineDistances();
    R.disposables.push(axG, axM); CLK.add(axL);
    const d45 = document.createElement('div');
    d45.className = 'angle-lbl'; d45.style.cssText = 'font-size:9px;color:#ffd700;opacity:.65;';
    d45.textContent = '4.5';
    const l45 = new CSS2DObject(d45);
    l45.position.set(ax * (CR + .5), ay * (CR + .5), 0);
    CLK.add(l45); R.css2dObjects.push(l45); }

  // ── Spine — glowing axis from clock center through the tower ──
  { const sg = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, CLK_Y + .1, 0), new THREE.Vector3(0, 8.2, 0)]);
    const sm = new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: .22 });
    R.disposables.push(sg, sm); scene.add(new THREE.Line(sg, sm)); }

  // ── Dimension tower — rises from clock center ──────────
  // label helper: right side of each shape, in world space
  const dcap = (txt, wx, wy, cc, strike) => {
    const div = document.createElement('div');
    div.className = 'angle-lbl'; div.style.fontSize = '10px'; div.style.color = cc; div.style.opacity = '1';
    if (strike) div.style.textDecoration = 'line-through';
    div.textContent = txt;
    const lbl = new CSS2DObject(div); lbl.position.set(wx, wy, 0);
    scene.add(lbl); R.css2dObjects.push(lbl);
  };
  const eqcap = (txt, wx, wy, cc, strike) => {
    const div = document.createElement('div');
    div.className = 'angle-lbl'; div.style.fontSize = '10px'; div.style.color = cc; div.style.opacity = '1';
    if (strike) div.style.textDecoration = 'line-through';
    div.textContent = txt;
    const lbl = new CSS2DObject(div); lbl.position.set(wx, wy, 0);
    scene.add(lbl); R.css2dObjects.push(lbl);
  };

  const DIM_X = 0;   // all centered on x=0
  const Y1 = -1.4;   // 1D
  const Y2 =  0.8;   // 2D
  const Y3 =  3.0;   // 3D
  const Y4 =  5.5;   // 4D ghost

  // 1D — line
  { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.4, Y1, 0), new THREE.Vector3(1.4, Y1, 0)]);
    const m = new THREE.LineBasicMaterial({ color: 0xc9d2df });
    R.disposables.push(g, m); scene.add(new THREE.Line(g, m)); }
  dcap('1 dim', 2.1, Y1, '#c9d2df');

  // 2D — square outline
  { const eg = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.7, 1.7));
    const em = new THREE.LineBasicMaterial({ color: 0xc9d2df });
    R.disposables.push(eg, em);
    const sq = new THREE.LineSegments(eg, em); sq.position.set(DIM_X, Y2, 0); scene.add(sq); }
  dcap('2 dim', 2.1, Y2, '#c9d2df');

  // 3D — rotating cube
  const cube3 = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.6, 1.6, 1.6)),
    new THREE.LineBasicMaterial({ color: 0xff9800 }));
  R.disposables.push(cube3.geometry, cube3.material);
  cube3.position.set(DIM_X, Y3, 0); scene.add(cube3);
  dcap('3 dim', 2.1, Y3, '#ff9800');

  // 4D — ghost cube, crossed out
  { const eg = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.6, 1.6, 1.6));
    const em = new THREE.LineBasicMaterial({ color: 0x3a4a3a, transparent: true, opacity: .5 });
    R.disposables.push(eg, em);
    const g4 = new THREE.LineSegments(eg, em); g4.position.set(DIM_X, Y4, 0); scene.add(g4);
    const xg = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1.2, Y4 - 1.2, 0), new THREE.Vector3(1.2, Y4 + 1.2, 0),
      new THREE.Vector3(1.2, Y4 - 1.2, 0), new THREE.Vector3(-1.2, Y4 + 1.2, 0)]);
    const xm = new THREE.LineBasicMaterial({ color: 0xff3355, transparent: true, opacity: .9 });
    R.disposables.push(xg, xm); scene.add(new THREE.LineSegments(xg, xm)); }
  dcap('4th', 2.1, Y4, '#ff3355', true);

  // equations (left side)
  eqcap('1 + 2 = 3rd', -2.4, Y3, '#ffe08a');
  eqcap('1 + 2 + 3 = 4th', -2.4, Y4, '#5a7a5a', true);
  // POSITIONAL label above tower
  { const div = document.createElement('div');
    div.className = 'angle-lbl'; div.style.fontSize = '10px'; div.style.color = '#c9d2df'; div.style.opacity = '1';
    div.textContent = 'POSITIONAL · balanced · unbounded';
    const lbl = new CSS2DObject(div); lbl.position.set(0, Y4 + 1.5, 0);
    scene.add(lbl); R.css2dObjects.push(lbl); }

  // ── 757 = ∞ label, floating above tower ──
  { const d = document.createElement('div');
    d.className = 'angle-lbl';
    d.style.cssText = 'font-size:14px;color:#ffd700;opacity:1;text-align:center;letter-spacing:.04em;white-space:nowrap;';
    d.textContent = '757 = ∞';
    const l = new CSS2DObject(d); l.position.set(0, Y4 + 3.0, 0);
    scene.add(l); R.css2dObjects.push(l); }

  // ── Floor inscription ──────────────────────────────────
  { const fc = document.createElement('canvas');
    fc.width = 1280; fc.height = 240;
    const ctx = fc.getContext('2d');
    ctx.clearRect(0, 0, 1280, 240);
    const line = (txt, y, color, size) => {
      ctx.font = `${size}px "Courier New", monospace`;
      ctx.fillStyle = color; ctx.textAlign = 'center';
      ctx.fillText(txt, 640, y);
    };
    line('the interpreter  ·  palindrome in BT and binary', 55, '#ffffff', 38);
    line('1001001 = 3⁶+3³+3⁰  ·  (3⁹−1)/(3³−1)', 110, '#ffffff', 32);
    line('757 prime  ·  7 ones in binary  ·  axis 4.5 = 9/2', 160, '#ffffff', 28);
    line('dr(757) = 1  ·  the return  ·  640 × 3/2 = 960', 206, '#ffffff', 24);
    const tex = new THREE.CanvasTexture(fc);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 3.0),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: .92, depthWrite: false, side: THREE.DoubleSide }));
    plane.rotation.x = -Math.PI / 2 + 22 * Math.PI / 180;
    plane.position.set(0, -5.9, 3.5);
    scene.add(plane);
    R.disposables.push(plane.geometry, plane.material, tex); }

  const grid = new THREE.GridHelper(20, 20, 0x071007, 0x040a04);
  grid.position.y = -5.95; scene.add(grid);
  scene.add(new THREE.AmbientLight(0xffffff, .2));
  const pl = new THREE.PointLight(0x00e5ff, .9, 30); pl.position.set(-4, 5, 6); scene.add(pl);
  const pl2 = new THREE.PointLight(0xff9800, .8, 26); pl2.position.set(4, 3, 5); scene.add(pl2);

  ov.innerHTML = `<div style="color:#2a9060;letter-spacing:.1em">09 · TERNARY vs CLOCK</div>` +
    `<div style="color:#2a6048;margin-top:4px">'ternary precision vs clock'</div>` +
    `<div style="color:#00e5ff;font-size:8.5px;margin-top:2px">clock: modular · bounded · wraps mod 12</div>` +
    `<div style="color:#c9d2df;font-size:8.5px;margin-top:2px">trits: positional · balanced · unbounded</div>` +
    `<div style="color:#ff9800;font-size:8.5px;margin-top:3px">0 = 6 &nbsp;·&nbsp; faces 6,7,8 = &minus;1,0,+1</div>` +
    `<div style="color:#c9d2df;font-size:8.5px;margin-top:3px">1+2 = 3rd &nbsp;·&nbsp; <span style="text-decoration:line-through;color:#ff3355">1+2+3 = 4th</span></div>` +
    `<div style="color:#ffd700;font-size:8px;margin-top:3px">757 = ∞ &nbsp;·&nbsp; 1001001 = 3⁶+3³+3⁰</div>` +
    `<div style="color:#c060ff;font-size:7.5px;margin-top:1px">axis 4.5 = 9/2 · each echo pair sums to 9</div>`;

  const rotBtn = document.getElementById('p9rot');
  rotBtn.classList.toggle('lit', controls.autoRotate);
  rotBtn.onclick = () => { controls.autoRotate = !controls.autoRotate; rotBtn.classList.toggle('lit', controls.autoRotate); };

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
      if (h === 6) hh += `<p class="tr" style="color:#ff9800">trit face &minus;1 &nbsp;·&nbsp; "0 = 6" — root of the dimension tree</p>` +
        `<p class="tr" style="color:#ff9800">echo of 3 (axis); 6+3=9 · 6 is nil, 3 is assumed</p>`;
      if (h === 7) hh += `<p class="tr" style="color:#ffe600">trit face 0 — the neutral position</p>` +
        `<p class="tr" style="color:#ffd700">BT(7) = "757" — palindrome in display</p>` +
        `<p class="tr" style="color:#c060ff">BT(757) = 1001001 = 3⁶+3³+3⁰</p>` +
        `<p class="tr" style="color:#c060ff">757 prime · 7 ones in binary · 757 = ∞</p>`;
      if (h === 8) hh += `<p class="tr" style="color:#00ff88">trit face +1 — the barrier digit</p>` +
        `<p class="tr" style="color:#00ff88">dr(896)=5 · dr(897)=6 · 8 is the wall before nil</p>`;
      tip(e, hh); stat.textContent = `hour ${h}`; tmv(e);
    } else { htip(); stat.textContent = ''; }
  });
  canvas.addEventListener('mouseleave', () => {
    if (lastHl >= 0 && R.cur === 8) { cmeshes[lastHl].material.emissiveIntensity = cmeshes[lastHl].userData.baseEI; cmeshes[lastHl].scale.setScalar(1); }
    lastHl = -1; htip();
  });

  R.animFn = () => {
    const t = Date.now() * .001;
    hand.rotation.z = -t * .55;
    if (ringSpeed !== 0) CLK.rotation.y = t * ringSpeed;
    cube3.rotation.y = t * .4; cube3.rotation.x = Math.sin(t * .3) * .25;
    cmeshes.forEach((m, i) => { if (m.userData.hot && i !== lastHl) m.material.emissiveIntensity = m.userData.baseEI + .18 * Math.sin(t * 1.4 + i); });
    R.labelRenderer.render(scene, camera);
  };
}
