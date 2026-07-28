/**
 * JENNIE 21 — Scene 08
 *
 * A WebGL visualization of the ×2 mod 9 doubling orbit wound around a
 * Fibonacci phyllotaxis cone. Two helix strands (orbit + echo) breathe
 * together via a single accordion scalar. Every node carries a radial
 * leader line to its balanced-ternary label.
 *
 * Pulsating inversion: counter-phase ghost layer anchored at F₈=21.
 * Toggle INVERSION (ghost nodes + labels), SHADING (phase membrane).
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
  const ORBIT   = [1, 2, 4, 8, 7, 5];
  const CYCLES  = 3;
  const M       = ORBIT.length;
  const STEPS   = 21; // F₈
  const COMP_OF = { 1:8, 2:7, 4:5, 5:4, 7:2, 8:1 };

  // ── Fibonacci golden angle ───────────────────────────────────────────────
  const PHI = (1 + Math.sqrt(5)) / 2;
  const GA  = 2 * Math.PI * (2 - PHI);

  const R_BASE = 0.28;
  const R_GROW = 0.13;
  const H_STEP = 0.68;
  const LEADER = 0.88;

  const helixR = s       => R_BASE + s * R_GROW;
  const baseX  = (s, φ) => helixR(s) * Math.cos(s * GA + φ);
  const baseZ  = (s, φ) => helixR(s) * Math.sin(s * GA + φ);
  const baseY  = s       => s * H_STEP;

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

  // ── Geometry collections ─────────────────────────────────────────────────
  const allMeshes   = [];
  const allLabels   = [];
  const leaderData  = [];
  const rungData    = [];
  const nilRingData = [];

  // ── Inversion + shading state ────────────────────────────────────────────
  let showInversion = false;
  let showShading   = false;
  let showDecimal   = false;  // shared by both primary and inversion labels

  const invMeshes    = [];
  const invLabelData = []; // { lbl, val, bt, cs, s }
  const invLineData  = []; // phase-tension lines

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
        color: st.c, transparent: true,
        opacity: isEcho ? 0.28 : 0.42,
      });
      R.disposables.push(lGeo, lMat);
      scene.add(new THREE.Line(lGeo, lMat));
      leaderData.push({ attr: lAttr, arr: lArr, s, lx, lz });

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

  buildStrand(0,       false);
  buildStrand(Math.PI, true);

  // ── Strand backbone lines ────────────────────────────────────────────────
  const makeStrandLine = (φ, color) => {
    const arr = new Float32Array(STEPS * 3);
    for (let s = 0; s < STEPS; s++) {
      arr[s * 3] = baseX(s, φ); arr[s * 3 + 1] = baseY(s); arr[s * 3 + 2] = baseZ(s, φ);
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

  // ── Rungs ────────────────────────────────────────────────────────────────
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

  // ── 6-nil rings ──────────────────────────────────────────────────────────
  for (let c = 0; c < CYCLES; c++) {
    const s   = c * M + 2.5;
    const N   = 49;
    const arr = new Float32Array(N * 3);
    const r   = helixR(s);
    for (let i = 0; i < N; i++) {
      const θ = (i / (N - 1)) * Math.PI * 2;
      arr[i * 3] = r * Math.cos(θ); arr[i * 3 + 1] = baseY(s); arr[i * 3 + 2] = r * Math.sin(θ);
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
    envArr[i * 3] = helixR(s) * Math.cos(s * GA);
    envArr[i * 3 + 1] = s * H_STEP;
    envArr[i * 3 + 2] = helixR(s) * Math.sin(s * GA);
  }
  const envMat = new THREE.LineBasicMaterial({ color: 0x0a1a0a, transparent: true, opacity: 0.15 });
  R.disposables.push(envGeo, envMat);
  scene.add(new THREE.Line(envGeo, envMat));

  // ── Pulsating inversion layer ─────────────────────────────────────────────
  // Ghost nodes use the same orbit colors as Strand A; counter-phase Y animation.
  // Labels use the same BT / decimal notation, smaller and slightly inside the leader.
  for (let s = 0; s < STEPS; s++) {
    const val = ORBIT[s % M];
    const st  = STYLE[val];

    // Ghost node: orbit-matched color, slightly smaller
    const geo = new THREE.SphereGeometry(0.11, 14, 9);
    const mat = new THREE.MeshPhongMaterial({
      color: st.c,
      emissive: st.c,
      emissiveIntensity: 0.22,
      transparent: true,
      opacity: 0.55,
      shininess: 80,
    });
    R.disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(baseX(s, 0), baseY(s), baseZ(s, 0));
    mesh.visible = false;
    mesh.userData = { s, baseEI: 0.22 };
    scene.add(mesh);
    invMeshes.push(mesh);

    // Label: inset toward axis (shorter LEADER_INV) so it doesn't crowd primary labels
    const { ux, uz } = radialDir(s, 0);
    const LEADER_INV = 0.36;
    const ilx = baseX(s, 0) + ux * LEADER_INV;
    const ilz = baseZ(s, 0) + uz * LEADER_INV;

    const div = document.createElement('div');
    div.className = 'node-lbl';
    div.textContent = BT[val];
    div.style.cssText = `font-size:10px;color:${st.cs};opacity:0.72;letter-spacing:.02em;`;
    const lbl = new CSS2DObject(div);
    lbl.position.set(ilx, baseY(s) + 0.10, ilz);
    lbl.visible = false;
    scene.add(lbl);
    R.css2dObjects.push(lbl);
    invLabelData.push({ lbl, val, bt: BT[val], cs: st.cs, s, ilx, ilz });

    // Phase-tension line: from main strand A node Y to inversion node Y
    const pArr  = new Float32Array(6);
    pArr[0] = baseX(s, 0); pArr[1] = baseY(s); pArr[2] = baseZ(s, 0);
    pArr[3] = baseX(s, 0); pArr[4] = baseY(s); pArr[5] = baseZ(s, 0);
    const pGeo  = new THREE.BufferGeometry();
    const pAttr = new THREE.BufferAttribute(pArr, 3);
    pAttr.setUsage(THREE.DynamicDrawUsage);
    pGeo.setAttribute('position', pAttr);
    const pMat  = new THREE.LineBasicMaterial({
      color: st.c, transparent: true, opacity: 0.22,
    });
    R.disposables.push(pGeo, pMat);
    const pLine = new THREE.Line(pGeo, pMat);
    pLine.visible = false;
    scene.add(pLine);
    invLineData.push({ attr: pAttr, arr: pArr, s, line: pLine });
  }

  // Inversion backbone
  const invBBArr  = new Float32Array(STEPS * 3);
  const invBBGeo  = new THREE.BufferGeometry();
  const invBBAttr = new THREE.BufferAttribute(invBBArr, 3);
  invBBAttr.setUsage(THREE.DynamicDrawUsage);
  invBBGeo.setAttribute('position', invBBAttr);
  for (let s = 0; s < STEPS; s++) {
    invBBArr[s * 3] = baseX(s, 0); invBBArr[s * 3 + 1] = baseY(s); invBBArr[s * 3 + 2] = baseZ(s, 0);
  }
  const invBBMat = new THREE.LineBasicMaterial({ color: 0xdd88ff, transparent: true, opacity: 0.30 });
  R.disposables.push(invBBGeo, invBBMat);
  const invBackbone = new THREE.Line(invBBGeo, invBBMat);
  invBackbone.visible = false;
  scene.add(invBackbone);

  // Anchor ring at step 20 (F₈ = 21st position)
  const ANCHOR_S = STEPS - 1;
  const ancN     = 64;
  const ancArr   = new Float32Array((ancN + 1) * 3);
  const ancGeo   = new THREE.BufferGeometry();
  const ancAttr  = new THREE.BufferAttribute(ancArr, 3);
  ancAttr.setUsage(THREE.DynamicDrawUsage);
  ancGeo.setAttribute('position', ancAttr);
  const ancR = helixR(ANCHOR_S) + 0.55;
  for (let i = 0; i <= ancN; i++) {
    const θ = (i / ancN) * Math.PI * 2;
    ancArr[i * 3] = ancR * Math.cos(θ); ancArr[i * 3 + 1] = baseY(ANCHOR_S); ancArr[i * 3 + 2] = ancR * Math.sin(θ);
  }
  const ancMat  = new THREE.LineBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.65 });
  R.disposables.push(ancGeo, ancMat);
  const anchorLine = new THREE.Line(ancGeo, ancMat);
  anchorLine.visible = false;
  scene.add(anchorLine);

  // ── Conceptual shading membrane ───────────────────────────────────────────
  // Quads between consecutive main strand A nodes and their inversion counterparts.
  // Vertex layout per pair s→s+1:
  //   v[4s+0] = main[s], v[4s+1] = inv[s], v[4s+2] = main[s+1], v[4s+3] = inv[s+1]
  // Triangles: (0,1,2) and (1,3,2)
  const shadePairs  = STEPS - 1;
  const shadePosArr = new Float32Array(shadePairs * 4 * 3);
  const shadeColArr = new Float32Array(shadePairs * 4 * 3);
  const shadeIdxArr = new Uint16Array(shadePairs * 6);

  for (let s = 0; s < shadePairs; s++) {
    const base = s * 4;
    // Positions (Y placeholders; updated each frame)
    for (let k = 0; k < 4; k++) {
      const ss = k < 2 ? s : s + 1;
      const i  = (base + k) * 3;
      shadePosArr[i]     = baseX(ss, 0);
      shadePosArr[i + 1] = baseY(ss);
      shadePosArr[i + 2] = baseZ(ss, 0);
    }
    // Per-vertex colors by orbit group
    const val = ORBIT[s % M];
    const col = new THREE.Color(STYLE[val].c);
    for (let k = 0; k < 4; k++) {
      const i = (base + k) * 3;
      shadeColArr[i] = col.r; shadeColArr[i + 1] = col.g; shadeColArr[i + 2] = col.b;
    }
    // Triangle indices
    const bi = s * 6;
    shadeIdxArr[bi]     = base;
    shadeIdxArr[bi + 1] = base + 1;
    shadeIdxArr[bi + 2] = base + 2;
    shadeIdxArr[bi + 3] = base + 1;
    shadeIdxArr[bi + 4] = base + 3;
    shadeIdxArr[bi + 5] = base + 2;
  }

  const shadeGeo     = new THREE.BufferGeometry();
  const shadePosAttr = new THREE.BufferAttribute(shadePosArr, 3);
  shadePosAttr.setUsage(THREE.DynamicDrawUsage);
  shadeGeo.setAttribute('position', shadePosAttr);
  shadeGeo.setAttribute('color', new THREE.BufferAttribute(shadeColArr, 3));
  shadeGeo.setIndex(new THREE.BufferAttribute(shadeIdxArr, 1));
  const shadeMat  = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.13, side: THREE.DoubleSide,
  });
  R.disposables.push(shadeGeo, shadeMat);
  const shadeMesh = new THREE.Mesh(shadeGeo, shadeMat);
  shadeMesh.visible = false;
  scene.add(shadeMesh);

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

  document.getElementById('p8comp').onclick = () => {
    showDecimal = !showDecimal;
    document.getElementById('p8comp').classList.toggle('lit', showDecimal);
    allLabels.forEach(l => { l.lbl.element.textContent = showDecimal ? l.val : l.bt; });
    invLabelData.forEach(l => { l.lbl.element.textContent = showDecimal ? l.val : l.bt; });
  };

  const setInversionVisible = v => {
    invMeshes.forEach(m => { m.visible = v; });
    invLabelData.forEach(({ lbl }) => { lbl.visible = v; });
    invLineData.forEach(({ line }) => { line.visible = v; });
    invBackbone.visible = v;
    anchorLine.visible  = v;
  };

  document.getElementById('p8inv').onclick = () => {
    showInversion = !showInversion;
    document.getElementById('p8inv').classList.toggle('lit', showInversion);
    setInversionVisible(showInversion);
    if (!showInversion && showShading) {
      showShading = false;
      document.getElementById('p8shade').classList.remove('lit');
      shadeMesh.visible = false;
    }
  };

  document.getElementById('p8shade').onclick = () => {
    showShading = !showShading;
    document.getElementById('p8shade').classList.toggle('lit', showShading);
    // Shading needs inversion to be meaningful; auto-enable it
    if (showShading && !showInversion) {
      showInversion = true;
      document.getElementById('p8inv').classList.add('lit');
      setInversionVisible(true);
    }
    shadeMesh.visible = showShading;
  };

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
  R.animFn = () => {
    const t        = Date.now() * 0.001;
    const breath   = 1 + 0.10 * Math.sin(t * 0.50);
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
      arr[1] = y; arr[4] = y;
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

    // ── Inversion updates ──────────────────────────────────────────────────
    if (showInversion) {
      invMeshes.forEach(m => {
        const s = m.userData.s;
        m.position.y = baseY(s) * breathInv;
        m.material.emissiveIntensity = m.userData.baseEI
          + 0.12 * Math.abs(Math.sin(t * 1.1 + s * 0.42 + Math.PI));
      });

      invLabelData.forEach(l => {
        l.lbl.position.set(l.ilx, baseY(l.s) * breathInv + 0.10, l.ilz);
        l.lbl.element.textContent = showDecimal ? l.val : l.bt;
      });

      invLineData.forEach(({ attr, arr, s }) => {
        arr[1] = baseY(s) * breath;    // main strand A node Y
        arr[4] = baseY(s) * breathInv; // ghost node Y
        attr.needsUpdate = true;
      });

      for (let s = 0; s < STEPS; s++) {
        invBBArr[s * 3 + 1] = baseY(s) * breathInv;
      }
      invBBAttr.needsUpdate = true;

      const ancY = baseY(ANCHOR_S) * breathInv;
      for (let i = 0; i <= ancN; i++) ancArr[i * 3 + 1] = ancY;
      ancAttr.needsUpdate = true;
      ancMat.opacity = 0.45 + 0.25 * Math.abs(Math.sin(t * 0.5 + Math.PI));
    }

    // ── Shading membrane ──────────────────────────────────────────────────
    if (showShading) {
      for (let s = 0; s < shadePairs; s++) {
        const base = s * 4;
        // v[0]=main[s], v[1]=inv[s], v[2]=main[s+1], v[3]=inv[s+1]
        shadePosArr[(base + 0) * 3 + 1] = baseY(s)     * breath;
        shadePosArr[(base + 1) * 3 + 1] = baseY(s)     * breathInv;
        shadePosArr[(base + 2) * 3 + 1] = baseY(s + 1) * breath;
        shadePosArr[(base + 3) * 3 + 1] = baseY(s + 1) * breathInv;
      }
      shadePosAttr.needsUpdate = true;
      // Pulse opacity with phase gap magnitude
      const gap = Math.abs(breath - breathInv);
      shadeMat.opacity = 0.07 + 0.12 * (gap / 0.20);
    }

    R.labelRenderer.render(scene, camera);
  };
}
