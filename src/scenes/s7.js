/**
 * JENNIE 21 — Scene 08
 *
 * A WebGL visualization of the ×2 mod 9 doubling orbit wound around a
 * Fibonacci phyllotaxis cone. Two helix strands (orbit + echo) breathe
 * together via a single accordion scalar. Every node carries a radial
 * leader line to its balanced-ternary label, tip at the leader endpoint.
 *
 * Pulsating inversion: a counter-phase ghost layer anchored at step 20
 * (count 21 = F₈). When the main helix expands, the inversion contracts.
 * Toggle with the INVERSION button.
 *
 * Mathematical foundations:
 *   - Orbit:    1→2→4→8→7→5  (×2 mod 9, period 6; 3/6/9 excluded)
 *   - Echoes:   1↔8, 2↔7, 4↔5  (complement pairs summing to 9)
 *   - Trits:    5=−1, 6=0, 7=+1  (balanced ternary centered on 6, the nil element)
 *   - Geometry: golden angle GA=2π(2−φ) per step, expanding radius, constant Y step
 *   - Arc:      step 21 ≈ F₈ is where the spiral nearly closes → inversion anchor
 */
import {
  THREE, CSS2DObject, R, mkCamera, mkControls,
  tip, tmv, htip,
} from './shared.js';

