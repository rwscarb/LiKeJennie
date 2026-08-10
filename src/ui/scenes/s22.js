/**
 * RELATIVITY — Scene 21
 *
 * Minkowski spacetime diagram. Orbit elements [1,2,4,8,7,5] as world lines
 * at β = n/9. Light cone separates timelike from spacelike. Dashed hyperbola
 * marks constant proper time τ = 1 for each traveler.
 *
 * Relativistic velocity addition: orbit elements don't close under ⊕.
 * β(4/9) ⊕ β(8/9) ≈ 0.956c — Newtonian sum would be 1.33c (FTL).
 *
 * E² = mc³ — the lore's relativistic expression.
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

export function buildS22() {
  const canvas = R.canvas, ov = R.ov;
  const scene  = R.scene  = new THREE.Scene();
  const camera = R.camera = mkCamera();
  camera.position.set(5, 4, 14);
  camera.lookAt(0, 0, 0);
  const controls = R.controls = mkControls(camera);
  controls.autoRotate      = true;
  controls.autoRotateSpeed = 0.15;

  // ── ct / x axes ─────────────────────────────────────────────────────────────
  const axLine = (a, b, color, opacity = 0.16) => {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    R.disposables.push(geo, mat);
    scene.add(new THREE.Line(geo, mat));
  };
  axLine(
    new THREE.Vector3(0, -H - 0.6, 0), new THREE.Vector3(0, H + 0.6, 0),
    0xffffff, 0.16,
  );
  axLine(
    new THREE.Vector3(-H - 0.6, 0, 0), new THREE.Vector3(H + 0.6, 0, 0),
    0xffffff, 0.10,
  );

  // ── Light cone (future + past) ───────────────────────────────────────────────
  // THREE.ConeGeometry default: apex at +H/2, base at -H/2 (object space)
  // Future cone — apex at world y=0, opens upward:
  //   flip (rotation.x=π) → apex at -H/2 (obj) → position.y = H/2 → apex at world 0
  // Past cone — apex at world y=0, opens downward:
  //   no flip → apex at +H/2 (obj) → position.y = -H/2 → apex at world 0
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
      scene.add(mesh);
    }
  };
  addCone(true,  H / 2);   // future
  addCone(false, -H / 2);  // past

  // Apex glow
  {
    const geo = new THREE.SphereGeometry(0.10, 16, 10);
    const mat = new THREE.MeshPhongMaterial({
      color: 0xffcc44, emissive: 0xffcc44, emissiveIntensity: 2.5,
    });
    R.disposables.push(geo, mat);
    scene.add(new THREE.Mesh(geo, mat));
  }

  // ── World lines + travelers ──────────────────────────────────────────────────
  const wlMeshes = [];
  const wlMats   = [];
  const travelers = [];

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
    scene.add(wl);
    wlMeshes.push(wl);
    wlMats.push(mat);

    // Traveler
    const tgeo = new THREE.SphereGeometry(0.12, 12, 8);
    const tmat = new THREE.MeshPhongMaterial({
      color: CHEX[i], emissive: CHEX[i], emissiveIntensity: 1.0,
    });
    R.disposables.push(tgeo, tmat);
    const tm = new THREE.Mesh(tgeo, tmat);
    scene.add(tm);
    travelers.push({ mesh: tm, mat: tmat, beta, gamma: GAMMA[i], i });

    // Orbit element label at top
    const ndiv = document.createElement('div');
    ndiv.className = 'node-lbl';
    ndiv.style.cssText = `font-size:13px;color:${CSTR[i]};font-weight:bold`;
    ndiv.textContent = String(n);
    const nlbl = new CSS2DObject(ndiv);
    nlbl.position.set(topX, H + 0.55, 0);
    scene.add(nlbl);
    R.css2dObjects.push(nlbl);

    // β sub-label
    const bdiv = document.createElement('div');
    bdiv.className = 'node-lbl';
    bdiv.style.cssText = `font-size:7.5px;color:${CSTR[i]};opacity:0.65`;
    bdiv.textContent = `${n}/9 c`;
    const blbl = new CSS2DObject(bdiv);
    blbl.position.set(topX, H + 0.20, 0);
    scene.add(blbl);
    R.css2dObjects.push(blbl);
  });

  // ── τ = 1 proper-time hyperbola ct² − x² = 1 ──────────────────────────────
  // Parametric: (sinh η, cosh η) × SCALE for η ∈ [0, atanh(β_max + ε)]
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
    scene.add(hl);

    // τ label at η=0 (stationary observer point)
    const tdiv = document.createElement('div');
    tdiv.className = 'node-lbl';
    tdiv.style.cssText = 'font-size:8px;color:#556688;opacity:0.8';
    tdiv.textContent = 'τ = 1';
    const tlbl = new CSS2DObject(tdiv);
    tlbl.position.set(-0.25, SCALE + 0.18, 0);
    scene.add(tlbl);
    R.css2dObjects.push(tlbl);
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
    scene.add(m);
  });

  // ── Axis labels ──────────────────────────────────────────────────────────────
  const axLbl = (txt, pos, color = '#ffffff66', sz = '9px') => {
    const div = document.createElement('div');
    div.className = 'node-lbl';
    div.style.cssText = `font-size:${sz};color:${color}`;
    div.textContent = txt;
    const o = new CSS2DObject(div);
    o.position.copy(pos);
    scene.add(o);
    R.css2dObjects.push(o);
  };
  axLbl('ct', new THREE.Vector3(0.3,  H + 0.7, 0), '#ffffff66', '10px');
  axLbl('x',  new THREE.Vector3(H + 0.7, 0.3,  0), '#ffffff66', '10px');

  // ── Lighting ─────────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0x060610, 3.5));
  const pl = new THREE.PointLight(0xffcc44, 2.0, 22);
  pl.position.set(0, 6, 6);
  scene.add(pl);

  // ── Hover (raycasting on world lines) ────────────────────────────────────────
  canvas.addEventListener('mousemove', (e) => {
    if (R.cur !== 20) return;
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

  // ── Overlay ──────────────────────────────────────────────────────────────────
  ov.innerHTML = `
    <div style="color:#ffcc44;letter-spacing:.1em;font-size:11px">RELATIVITY</div>
    <div style="font-size:9px;color:#88661a;margin-top:2px;letter-spacing:.05em">E² = mc³</div>
    <div style="margin-top:7px;font-size:7.5px;color:#4a3a10;line-height:1.9">
      ${ORBIT.map((n, i) =>
        `<span style="color:${CSTR[i]}">${n}/9c</span> γ=${GAMMA[i].toFixed(3)}`
      ).join('<br>')}
    </div>
    <div style="margin-top:6px;font-size:7px;color:#3a3020;line-height:1.8">
      γ = 1/√(1−β²)<br>
      τ=1 hyperbola dashed<br>
      hover → Lorentz ⊕
    </div>`;

  // ── Clock display ─────────────────────────────────────────────────────────────
  if (R.clkDisplay) {
    R.clkDisplay.innerHTML =
      `<div style="color:#ffcc44;letter-spacing:.1em">21 · RELATIVITY</div>` +
      `<div style="color:#7a5a18;margin-top:3px;font-size:8px">orbit as world lines</div>`;
  }

  // ── Animation ─────────────────────────────────────────────────────────────────
  const PERIOD = 7.0;
  let startTime = null;

  R.animFn = (now) => {
    if (startTime === null) startTime = now;
    const elapsed = (now - startTime) / 1000;

    travelers.forEach(({ mesh, mat, beta, gamma, i }) => {
      const phase  = i / ORBIT.length;
      const tNorm  = ((elapsed / PERIOD + phase) % 1); // ∈ [0, 1)
      const ct     = tNorm * H * 2 - H;               // ct ∈ [−H, +H]
      mesh.position.set(beta * ct, ct, 0);

      // Slowly-moving travelers glow brighter (they age faster in proper time)
      const baseEI = 0.5 + 0.5 / gamma;
      mat.emissiveIntensity = baseEI + 0.2 * Math.abs(Math.sin(elapsed * 1.3 + i));
    });

    controls.update();

    if (R.clkDisplay) {
      const tFrac = ((elapsed % PERIOD) / PERIOD).toFixed(2);
      R.clkDisplay.innerHTML =
        `<div style="color:#ffcc44;letter-spacing:.1em">21 · RELATIVITY</div>` +
        `<div style="color:#7a5a18;margin-top:3px;font-size:8px">t̂ = ${tFrac} · τ ≤ t</div>`;
    }
  };
}
