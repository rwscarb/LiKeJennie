/**
 * RELATIVITY — Scene 21
 *
 * MODE A — SPACETIME: Minkowski spacetime diagram. Orbit elements [1,2,4,8,7,5]
 * as world lines at β = n/9. Light cone separates timelike from spacelike.
 * Dashed hyperbola marks constant proper time τ = 1 for each traveler.
 *
 * MODE B — DOUBLE SLIT: Wave-particle duality. A source emits quanta; they
 * pass through a double barrier and land on a detector screen. MEASURE mode
 * collapses the wave function: interference pattern → two classical bands.
 *
 * Framework connection: MEASURING = instrument-dependent visibility. The orbit
 * [1,2,4,8,7,5] only appears via the right instrument. Interference = orbit
 * visible; two bands = complement visible; measurement selects the frame.
 */
import {
  THREE, CSS2DObject, R, mkCamera, mkControls,
  tip, tmv, htip,
} from './shared.js';

const ORBIT = [1, 2, 4, 8, 7, 5];
const BETA  = ORBIT.map(n => n / 9);
const GAMMA = BETA.map(b => 1 / Math.sqrt(1 - b * b));

// Spectral sweep along the orbit: green → cyan → blue → indigo → violet → magenta
const CHEX = [0x00ff88, 0x00ccff, 0x0088ff, 0x4455ff, 0x8844ff, 0xcc44ff];
const CSTR = ['#00ff88', '#00ccff', '#0088ff', '#4455ff', '#8844ff', '#cc44ff'];

const H     = 6.0;   // scene half-height in ct units; spans y ∈ [−H, +H]
const SCALE = 1.5;   // world units per unit of natural τ = 1 hyperbola

// ── Double-slit constants ─────────────────────────────────────────────────────
const DS_SRC_X = -4.5;   // source x position
const DS_BAR_X =  0;     // barrier x position
const DS_SCR_X =  4.5;   // screen x position
const DS_D     =  1.3;   // slit center-to-center separation
const DS_SW    =  0.40;  // slit half-width
const DS_BH    =  5.0;   // barrier half-height
const DS_L     = DS_SCR_X - DS_BAR_X;
const DS_LAM   = DS_D;   // visual de Broglie wavelength

function dsIntensity(y, meas) {
  if (meas) {
    const sigma = 0.55;
    const g1 = Math.exp(-0.5 * ((y - DS_D / 2) ** 2) / (sigma * sigma));
    const g2 = Math.exp(-0.5 * ((y + DS_D / 2) ** 2) / (sigma * sigma));
    return (g1 + g2) * 0.7;
  }
  const phi = (Math.PI * DS_D * y) / (DS_LAM * DS_L);
  return Math.cos(phi) * Math.cos(phi);
}

function sampleY(meas) {
  for (let i = 0; i < 500; i++) {
    const y = (Math.random() * 2 - 1) * 4.5;
    if (Math.random() < dsIntensity(y, meas)) return y;
  }
  return 0;
}

// ── Mode state (module-level so exports can access it) ────────────────────────
let _mode      = 'spacetime';
let _measuring = false;
let _dsSpeed   = 1.0;    // DS animation speed multiplier; [ = slower, ] = faster
let _dsState   = null;   // set by buildS22; referenced by exports

export function setS22Mode(mode) {
  if (!_dsState) return;
  _mode = mode;
  _dsState.stGroup.visible = (mode === 'spacetime');
  _dsState.dsGroup.visible = (mode === 'dslits');
  // CSS2DRenderer doesn't always respect group.visible — toggle DOM elements directly
  _dsState.stLbls.forEach(el => { el.style.display = mode === 'spacetime' ? '' : 'none'; });
  _dsState.dsLbls.forEach(el => { el.style.display = mode === 'dslits'    ? '' : 'none'; });
  const { camera, controls } = _dsState;
  if (mode === 'dslits') {
    camera.position.set(0, 0, 16);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.autoRotate = false;
    _dsState.resetDots();
    _dsState.resetWaves();
    _dsState.resetParticles();
  } else {
    camera.position.set(5, 4, 14);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.autoRotate = true;
  }
  controls.update();
  ['s22_spacetime', 's22_dslits'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('lit', id === `s22_${mode}`);
  });
  _dsState.updateOverlay();
}