export function buildS7() {
  const canvas = R.canvas, ov = R.ov;
  const scene  = R.scene  = new THREE.Scene();
  const camera = R.camera = mkCamera();
  camera.position.set(14, 5, 5);
  camera.lookAt(0, 7, 0);
  const controls = R.controls = mkControls(camera);
  controls.target.set(0, 7, 0);
  controls.update();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.28;

  // ── Orbit constants ──────────────────────────────────────────────────────
  const ORBIT   = [1, 2, 4, 8, 7, 5]; // ×2 mod 9, period 6
  const CYCLES  = 3;
  const M       = ORBIT.length;        // 6
  const STEPS   = 21;                  // F₈ — 3 full cycles (18) + 3 into the 4th
  const COMP_OF = { 1:8, 2:7, 4:5, 5:4, 7:2, 8:1 }; // echo complement: a+COMP_OF[a]=9

  // ── Fibonacci golden angle ───────────────────────────────────────────────
  const PHI = (1 + Math.sqrt(5)) / 2;
  const GA  = 2 * Math.PI * (2 - PHI); // ≈ 137.508° — irrational, so nodes never repeat angle

  // Tornado geometry: radius expands linearly with step, height is constant per step
  const R_BASE = 0.28;
  const R_GROW = 0.13;
  const H_STEP = 0.68;
  const LEADER = 0.88; // extra radial distance from node to label tip

  const helixR = s       => R_BASE + s * R_GROW;
  const baseX  = (s, φ) => helixR(s) * Math.cos(s * GA + φ);
  const baseZ  = (s, φ) => helixR(s) * Math.sin(s * GA + φ);
  const baseY  = s       => s * H_STEP;

  // Radial unit direction in the XZ plane (used for leader lines and label placement)
  const radialDir = (s, φ) => {
    const x = baseX(s, φ), z = baseZ(s, φ);
    const r = Math.sqrt(x * x + z * z) || 1;
    return { ux: x / r, uz: z / r };
  };

  const labelEndpoint = (s, φ) => {
    const { ux, uz } = radialDir(s, φ);
    return { lx: baseX(s, φ) + ux * LEADER, lz: baseZ(s, φ) + uz * LEADER };
  };

  // ── Balanced ternary centered on 6 ──────────────────────────────────────
  // Digit map: 5=−1  6=0 (nil/absent)  7=+1
  const toBT = n => {
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
  };
  const BT = {};
  ORBIT.forEach(v => { BT[v] = toBT(v); });

  // ── Colour palette ───────────────────────────────────────────────────────
  const STYLE = {
    1: { c: 0xFFD700, cs: '#FFD700' },
    2: { c: 0x00E5FF, cs: '#00E5FF' },
    4: { c: 0x00E5FF, cs: '#00E5FF' },
    7: { c: 0x5060FF, cs: '#5060FF' },
    5: { c: 0xFF6B35, cs: '#FF6B35' },
    8: { c: 0xFF6B35, cs: '#FF6B35' },
  };

  // ── Geometry collections (kept for per-frame animation updates) ──────────
  const allMeshes  = [];
  const allLabels  = []; // { lbl, val, bt, s, lx, lz }
  const leaderData = []; // { attr, arr, s, lx, lz } — DynamicDrawUsage lines
  const rungData   = []; // { attr, arr, mat, s }
  const nilRingData = []; // { attr, arr, s, N } — 6-nil axis rings

  // ── Inversion layer state ─────────────────────────────────────────────────
  let showInversion = false;
  const invMeshes   = []; // ghost nodes (same orbital XZ as strand A)
  const invLineData = []; // { attr, arr, s } — vertical phase-tension lines

  // ── Build one helix strand ───────────────────────────────────────────────
  const buildStrand = (φ, isEcho) => {
    for (let s = 0; s < STEPS; s++) {
      const val = isEcho ? COMP_OF[ORBIT[s % M]] : ORBIT[s % M];
      const st  = STYLE[val];

      const geo = new THREE.SphereGeometry(0.14, 16, 10);
      const mat = new THREE.MeshPhongMaterial({
        color: st.c,
        emissive: st.c,
        emissiveIntensity: 0.38,
        transparent: true,
        opacity: isEcho ? 0.70 : 0.95,
        shininess: 70,
      });
      R.disposables.push(geo, mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(baseX(s, φ), baseY(s), baseZ(s, φ));
      mesh.userData = { val, s, φ, isEcho, cs: st.cs, bt: BT[val], baseEI: 0.38 };
      scene.add(mesh);
      allMeshes.push(mesh);

      // Leader line: from node outward to label endpoint
      const nx = baseX(s, φ);
      const nz = baseZ(s, φ);
      const { lx, lz } = labelEndpoint(s, φ);
      const lArr  = new Float32Array(6);
      lArr[0] = nx; lArr[1] = baseY(s); lArr[2] = nz;
      lArr[3] = lx; lArr[4] = baseY(s); lArr[5] = lz;
      const lGeo  = new THREE.BufferGeometry();
      const lAttr = new THREE.BufferAttribute(lArr, 3);
      lAttr.setUsage(THREE.DynamicDrawUsage);
      lGeo.setAttribute('position', lAttr);
      const lMat = new THREE.LineBasicMaterial({
        color: st.c,
        transparent: true,
        opacity: isEcho ? 0.28 : 0.42,
      });
      R.disposables.push(lGeo, lMat);
      scene.add(new THREE.Line(lGeo, lMat));
      leaderData.push({ attr: lAttr, arr: lArr, s, lx, lz });

      // CSS2D label — sits at the far end of the leader line
      const div = document.createElement('div');
      div.className = 'node-lbl';
      div.textContent = BT[val];
      div.style.cssText = `font-size:12px;color:${st.cs};`;
      const lbl = new CSS2DObject(div);
      lbl.position.set(lx, baseY(s) + 0.12, lz);
      scene.add(lbl);
      R.css2dObjects.push(lbl);
      allLabels.push({ lbl, val, bt: BT[val], cs: st.cs, s, lx, lz });
    }
  };

  buildStrand(0,         false); // Strand A: orbit  (φ=0)
  buildStrand(Math.PI,   true);  // Strand B: echoes (φ=π, opposite side)

  // ── Strand backbone lines ────────────────────────────────────────────────
  const makeStrandLine = (φ, color) => {
    const arr = new Float32Array(STEPS * 3);
    for (let s = 0; s < STEPS; s++) {
      arr[s * 3]     = baseX(s, φ);
      arr[s * 3 + 1] = baseY(s);
      arr[s * 3 + 2] = baseZ(s, φ);
    }
    const geo  = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(arr, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 });
    R.disposables.push(geo, mat);
    scene.add(new THREE.Line(geo, mat));
    return { attr, arr };
  };
  const strandLines = [
    makeStrandLine(0,       0xff2d78),
    makeStrandLine(Math.PI, 0x0080aa),
  ];

  // ── Rungs — horizontal cross-connectors between echo pairs ──────────────
  for (let s = 0; s < STEPS; s++) {
    const arr  = new Float32Array(6);
    arr[0] = baseX(s, 0);       arr[1] = baseY(s); arr[2] = baseZ(s, 0);
    arr[3] = baseX(s, Math.PI); arr[4] = baseY(s); arr[5] = baseZ(s, Math.PI);
    const geo  = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(arr, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const mat = new THREE.LineBasicMaterial({ color: 0x0a0830, transparent: true, opacity: 0.18 });
    R.disposables.push(geo, mat);
    scene.add(new THREE.Line(geo, mat));
    rungData.push({ attr, arr, mat, s });
  }

  // ── 6-nil axis rings ─────────────────────────────────────────────────────
  for (let c = 0; c < CYCLES; c++) {
    const s    = c * M + 2.5;
    const N    = 49;
    const arr  = new Float32Array(N * 3);
    const r    = helixR(s);
    for (let i = 0; i < N; i++) {
      const θ = (i / (N - 1)) * Math.PI * 2;
      arr[i * 3]     = r * Math.cos(θ);
      arr[i * 3 + 1] = baseY(s);
      arr[i * 3 + 2] = r * Math.sin(θ);
    }
    const geo  = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(arr, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const mat = new THREE.LineBasicMaterial({ color: 0x4466aa, transparent: true, opacity: 0.22 });
    R.disposables.push(geo, mat);
    scene.add(new THREE.Line(geo, mat));
    nilRingData.push({ attr, arr, s, N });
  }

  // ── Tornado envelope ─────────────────────────────────────────────────────
  const N_ENV   = 60;
  const envArr  = new Float32Array(N_ENV * 3);
  const envGeo  = new THREE.BufferGeometry();
  const envAttr = new THREE.BufferAttribute(envArr, 3);
  envAttr.setUsage(THREE.DynamicDrawUsage);
  envGeo.setAttribute('position', envAttr);
  for (let i = 0; i < N_ENV; i++) {
    const s = (i / (N_ENV - 1)) * (STEPS - 1);
    envArr[i * 3]     = helixR(s) * Math.cos(s * GA);
    envArr[i * 3 + 1] = s * H_STEP;
    envArr[i * 3 + 2] = helixR(s) * Math.sin(s * GA);
  }
  const envMat = new THREE.LineBasicMaterial({ color: 0x0a1a0a, transparent: true, opacity: 0.15 });
  R.disposables.push(envGeo, envMat);
  scene.add(new THREE.Line(envGeo, envMat));

  // ── Pulsating inversion — ghost nodes anchored at step 20 (count 21 = F₈) ─
  // Each ghost node sits at the same XZ as Strand A but breathes counter-phase.
  // breathInv = 1 − 0.10·sin(t·0.50), so when main expands, inversion contracts.
  // The anchor ring at step 20 marks the F₈ boundary where both phases equal rest.
  for (let s = 0; s < STEPS; s++) {
    const geo = new THREE.SphereGeometry(0.09, 12, 8);
    const mat = new THREE.MeshPhongMaterial({
      color: 0x88aaff,
      emissive: 0x4466cc,
      emissiveIntensity: 0.55,
      transparent: true,
      opacity: 0.50,
      shininess: 90,
    });
    R.disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(baseX(s, 0), baseY(s), baseZ(s, 0));
    mesh.visible = false;
    mesh.userData = { s };
    scene.add(mesh);
    invMeshes.push(mesh);

    // Phase-tension line: vertical segment from main Y to inversion Y at this step
    const pArr  = new Float32Array(6);
    pArr[0] = baseX(s, 0); pArr[1] = baseY(s); pArr[2] = baseZ(s, 0);
    pArr[3] = baseX(s, 0); pArr[4] = baseY(s); pArr[5] = baseZ(s, 0);
    const pGeo  = new THREE.BufferGeometry();
    const pAttr = new THREE.BufferAttribute(pArr, 3);
    pAttr.setUsage(THREE.DynamicDrawUsage);
    pGeo.setAttribute('position', pAttr);
    const pMat  = new THREE.LineBasicMaterial({ color: 0x6677ff, transparent: true, opacity: 0.30 });
    R.disposables.push(pGeo, pMat);
    const pLine = new THREE.Line(pGeo, pMat);
    pLine.visible = false;
    scene.add(pLine);
    invLineData.push({ attr: pAttr, arr: pArr, s, line: pLine });
  }

  // Inversion backbone line
  const invLineArr  = new Float32Array(STEPS * 3);
  const invLineGeo  = new THREE.BufferGeometry();
  const invLineAttr = new THREE.BufferAttribute(invLineArr, 3);
  invLineAttr.setUsage(THREE.DynamicDrawUsage);
  invLineGeo.setAttribute('position', invLineAttr);
  for (let s = 0; s < STEPS; s++) {
    invLineArr[s * 3]     = baseX(s, 0);
    invLineArr[s * 3 + 1] = baseY(s);
    invLineArr[s * 3 + 2] = baseZ(s, 0);
  }
  const invBackboneMat = new THREE.LineBasicMaterial({ color: 0x4455cc, transparent: true, opacity: 0.35 });
  R.disposables.push(invLineGeo, invBackboneMat);
  const invBackbone = new THREE.Line(invLineGeo, invBackboneMat);
  invBackbone.visible = false;
  scene.add(invBackbone);

  // Anchor ring at step 20 (count 21 = F₈) — visible whenever inversion is on
  const ANCHOR_S = STEPS - 1; // step 20
  const anchorN  = 64;
  const anchorArr  = new Float32Array((anchorN + 1) * 3);
  const anchorGeo  = new THREE.BufferGeometry();
  const anchorAttr = new THREE.BufferAttribute(anchorArr, 3);
  anchorAttr.setUsage(THREE.DynamicDrawUsage);
  anchorGeo.setAttribute('position', anchorAttr);
  const anchorR    = helixR(ANCHOR_S) + 0.55;
  for (let i = 0; i <= anchorN; i++) {
    const θ = (i / anchorN) * Math.PI * 2;
    anchorArr[i * 3]     = anchorR * Math.cos(θ);
    anchorArr[i * 3 + 1] = baseY(ANCHOR_S);
    anchorArr[i * 3 + 2] = anchorR * Math.sin(θ);
  }
  const anchorMat  = new THREE.LineBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.65 });
  R.disposables.push(anchorGeo, anchorMat);
  const anchorLine = new THREE.Line(anchorGeo, anchorMat);
  anchorLine.visible = false;
  scene.add(anchorLine);

  // ── Lighting ─────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0xffffff, 0.1));
  const pl1 = new THREE.PointLight(0xFFD700, 1.1, 35); pl1.position.set( 0, 14,  7); scene.add(pl1);
  const pl2 = new THREE.PointLight(0xFF6B35, 0.6, 24); pl2.position.set(-8,  5, -6); scene.add(pl2);
  const pl3 = new THREE.PointLight(0x5060FF, 0.55,24); pl3.position.set( 8,  2,  6); scene.add(pl3);

  // ── HUD overlay ──────────────────────────────────────────────────────────
  ov.innerHTML =
    `<div style="color:#2a9060;letter-spacing:.1em">08 · JENNIE 21</div>` +
    `<div style="color:#FFD700;font-size:8px;margin-top:2px">896 = 2<sup>7</sup>×7 · τ=16 · φ-step</div>` +
    `<div style="color:#2a6048;font-size:7.5px;margin-top:2px">1→2→4→8→7→5 (×2 mod 9)</div>` +
    `<div style="font-size:7.5px;margin-top:2px">` +
      `<span style="color:#00E5FF">2,4,7</span> &nbsp;` +
      `<span style="color:#FF6B35">5,8</span> &nbsp;` +
      `<span style="color:#FFD700">1</span></div>` +
    `<div style="color:#2a4a3a;font-size:7px;margin-top:2px">trits: 5=−1 &nbsp;<b style="color:#aaf">6=0</b> &nbsp;7=+1</div>` +
    `<div style="color:#2a3a4a;font-size:7px;margin-top:1px">golden angle ≈137.5° · F₈=21 anchor</div>`;

  // ── Controls ──────────────────────────────────────────────────────────────
  document.getElementById('p8rot').onclick = () => {
    controls.autoRotate = !controls.autoRotate;
    document.getElementById('p8rot').classList.toggle('lit', controls.autoRotate);
  };

  // COMPLEMENT button: toggle between trit labels and decimal values
  let showDecimal = false;
  document.getElementById('p8comp').onclick = () => {
    showDecimal = !showDecimal;
    document.getElementById('p8comp').classList.toggle('lit', showDecimal);
    allLabels.forEach(l => { l.lbl.element.textContent = showDecimal ? l.val : l.bt; });
  };

  // INVERSION button: toggle counter-phase ghost layer
  document.getElementById('p8inv').onclick = () => {
    showInversion = !showInversion;
    document.getElementById('p8inv').classList.toggle('lit', showInversion);
    invMeshes.forEach(m => { m.visible = showInversion; });
    invLineData.forEach(({ line }) => { line.visible = showInversion; });
    invBackbone.visible = showInversion;
    anchorLine.visible  = showInversion;
  };

  // Camera presets
  const PRESETS = {
    side: { pos: [14,  5,  5], tgt: [0, 7, 0] },
    top:  { pos: [ 0, 24,  3], tgt: [0, 7, 0] },
    hero: { pos: [ 8,  1, 10], tgt: [0, 7, 0] },
  };
  const applyPreset = key => {
    const { pos, tgt } = PRESETS[key];
    camera.position.set(...pos);
    camera.lookAt(...tgt);
    controls.target.set(...tgt);
    controls.update();
  };
  ['side', 'top', 'hero'].forEach(k => {
    document.getElementById(`p8v_${k}`).onclick = () => applyPreset(k);
  });

  // ── Hover / raycasting ───────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const mouse     = new THREE.Vector2();
  let   lastHl    = -1;
  const statEl    = document.getElementById('p8stat');

  canvas.addEventListener('mousemove', e => {
    if (R.cur !== 7) return;
    const rect = canvas.getBoundingClientRect();
    mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(allMeshes);
    const idx  = hits.length > 0 ? allMeshes.indexOf(hits[0].object) : -1;

    if (idx !== lastHl) {
      if (lastHl >= 0) {
        allMeshes[lastHl].material.emissiveIntensity = allMeshes[lastHl].userData.baseEI;
        allMeshes[lastHl].scale.setScalar(1);
      }
      if (idx >= 0) {
        allMeshes[idx].material.emissiveIntensity = 0.95;
        allMeshes[idx].scale.setScalar(2.2);
      }
      lastHl = idx;
    }

    if (idx >= 0) {
      const { val, bt, cs, isEcho } = allMeshes[idx].userData;
      const echo = COMP_OF[val];
      let h = `<div class="th" style="color:${cs}">${val}</div>`;
      h += `<p class="tr">trit: <b>${bt}</b> · ${isEcho ? 'echo' : 'orbit'}</p>`;
      h += `<p class="tr">echo of <b>${echo}</b> [${BT[echo]}]</p>`;
      h += `<p class="tr" style="color:#888aaa">6=nil · balanced on 6</p>`;
      if ([2, 4, 7].includes(val)) h += `<p class="tr" style="color:#00E5FF">2+4+7 = 13</p>`;
      if ([5, 8].includes(val))    h += `<p class="tr" style="color:#FF6B35">5+8 = 13</p>`;
      if (val === 7)               h += `<p class="tr" style="color:#5060FF">+1 trit · orbit step 4</p>`;
      if (val === 1)               h += `<p class="tr" style="color:#FFD700">identity — orbit generator</p>`;
      tip(e, h);
      statEl.textContent = `${val} [${bt}]`;
      tmv(e);
    } else {
      htip();
      statEl.textContent = '';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (lastHl >= 0 && R.cur === 7) {
      allMeshes[lastHl].material.emissiveIntensity = allMeshes[lastHl].userData.baseEI;
      allMeshes[lastHl].scale.setScalar(1);
    }
    lastHl = -1;
    htip();
  });

  // ── Animation loop ───────────────────────────────────────────────────────
  // Main breath: all primary geometry scales from Y=0 together.
  // Inversion breath: counter-phase — when main expands, inversion contracts.
  // The anchor at step 20 (count 21 = F₈) is where the inversion terminates.
  R.animFn = () => {
    const t        = Date.now() * 0.001;
    const breath   = 1 + 0.10 * Math.sin(t * 0.50); // ±10%, ~12.6 s cycle
    const breathInv= 1 - 0.10 * Math.sin(t * 0.50); // counter-phase

    allMeshes.forEach((m, i) => {
      m.position.y = baseY(m.userData.s) * breath;
      if (i !== lastHl) {
        m.material.emissiveIntensity = m.userData.baseEI
          + 0.1 * Math.abs(Math.sin(t * 1.1 + m.userData.s * 0.42));
      }
    });

    leaderData.forEach(({ attr, arr, s }) => {
      const y = baseY(s) * breath;
      arr[1] = y;
      arr[4] = y;
      attr.needsUpdate = true;
    });

    allLabels.forEach(l => {
      l.lbl.position.set(l.lx, baseY(l.s) * breath + 0.12, l.lz);
    });

    strandLines.forEach(({ attr, arr }) => {
      for (let s = 0; s < STEPS; s++) arr[s * 3 + 1] = baseY(s) * breath;
      attr.needsUpdate = true;
    });

    rungData.forEach(({ attr, arr, mat, s }) => {
      const y = baseY(s) * breath;
      arr[1] = y; arr[4] = y;
      attr.needsUpdate = true;
      mat.opacity = 0.10 + 0.10 * Math.abs(Math.sin(t * 0.75 - s * 0.28));
    });

    nilRingData.forEach(({ attr, arr, s, N }) => {
      const y = baseY(s) * breath;
      for (let i = 0; i < N; i++) arr[i * 3 + 1] = y;
      attr.needsUpdate = true;
    });

    for (let i = 0; i < N_ENV; i++) {
      const s = (i / (N_ENV - 1)) * (STEPS - 1);
      envArr[i * 3 + 1] = s * H_STEP * breath;
    }
    envAttr.needsUpdate = true;

    if (showInversion) {
      invMeshes.forEach(m => {
        const s = m.userData.s;
        m.position.y = baseY(s) * breathInv;
        m.material.emissiveIntensity = 0.45
          + 0.15 * Math.abs(Math.sin(t * 1.1 + s * 0.42 + Math.PI));
      });

      invLineData.forEach(({ attr, arr, s }) => {
        arr[1] = baseY(s) * breath;    // main strand A node Y
        arr[4] = baseY(s) * breathInv; // ghost node Y
        attr.needsUpdate = true;
      });

      for (let s = 0; s < STEPS; s++) {
        invLineArr[s * 3 + 1] = baseY(s) * breathInv;
      }
      invLineAttr.needsUpdate = true;

      // Anchor ring pulses gently at step 20's inversion Y
      const anchorY = baseY(ANCHOR_S) * breathInv;
      for (let i = 0; i <= anchorN; i++) anchorArr[i * 3 + 1] = anchorY;
      anchorAttr.needsUpdate = true;
      anchorMat.opacity = 0.45 + 0.25 * Math.abs(Math.sin(t * 0.5 + Math.PI));
    }

    R.labelRenderer.render(scene, camera);
  };
}