export function toggleS22Measure() {
  if (!_dsState) return;
  _measuring = !_measuring;
  const el = document.getElementById('s22_measure');
  if (el) {
    el.textContent = _measuring ? 'MEASURING ✓' : 'MEASURE';
    el.classList.toggle('lit', _measuring);
  }
  _dsState.resetDots();
  _dsState.resetWaves();
  _dsState.resetParticles();
  _dsState.updateScreenTex(_measuring);
  _dsState.updateOverlay();
}

// ── Scene builder ─────────────────────────────────────────────────────────────
export function buildS22() {
  _mode      = 'spacetime';
  _measuring = false;
  _dsSpeed   = 1.0;
  _dsState   = null;

  const canvas = R.canvas, ov = R.ov;
  const scene  = R.scene  = new THREE.Scene();
  const camera = R.camera = mkCamera();
  camera.position.set(5, 4, 14);
  camera.lookAt(0, 0, 0);
  const controls = R.controls = mkControls(camera);
  controls.autoRotate      = true;
  controls.autoRotateSpeed = 0.15;

  // Shared ambient (both modes need it)
  scene.add(new THREE.AmbientLight(0x080814, 4));

  // ═══════════════════════════════════════════════════════════════════════════
  // A — SPACETIME GROUP
  // ═══════════════════════════════════════════════════════════════════════════
  const stGroup = new THREE.Group();
  scene.add(stGroup);
  const stLbls = [];   // DOM elements of spacetime CSS2D objects (for explicit visibility toggle)
  const dsLbls = [];   // DOM elements of DS CSS2D objects

  // ct / x axes
  const axLine = (a, b, color, opacity = 0.16) => {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    R.disposables.push(geo, mat);
    stGroup.add(new THREE.Line(geo, mat));
  };
  axLine(
    new THREE.Vector3(0, -H - 0.6, 0), new THREE.Vector3(0, H + 0.6, 0),
    0xffffff, 0.16,
  );
  axLine(
    new THREE.Vector3(-H - 0.6, 0, 0), new THREE.Vector3(H + 0.6, 0, 0),
    0xffffff, 0.10,
  );

  // Light cone (future + past)
  const addCone = (flip, posY) => {
    for (const [segs, opacity, wf] of [[40, 0.06, false], [16, 0.18, true]]) {
      const geo  = new THREE.ConeGeometry(H, H, segs, 1, true);
      const mat  = new THREE.MeshBasicMaterial({
        color: 0xffcc44, transparent: true, opacity,
        side: THREE.DoubleSide, wireframe: wf,
      });
      R.disposables.push(geo, mat);
      const mesh = new THREE.Mesh(geo, mat);
      if (flip) mesh.rotation.x = Math.PI;
      mesh.position.y = posY;
      stGroup.add(mesh);
    }
  };
  addCone(true,  H / 2);
  addCone(false, -H / 2);

  // Apex glow
  {
    const geo = new THREE.SphereGeometry(0.10, 16, 10);
    const mat = new THREE.MeshPhongMaterial({
      color: 0xffcc44, emissive: 0xffcc44, emissiveIntensity: 2.5,
    });
    R.disposables.push(geo, mat);
    stGroup.add(new THREE.Mesh(geo, mat));
  }

  // World lines + travelers
  const wlMeshes = [], wlMats = [], travelers = [];

  ORBIT.forEach((n, i) => {
    const beta = BETA[i];
    const topX =  beta * H;
    const botX = -beta * H;

    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(botX, -H, 0),
      new THREE.Vector3(0,    0,  0),
      new THREE.Vector3(topX, H,  0),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: CHEX[i], transparent: true, opacity: 0.65 });
    R.disposables.push(geo, mat);
    const wl = new THREE.Line(geo, mat);
    stGroup.add(wl);
    wlMeshes.push(wl);
    wlMats.push(mat);

    const tgeo = new THREE.SphereGeometry(0.12, 12, 8);
    const tmat = new THREE.MeshPhongMaterial({
      color: CHEX[i], emissive: CHEX[i], emissiveIntensity: 1.0,
    });
    R.disposables.push(tgeo, tmat);
    const tm = new THREE.Mesh(tgeo, tmat);
    stGroup.add(tm);
    travelers.push({ mesh: tm, mat: tmat, beta, gamma: GAMMA[i], i });

    const ndiv = document.createElement('div');
    ndiv.className = 'node-lbl';
    ndiv.style.cssText = `font-size:13px;color:${CSTR[i]};font-weight:bold`;
    ndiv.textContent = String(n);
    const nlbl = new CSS2DObject(ndiv);
    nlbl.position.set(topX, H + 0.55, 0);
    stGroup.add(nlbl);
    R.css2dObjects.push(nlbl);
    stLbls.push(ndiv);

    const bdiv = document.createElement('div');
    bdiv.className = 'node-lbl';
    bdiv.style.cssText = `font-size:7.5px;color:${CSTR[i]};opacity:0.65`;
    bdiv.textContent = `${n}/9 c`;
    const blbl = new CSS2DObject(bdiv);
    blbl.position.set(topX, H + 0.20, 0);
    stGroup.add(blbl);
    R.css2dObjects.push(blbl);
    stLbls.push(bdiv);
  });

  // τ = 1 proper-time hyperbola
  {
    const hPts = [];
    const ETA_MAX = Math.atanh(0.965);
    for (let k = 0; k <= 80; k++) {
      const eta = (k / 80) * ETA_MAX;
      hPts.push(new THREE.Vector3(Math.sinh(eta) * SCALE, Math.cosh(eta) * SCALE, 0));
    }
    const hgeo = new THREE.BufferGeometry().setFromPoints(hPts);
    const hmat = new THREE.LineDashedMaterial({
      color: 0x555566, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.55,
    });
    R.disposables.push(hgeo, hmat);
    const hl = new THREE.Line(hgeo, hmat);
    hl.computeLineDistances();
    stGroup.add(hl);

    const tdiv = document.createElement('div');
    tdiv.className = 'node-lbl';
    tdiv.style.cssText = 'font-size:8px;color:#556688;opacity:0.8';
    tdiv.textContent = 'τ = 1';
    const tlbl = new CSS2DObject(tdiv);
    tlbl.position.set(-0.25, SCALE + 0.18, 0);
    stGroup.add(tlbl);
    R.css2dObjects.push(tlbl);
    stLbls.push(tdiv);
  }

  // γ marker dots where each world line pierces the τ = 1 hyperbola
  ORBIT.forEach((n, i) => {
    const b = BETA[i], g = GAMMA[i];
    const px = b * g * SCALE;
    const py = g * SCALE;
    if (py > H - 0.3) return;
    const geo = new THREE.SphereGeometry(0.065, 10, 7);
    const mat = new THREE.MeshBasicMaterial({ color: CHEX[i], transparent: true, opacity: 0.55 });
    R.disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, 0);
    stGroup.add(m);
  });

  // Axis labels
  const axLbl = (txt, pos, color = '#ffffff66', sz = '9px') => {
    const div = document.createElement('div');
    div.className = 'node-lbl';
    div.style.cssText = `font-size:${sz};color:${color}`;
    div.textContent = txt;
    const o = new CSS2DObject(div);
    o.position.copy(pos);
    stGroup.add(o);
    R.css2dObjects.push(o);
    stLbls.push(div);
  };
  axLbl('ct', new THREE.Vector3(0.3,  H + 0.7, 0), '#ffffff66', '10px');
  axLbl('x',  new THREE.Vector3(H + 0.7, 0.3,  0), '#ffffff66', '10px');

  // Lighting (spacetime)
  const pl = new THREE.PointLight(0xffcc44, 2.0, 22);
  pl.position.set(0, 6, 6);
  stGroup.add(pl);

  // Hover — raycasting on world lines
  canvas.addEventListener('mousemove', (e) => {
    if (R.cur !== 20 || _mode !== 'spacetime') return;
    const rect  = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.params.Line = { threshold: 0.25 };
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects(wlMeshes);
    if (hits.length > 0) {
      const idx   = wlMeshes.indexOf(hits[0].object);
      if (idx < 0) { htip(); return; }
      const n     = ORBIT[idx];
      const beta  = BETA[idx];
      const gamma = GAMMA[idx];
      const j     = (idx + 1) % ORBIT.length;
      const b2    = BETA[j];
      const bAdd  = (beta + b2) / (1 + beta * b2);
      const bNewt = beta + b2;
      let h = `<div class="th" style="color:${CSTR[idx]}">${n}</div>`;
      h += `<p class="tr">β = ${n}/9 ≈ ${beta.toFixed(4)}c</p>`;
      h += `<p class="tr">γ = <b>${gamma.toFixed(4)}</b></p>`;
      h += `<p class="tr">time dilation: Δt = <b>${gamma.toFixed(3)}Δτ</b></p>`;
      h += `<p class="tr">length contraction: L = L₀/<b>${gamma.toFixed(3)}</b></p>`;
      h += `<hr style="border-color:#334;margin:4px 0">`;
      h += `<p class="tr" style="color:#8888aa">⊕ orbit ${ORBIT[j]}:</p>`;
      h += `<p class="tr">${beta.toFixed(3)}c ⊕ ${b2.toFixed(3)}c = <b>${bAdd.toFixed(4)}c</b></p>`;
      h += `<p class="tr" style="color:#445;font-size:9px">newton: ${bNewt.toFixed(3)}c${bNewt > 1 ? ' ⚡ FTL!' : ''}</p>`;
      tip(e, h);
      tmv(e);
      wlMats.forEach((m, li) => { m.opacity = li === idx ? 1.0 : 0.18; });
    } else {
      htip();
      wlMats.forEach(m => { m.opacity = 0.65; });
    }
  });
  canvas.addEventListener('mouseleave', () => {
    if (R.cur !== 20) return;
    htip();
    wlMats.forEach(m => { m.opacity = 0.65; });
  });

  // [ / ] speed controls for DS mode
  document.addEventListener('keydown', (e) => {
    if (R.cur !== 20 || _mode !== 'dslits') return;
    if (e.key === '[') {
      _dsSpeed = Math.max(0.2, _dsSpeed / 1.35);
    } else if (e.key === ']') {
      _dsSpeed = Math.min(8.0, _dsSpeed * 1.35);
    } else {
      return;
    }
    e.preventDefault();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // B — DOUBLE-SLIT GROUP
  // ═══════════════════════════════════════════════════════════════════════════
  const dsGroup = new THREE.Group();
  dsGroup.visible = false;
  scene.add(dsGroup);

  // Source sphere
  const srcGeo = new THREE.SphereGeometry(0.20, 16, 12);
  const srcMat = new THREE.MeshPhongMaterial({
    color: 0xffffff, emissive: 0xffffcc, emissiveIntensity: 3,
  });
  R.disposables.push(srcGeo, srcMat);
  const srcMesh = new THREE.Mesh(srcGeo, srcMat);
  srcMesh.position.set(DS_SRC_X, 0, 0);
  dsGroup.add(srcMesh);

  // Barrier: three segments — top, middle (between slits), bottom
  const barMat = new THREE.MeshPhongMaterial({ color: 0x3355aa, emissive: 0x111133, emissiveIntensity: 0.3 });
  R.disposables.push(barMat);
  const topH  = DS_BH - DS_D / 2 - DS_SW;
  const midH  = DS_D - 2 * DS_SW;
  const topCY = (DS_D / 2 + DS_SW + DS_BH) / 2;
  [
    [topCY,  topH],
    [0,      midH],
    [-topCY, topH],
  ].forEach(([cy, h]) => {
    if (h <= 0) return;
    const geo  = new THREE.BoxGeometry(0.14, h, 0.6);
    const mesh = new THREE.Mesh(geo, barMat);
    mesh.position.set(DS_BAR_X, cy, 0);
    R.disposables.push(geo);
    dsGroup.add(mesh);
  });

  // Screen: thin plane with a canvas intensity texture
  const scrCanvas = document.createElement('canvas');
  scrCanvas.width  = 16;
  scrCanvas.height = 512;
  const scrTex = new THREE.CanvasTexture(scrCanvas);
  const scrGeo = new THREE.PlaneGeometry(0.12, DS_BH * 2);
  const scrMat = new THREE.MeshBasicMaterial({ map: scrTex, transparent: true, opacity: 0.88 });
  R.disposables.push(scrTex, scrGeo, scrMat);
  const scrMesh = new THREE.Mesh(scrGeo, scrMat);
  scrMesh.position.set(DS_SCR_X, 0, -0.05);
  dsGroup.add(scrMesh);

  function updateScreenTex(meas) {
    const ctx = scrCanvas.getContext('2d');
    ctx.clearRect(0, 0, 16, 512);
    for (let py = 0; py < 512; py++) {
      const y = ((py / 512) * 2 - 1) * DS_BH;   // canvas y is flipped
      const v = dsIntensity(-y, meas);
      const a = Math.min(1, v * 1.2);
      ctx.fillStyle = meas
        ? `rgba(80,160,255,${a.toFixed(3)})`
        : `rgba(0,255,136,${a.toFixed(3)})`;
      ctx.fillRect(0, py, 16, 1);
    }
    scrTex.needsUpdate = true;
  }
  updateScreenTex(false);

  // Screen edge line
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x3355aa, transparent: true, opacity: 0.4 });
  const edgeGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(DS_SCR_X, -DS_BH, 0),
    new THREE.Vector3(DS_SCR_X,  DS_BH, 0),
  ]);
  R.disposables.push(edgeMat, edgeGeo);
  dsGroup.add(new THREE.Line(edgeGeo, edgeMat));

  // Accumulated dots (InstancedMesh, max 480)
  const DOT_MAX = 480;
  const dotGeo  = new THREE.SphereGeometry(0.058, 6, 4);
  const dotMat  = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
  R.disposables.push(dotGeo, dotMat);
  const dotIM  = new THREE.InstancedMesh(dotGeo, dotMat, DOT_MAX);
  dotIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  let dotCount = 0;
  const _dm = new THREE.Object3D();
  _dm.scale.setScalar(0);
  _dm.updateMatrix();
  for (let k = 0; k < DOT_MAX; k++) dotIM.setMatrixAt(k, _dm.matrix);
  dotIM.instanceMatrix.needsUpdate = true;
  dsGroup.add(dotIM);

  function addDot(y) {
    if (dotCount >= DOT_MAX) return;
    _dm.scale.setScalar(1);
    _dm.position.set(DS_SCR_X, y, 0.05 + Math.random() * 0.06);
    _dm.updateMatrix();
    dotIM.setMatrixAt(dotCount, _dm.matrix);
    dotIM.instanceMatrix.needsUpdate = true;
    dotCount++;
  }

  function resetDots() {
    dotCount = 0;
    _dm.scale.setScalar(0);
    _dm.updateMatrix();
    for (let k = 0; k < DOT_MAX; k++) dotIM.setMatrixAt(k, _dm.matrix);
    dotIM.instanceMatrix.needsUpdate = true;
    dotMat.color.setHex(_measuring ? 0x4488ff : 0x00ff88);
  }

  // Wave rings — pool of 10, each a custom arc line updated per frame
  const N_WAVES = 10;
  const N_ARC   = 48;
  const waveMat = new THREE.LineBasicMaterial({ color: 0x00cc66, transparent: true, opacity: 0.45 });
  R.disposables.push(waveMat);

  const wavePool = Array.from({ length: N_WAVES }, () => {
    const pos  = new Float32Array(N_ARC * 3);
    const geo  = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    R.disposables.push(geo);
    const line = new THREE.Line(geo, waveMat);
    line.visible = false;
    dsGroup.add(line);
    return { line, geo, cx: 0, cy: 0, r: 0, maxR: 1, type: 'primary' };
  });
  let nextWave = 0;
  let lastWaveT = -999;
  const WAVE_PERIOD = 1.3;
  const WAVE_SPEED  = 3.8;

  function spawnWave(cx, cy, maxR, type) {
    const w = wavePool[nextWave % N_WAVES];
    nextWave++;
    Object.assign(w, { cx, cy, r: 0, maxR, type });
    w.line.visible = true;
  }

  function updateWaveArc(w) {
    const pos = w.geo.attributes.position.array;
    for (let k = 0; k < N_ARC; k++) {
      const theta = (k / (N_ARC - 1)) * Math.PI * 2;
      pos[k * 3]     = w.cx + w.r * Math.cos(theta);
      pos[k * 3 + 1] = w.cy + w.r * Math.sin(theta);
      pos[k * 3 + 2] = 0;
    }
    w.geo.attributes.position.needsUpdate = true;
  }

  function resetWaves() {
    wavePool.forEach(w => { w.line.visible = false; w.r = 0; });
    nextWave = 0;
    lastWaveT = -999;
  }

  // Animated particles (pool of 8)
  const N_PART = 8;
  const partGeo = new THREE.SphereGeometry(0.07, 8, 6);
  const partMat = new THREE.MeshPhongMaterial({
    color: 0xffff88, emissive: 0xffff44, emissiveIntensity: 2.5,
    transparent: true, opacity: 0.92,
  });
  R.disposables.push(partGeo, partMat);
  const partPool = Array.from({ length: N_PART }, () => {
    const mesh = new THREE.Mesh(partGeo, partMat);
    mesh.visible = false;
    dsGroup.add(mesh);
    return { mesh, t: 0, targetY: 0, active: false };
  });
  let nextPart = 0;
  let lastPartT = -999;
  const PART_PERIOD = 0.52;
  const PART_DUR    = 1.4;

  function spawnParticle() {
    const p = partPool[nextPart % N_PART];
    nextPart++;
    p.t = 0;
    p.targetY = sampleY(_measuring);
    p.active = true;
    p.mesh.visible = true;
  }

  function resetParticles() {
    partPool.forEach(p => { p.active = false; p.mesh.visible = false; });
    nextPart = 0;
    lastPartT = -999;
  }

  // DS label: "source" on left, "screen" on right
  const mkDSLbl = (txt, pos) => {
    const div = document.createElement('div');
    div.className = 'node-lbl';
    div.style.cssText = 'font-size:9px;color:#6699cc;letter-spacing:.05em';
    div.textContent = txt;
    const o = new CSS2DObject(div);
    o.position.copy(pos);
    dsGroup.add(o);
    R.css2dObjects.push(o);
    dsLbls.push(div);
  };
  mkDSLbl('source',   new THREE.Vector3(DS_SRC_X,  DS_BH + 0.45, 0));
  mkDSLbl('barrier',  new THREE.Vector3(DS_BAR_X,  DS_BH + 0.45, 0));
  mkDSLbl('detector', new THREE.Vector3(DS_SCR_X,  DS_BH + 0.45, 0));

  // ── Overlay helper ───────────────────────────────────────────────────────────
  function updateOverlay() {
    if (_mode === 'dslits') {
      ov.innerHTML = `
        <div style="color:#00ff88;letter-spacing:.1em;font-size:11px">DOUBLE SLIT</div>
        <div style="font-size:8px;color:#44bb88;margin-top:2px">instrument-dependent visibility</div>
        <div style="margin-top:7px;font-size:8px;color:#88ccaa;line-height:1.9">
          ${_measuring
            ? '<span style="color:#66aaff">MEASURING ✓</span><br>which-path known<br>wave → particle<br>2 bands = classical'
            : '<span style="color:#00ff88">WAVE MODE</span><br>which-path unknown<br>fringes = interference<br>orbit still visible'}
        </div>
        <div style="margin-top:6px;font-size:7.5px;color:#558877;line-height:1.8">
          I(y) ∝ cos²(πDy/λL)<br>
          dots: ${dotCount} / ${DOT_MAX}<br>
          the instrument selects
        </div>`;
    } else {
      ov.innerHTML = `
        <div style="color:#ffcc44;letter-spacing:.1em;font-size:11px">RELATIVITY</div>
        <div style="font-size:9px;color:#cc9933;margin-top:2px;letter-spacing:.05em">E² = mc³</div>
        <div style="margin-top:7px;font-size:8px;color:#aa8844;line-height:1.9">
          ${ORBIT.map((n, i) =>
            `<span style="color:${CSTR[i]}">${n}/9c</span> γ=${GAMMA[i].toFixed(3)}`
          ).join('<br>')}
        </div>
        <div style="margin-top:6px;font-size:7.5px;color:#775533;line-height:1.8">
          γ = 1/√(1−β²)<br>
          τ=1 hyperbola dashed<br>
          hover → Lorentz ⊕
        </div>`;
    }
  }

  // ── Store state for exports ───────────────────────────────────────────────────
  _dsState = {
    stGroup, dsGroup, camera, controls, stLbls, dsLbls,
    resetDots, resetWaves, resetParticles, updateScreenTex, updateOverlay,
  };

  // ── Initial overlay + clock ──────────────────────────────────────────────────
  updateOverlay();
  if (R.clkDisplay) {
    R.clkDisplay.innerHTML =
      `<div style="color:#ffcc44;letter-spacing:.1em">21 · RELATIVITY</div>` +
      `<div style="color:#7a5a18;margin-top:3px;font-size:8px">orbit as world lines</div>`;
  }

  // ── Animation ─────────────────────────────────────────────────────────────────
  const ST_PERIOD = 7.0;
  let prevNow   = null;
  let stElapsed = 0;

  R.animFn = (now) => {
    const dt = prevNow === null ? 0 : (now - prevNow) / 1000;
    prevNow  = now;
    stElapsed += dt;

    controls.update();

    // ── Spacetime ──────────────────────────────────────────────────────────────
    if (_mode === 'spacetime') {
      travelers.forEach(({ mesh, mat, beta, gamma, i }) => {
        const phase  = i / ORBIT.length;
        const tNorm  = ((stElapsed / ST_PERIOD + phase) % 1);
        const ct     = tNorm * H * 2 - H;
        mesh.position.set(beta * ct, ct, 0);
        const baseEI = 0.5 + 0.5 / gamma;
        mat.emissiveIntensity = baseEI + 0.2 * Math.abs(Math.sin(stElapsed * 1.3 + i));
      });

      if (R.clkDisplay) {
        const tFrac = ((stElapsed % ST_PERIOD) / ST_PERIOD).toFixed(2);
        R.clkDisplay.innerHTML =
          `<div style="color:#ffcc44;letter-spacing:.1em">21 · RELATIVITY</div>` +
          `<div style="color:#7a5a18;margin-top:3px;font-size:8px">t̂ = ${tFrac} · τ ≤ t</div>`;
      }
      return;
    }

    // ── Double-slit ────────────────────────────────────────────────────────────
    const dsdt = dt * _dsSpeed;

    // Source pulse glow
    srcMat.emissiveIntensity = 2.5 + 1.5 * ((Math.sin(stElapsed * 5) + 1) / 2);

    // Spawn primary wave
    if (stElapsed - lastWaveT > WAVE_PERIOD / _dsSpeed) {
      lastWaveT = stElapsed;
      spawnWave(DS_SRC_X, 0, DS_BAR_X - DS_SRC_X, 'primary');
    }

    // Update all active waves
    wavePool.forEach(w => {
      if (!w.line.visible) return;
      w.r += WAVE_SPEED * dsdt;

      if (w.type === 'primary' && w.r >= w.maxR) {
        w.line.visible = false;
        // Secondary waves at slit positions
        if (_measuring) {
          const cy = (Math.random() < 0.5 ? 1 : -1) * DS_D / 2;
          spawnWave(DS_BAR_X, cy, DS_SCR_X - DS_BAR_X, 'secondary');
        } else {
          spawnWave(DS_BAR_X,  DS_D / 2, DS_SCR_X - DS_BAR_X, 'secondary');
          spawnWave(DS_BAR_X, -DS_D / 2, DS_SCR_X - DS_BAR_X, 'secondary');
        }
        return;
      }

      if (w.type === 'secondary' && w.r >= w.maxR) {
        w.line.visible = false;
        return;
      }

      updateWaveArc(w);
    });

    // Spawn particle
    if (stElapsed - lastPartT > PART_PERIOD / _dsSpeed) {
      lastPartT = stElapsed;
      spawnParticle();
    }

    // Update particles
    const totalD = DS_SCR_X - DS_SRC_X;
    const tBarFrac = (DS_BAR_X - DS_SRC_X) / totalD;   // fraction at barrier
    partPool.forEach(p => {
      if (!p.active) return;
      p.t += dsdt / PART_DUR;
      if (p.t >= 1) {
        // Land: add dot
        addDot(p.targetY);
        p.active = false;
        p.mesh.visible = false;
        // Refresh dot-count in overlay
        updateOverlay();
        return;
      }
      const x = DS_SRC_X + p.t * totalD;
      // Y: travels along x-axis until past barrier, then drifts to targetY
      const y = p.t < tBarFrac
        ? 0
        : p.targetY * ((p.t - tBarFrac) / (1 - tBarFrac));
      p.mesh.position.set(x, y, 0);
    });

    if (R.clkDisplay) {
      const measStr  = _measuring ? ' · measuring' : ' · wave';
      const speedStr = _dsSpeed === 1.0 ? '' : ` · ${_dsSpeed.toFixed(1)}×`;
      R.clkDisplay.innerHTML =
        `<div style="color:#00ff88;letter-spacing:.1em">21 · DOUBLE SLIT</div>` +
        `<div style="color:#1a4a2a;margin-top:3px;font-size:8px">` +
        `dots: ${dotCount}${measStr}${speedStr}</div>`;
    }
  };
}
