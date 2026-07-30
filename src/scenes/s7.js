/**
 * JENNIE 21 — Scene 08
 *
 * ×2 mod 9 orbit wound onto a Fibonacci phyllotaxis cone.
 * Strand A (orbit) and Strand B (echo) rotate independently via CW/CCW controls.
 * Inversion layer (counter-phase ghost) + shading membrane toggle.
 */
import {
  THREE, CSS2DObject, R, mkCamera, mkControls,
  tip, tmv, htip,
} from './shared.js';

export function buildS7() {
  const canvas = R.canvas, ov = R.ov;
  const scene  = R.scene  = new THREE.Scene();
  const camera = R.camera = mkCamera();
  camera.position.set(20, 5, 10);
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
  const STEPS   = 21;
  const COMP_OF = { 1:8, 2:7, 4:5, 5:4, 7:2, 8:1 };

  const PHI = (1 + Math.sqrt(5)) / 2;
  const GA  = 2 * Math.PI * (2 - PHI);

  let R_BASE = 0.28;
  let R_GROW = 0.00;
  let H_STEP = 0.68;
  let breathAmp  = 0.10;
  let breathFreq = 0.50;
  const LEADER     = 0.88;
  const LEADER_INV = 0.36; // inversion labels sit inset toward axis

  const helixR = s        => R_BASE + s * R_GROW;
  // Dynamic position helpers: φ is the strand's base phase, rot is accumulated rotation
  const nodeX  = (s, φ, rot) => helixR(s) * Math.cos(s * GA + φ + rot);
  const nodeZ  = (s, φ, rot) => helixR(s) * Math.sin(s * GA + φ + rot);
  const baseY  = s           => s * H_STEP;

  // Radial unit dir for label placement
  const radialDir = (s, φ, rot) => {
    const x = nodeX(s, φ, rot), z = nodeZ(s, φ, rot);
    const r = Math.sqrt(x * x + z * z) || 1;
    return { ux: x / r, uz: z / r };
  };
  const labelEnd = (s, φ, rot, leader) => {
    const { ux, uz } = radialDir(s, φ, rot);
    return { lx: nodeX(s, φ, rot) + ux * leader, lz: nodeZ(s, φ, rot) + uz * leader };
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

  const STYLE = {
    1: { c: 0xFFD700, cs: '#FFD700' },
    2: { c: 0x00E5FF, cs: '#00E5FF' },
    4: { c: 0x00E5FF, cs: '#00E5FF' },
    7: { c: 0x5060FF, cs: '#5060FF' },
    5: { c: 0xFF6B35, cs: '#FF6B35' },
    8: { c: 0xFF6B35, cs: '#FF6B35' },
  };

  // ── Per-strand rotation state ─────────────────────────────────────────────
  let rotA = 0, rotB = 0;       // accumulated angles (radians)
  let spinA = 0, spinB = 0;     // rad/s; positive = CCW from above
  let SPIN_SPEED = 0.40;         // rad/s

  // ── Geometry collections ─────────────────────────────────────────────────
  const allMeshes   = []; // userData: { val, s, φ, isEcho, cs, bt, baseEI }
  const allLabels   = []; // { lbl, val, bt, cs, s, φ }
  const leaderData  = []; // { attr, arr, s, φ } — XYZ updated every frame
  const rungData    = []; // { attr, arr, mat, s }
  const nilRingData = []; // { attr, arr, s, N }

  let showInversion = false;
  let showShading   = false;
  let showDecimal   = true;

  const invMeshes    = []; // { mesh, s } — strand A positions, counter-phase Y
  const invLabelData = []; // { lbl, val, bt, cs, s }
  const invLineData  = []; // { attr, arr, s, line }

  // ── Build one helix strand ───────────────────────────────────────────────
  const buildStrand = (φ, isEcho) => {
    for (let s = 0; s < STEPS; s++) {
      const val = isEcho ? COMP_OF[ORBIT[s % M]] : ORBIT[s % M];
      const st  = STYLE[val];
      const rot = isEcho ? rotB : rotA;

      const geo = new THREE.SphereGeometry(0.14, 16, 10);
      const mat = new THREE.MeshPhongMaterial({
        color: st.c, emissive: st.c, emissiveIntensity: 0.38,
        transparent: true, opacity: isEcho ? 0.70 : 0.95, shininess: 70,
      });
      R.disposables.push(geo, mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(nodeX(s, φ, rot), baseY(s), nodeZ(s, φ, rot));
      mesh.userData = { val, s, φ, isEcho, cs: st.cs, bt: BT[val], baseEI: 0.38 };
      scene.add(mesh);
      allMeshes.push(mesh);

      // Leader line + label — XYZ updated every frame
      const lArr  = new Float32Array(6);
      const lGeo  = new THREE.BufferGeometry();
      const lAttr = new THREE.BufferAttribute(lArr, 3);
      lAttr.setUsage(THREE.DynamicDrawUsage);
      lGeo.setAttribute('position', lAttr);
      const lMat = new THREE.LineBasicMaterial({
        color: st.c, transparent: true, opacity: isEcho ? 0.28 : 0.42,
      });
      R.disposables.push(lGeo, lMat);
      scene.add(new THREE.Line(lGeo, lMat));
      leaderData.push({ attr: lAttr, arr: lArr, s, φ });

      const div = document.createElement('div');
      div.className = 'node-lbl';
      div.textContent = BT[val];
      div.style.cssText = `font-size:12px;color:${st.cs};`;
      const lbl = new CSS2DObject(div);
      scene.add(lbl);
      R.css2dObjects.push(lbl);
      allLabels.push({ lbl, val, bt: BT[val], cs: st.cs, s, φ });
    }
  };

  buildStrand(0,       false);
  buildStrand(Math.PI, true);
  // apply default showDecimal=true (labels build as BT text, flip to decimal)
  allLabels.forEach(l => { l.lbl.element.textContent = l.val; });

  // ── Strand backbone lines ────────────────────────────────────────────────
  const makeStrandLine = (φ, color) => {
    const arr  = new Float32Array(STEPS * 3);
    const geo  = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(arr, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 });
    R.disposables.push(geo, mat);
    scene.add(new THREE.Line(geo, mat));
    return { attr, arr, φ };
  };
  const strandLines = [
    makeStrandLine(0,       0xff2d78),
    makeStrandLine(Math.PI, 0x0080aa),
  ];

  // ── Rungs ────────────────────────────────────────────────────────────────
  for (let s = 0; s < STEPS; s++) {
    const arr  = new Float32Array(6);
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

  // ── Tornado envelope (static XZ, breathes in Y) ──────────────────────────
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
  const envMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0 });
  R.disposables.push(envGeo, envMat);
  scene.add(new THREE.Line(envGeo, envMat));

  // ── Driver helix (inverse) — grows downward from clock base (y=-2) ─────────
  // Colored amber to represent 13 / {2,4,7} as external driver (Wife's framing).
  const DRIV_C  = 0xC08800;
  const CLK_R   = 2.6;  // hoisted — also used in clock section below
  const CLK_GAP = 1.0;  // gap between clock face and each helix (main above, driver below)
  const CLK_Y   = -CLK_GAP; // clock base world Y
  const INV_Y0  = CLK_Y - CLK_GAP; // driver helix origin — same gap below clock as main helix above
  for (let s = 0; s < STEPS; s++) {
    const val = ORBIT[s % M];

    const geo = new THREE.SphereGeometry(0.11, 14, 9);
    const mat = new THREE.MeshPhongMaterial({
      color: DRIV_C, emissive: DRIV_C, emissiveIntensity: 0.28,
      transparent: true, opacity: 0.60, shininess: 80,
    });
    R.disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(nodeX(s, 0, rotA), INV_Y0 - baseY(s), nodeZ(s, 0, rotA));
    mesh.visible = false;
    mesh.userData = { s, baseEI: 0.28 };
    scene.add(mesh);
    invMeshes.push(mesh);

    const div = document.createElement('div');
    div.className = 'node-lbl';
    div.textContent = String(val);
    div.style.cssText = 'font-size:10px;color:#C08800;opacity:0.72;letter-spacing:.02em;';
    const lbl = new CSS2DObject(div);
    lbl.visible = false;
    scene.add(lbl);
    R.css2dObjects.push(lbl);
    invLabelData.push({ lbl, val, bt: BT[val], cs: '#C08800', s });

    // Spine line: main node above → through clock → driver node below
    const pArr  = new Float32Array(6);
    const pGeo  = new THREE.BufferGeometry();
    const pAttr = new THREE.BufferAttribute(pArr, 3);
    pAttr.setUsage(THREE.DynamicDrawUsage);
    pGeo.setAttribute('position', pAttr);
    const pMat  = new THREE.LineBasicMaterial({ color: DRIV_C, transparent: true, opacity: 0.18 });
    R.disposables.push(pGeo, pMat);
    const pLine = new THREE.Line(pGeo, pMat);
    pLine.visible = false;
    scene.add(pLine);
    invLineData.push({ attr: pAttr, arr: pArr, s, line: pLine });
  }

  // Driver backbone
  const invBBArr  = new Float32Array(STEPS * 3);
  const invBBGeo  = new THREE.BufferGeometry();
  const invBBAttr = new THREE.BufferAttribute(invBBArr, 3);
  invBBAttr.setUsage(THREE.DynamicDrawUsage);
  invBBGeo.setAttribute('position', invBBAttr);
  const invBBMat = new THREE.LineBasicMaterial({ color: DRIV_C, transparent: true, opacity: 0.28 });
  R.disposables.push(invBBGeo, invBBMat);
  const invBackbone = new THREE.Line(invBBGeo, invBBMat);
  invBackbone.visible = false;
  scene.add(invBackbone);

  // Anchor ring at step 20 (F₈ = count 21)
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

  // ── Meniscus — curved surface at clock level, dipping toward driver ─────────
  // Concave downward: center dips toward driver below, edges level with clock ring.
  const MEN_RINGS  = 28;
  const MEN_SEGS   = 64;
  const MEN_R_MAX  = CLK_R;
  const MEN_DIP    = 0.50; // max center dip in world units
  const menVerts   = 1 + MEN_RINGS * MEN_SEGS;
  const menPosArr  = new Float32Array(menVerts * 3);
  const menGeo     = new THREE.BufferGeometry();
  const menPosAttr = new THREE.BufferAttribute(menPosArr, 3);
  menPosAttr.setUsage(THREE.DynamicDrawUsage);
  menGeo.setAttribute('position', menPosAttr);
  const menIdx = [];
  for (let i = 0; i < MEN_SEGS; i++) menIdx.push(0, i + 1, (i + 1) % MEN_SEGS + 1);
  for (let ring = 0; ring < MEN_RINGS - 1; ring++) {
    const base = 1 + ring * MEN_SEGS, nxt = base + MEN_SEGS;
    for (let i = 0; i < MEN_SEGS; i++) {
      const i1 = (i + 1) % MEN_SEGS;
      menIdx.push(base + i, nxt + i, base + i1, base + i1, nxt + i, nxt + i1);
    }
  }
  menGeo.setIndex(menIdx);
  const menMat = new THREE.MeshBasicMaterial({
    color: 0xC08800, transparent: true, opacity: 0.13,
    side: THREE.DoubleSide, depthWrite: false,
  });
  R.disposables.push(menGeo, menMat);
  const menMesh = new THREE.Mesh(menGeo, menMat);
  menMesh.visible = false;
  scene.add(menMesh);

  const updateMeniscus = (dip) => {
    menPosArr[0] = 0; menPosArr[1] = CLK_Y - dip; menPosArr[2] = 0;
    for (let ring = 0; ring < MEN_RINGS; ring++) {
      const r = MEN_R_MAX * (ring + 1) / MEN_RINGS;
      const h = CLK_Y - dip * (1 - (r / MEN_R_MAX) ** 2);
      for (let seg = 0; seg < MEN_SEGS; seg++) {
        const θ = (seg / MEN_SEGS) * Math.PI * 2;
        const vi = (1 + ring * MEN_SEGS + seg) * 3;
        menPosArr[vi] = r * Math.cos(θ); menPosArr[vi + 1] = h; menPosArr[vi + 2] = r * Math.sin(θ);
      }
    }
    menPosAttr.needsUpdate = true;
  };
  updateMeniscus(MEN_DIP);

  // ── Conceptual shading membrane ───────────────────────────────────────────
  const shadePairs  = STEPS - 1;
  const shadePosArr = new Float32Array(shadePairs * 4 * 3);
  const shadeColArr = new Float32Array(shadePairs * 4 * 3);
  const shadeIdxArr = new Uint16Array(shadePairs * 6);
  for (let s = 0; s < shadePairs; s++) {
    const base = s * 4;
    const val  = ORBIT[s % M];
    const col  = new THREE.Color(STYLE[val].c);
    for (let k = 0; k < 4; k++) {
      const ss = k < 2 ? s : s + 1;
      const i  = (base + k) * 3;
      shadePosArr[i]     = nodeX(ss, 0, rotA);
      shadePosArr[i + 1] = baseY(ss);
      shadePosArr[i + 2] = nodeZ(ss, 0, rotA);
      shadeColArr[i] = col.r; shadeColArr[i + 1] = col.g; shadeColArr[i + 2] = col.b;
    }
    const bi = s * 6;
    shadeIdxArr[bi]   = base;     shadeIdxArr[bi+1] = base+1; shadeIdxArr[bi+2] = base+2;
    shadeIdxArr[bi+3] = base+1;   shadeIdxArr[bi+4] = base+3; shadeIdxArr[bi+5] = base+2;
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

  // ── 3D Tri-base Clock Face — base of the helix ───────────────────────────
  // Lies flat as a horizontal pedestal; helix grows up from its center.
  // Outer ring = decimal (12-hour), middle ring = binary, inner ring = ternary.
  const CLKG  = new THREE.Group(); // CLK_R hoisted above
  CLKG.position.set(0, CLK_Y, 0);
  CLKG.rotation.x = -Math.PI / 2; // tilt so ring faces upward like a base plate
  scene.add(CLKG);

  // Three concentric face rings
  { const g = new THREE.TorusGeometry(CLK_R,         0.045, 8, 72);
    const m = new THREE.MeshBasicMaterial({ color: 0x0a6a80, transparent: true, opacity: 0.9 });
    R.disposables.push(g, m); CLKG.add(new THREE.Mesh(g, m)); }
  { const g = new THREE.TorusGeometry(CLK_R * 0.68,  0.022, 8, 48);
    const m = new THREE.MeshBasicMaterial({ color: 0x0a3a60, transparent: true, opacity: 0.5 });
    R.disposables.push(g, m); CLKG.add(new THREE.Mesh(g, m)); }
  { const g = new THREE.TorusGeometry(CLK_R * 0.36,  0.020, 8, 32);
    const m = new THREE.MeshBasicMaterial({ color: 0x3a1060, transparent: true, opacity: 0.45 });
    R.disposables.push(g, m); CLKG.add(new THREE.Mesh(g, m)); }

  // 60 second tick marks on outer ring; major ticks at hour positions
  for (let i = 0; i < 60; i++) {
    const a    = Math.PI / 2 - i * (2 * Math.PI / 60);
    const isMaj = i % 5 === 0;
    const r0   = CLK_R * (isMaj ? 0.86 : 0.92);
    const r1   = CLK_R * 0.98;
    const tg   = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(r0 * Math.cos(a), r0 * Math.sin(a), 0),
      new THREE.Vector3(r1 * Math.cos(a), r1 * Math.sin(a), 0),
    ]);
    const tm   = new THREE.LineBasicMaterial({ color: isMaj ? 0x2a8aaa : 0x0a3050, transparent: true, opacity: isMaj ? 0.75 : 0.35 });
    R.disposables.push(tg, tm);
    CLKG.add(new THREE.Line(tg, tm));
  }

  // 12 hour markers — trit faces {5=−1, 6=0, 7=+1}, balanced on the 6
  // + balance group {2,4} (h=7 already hot as the +1 trit)
  const clkHotC = { 5: 0xFF6B35, 6: 0x5060FF, 7: 0x00E5FF };
  const clkHotS = { 5: '#FF6B35', 6: '#7080FF', 7: '#00E5FF' };
  const clkHotLabel = { 5: '5  −1', 6: '6   0', 7: '7  +1' };
  const balC = { 2: 0xC08800, 4: 0xC08800 }; // {2,4,7} sum=13; h=7 already hot
  for (let h = 1; h <= 12; h++) {
    const ang = Math.PI / 2 - (h % 12) * (Math.PI / 6);
    const hot = clkHotC[h] !== undefined;
    const bal = balC[h] !== undefined;
    const c   = hot ? clkHotC[h] : bal ? balC[h] : 0x0e3a4a;
    const sz  = hot ? 0.22 : bal ? 0.14 : 0.07;
    const geo = new THREE.SphereGeometry(sz, 16, 10);
    const mat = new THREE.MeshPhongMaterial({
      color: c, emissive: c, emissiveIntensity: hot ? 0.6 : bal ? 0.45 : 0.1,
      transparent: true, opacity: hot ? 0.95 : bal ? 0.85 : 0.5, shininess: 80,
    });
    R.disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(CLK_R * Math.cos(ang), CLK_R * Math.sin(ang), 0);
    CLKG.add(mesh);
    if (hot) {
      const div = document.createElement('div');
      div.className = 'node-lbl';
      div.style.cssText = `font-size:10px;font-weight:bold;color:${clkHotS[h]};letter-spacing:.04em;`;
      div.textContent = clkHotLabel[h];
      const lbl = new CSS2DObject(div);
      lbl.position.set((CLK_R + 0.62) * Math.cos(ang), (CLK_R + 0.62) * Math.sin(ang), 0);
      CLKG.add(lbl); R.css2dObjects.push(lbl);
    }
    if (bal) {
      const div = document.createElement('div');
      div.className = 'angle-lbl';
      div.style.cssText = 'font-size:9px;color:#C08800;opacity:.85;';
      div.textContent = String(h);
      const lbl = new CSS2DObject(div);
      lbl.position.set((CLK_R + 0.52) * Math.cos(ang), (CLK_R + 0.52) * Math.sin(ang), 0);
      CLKG.add(lbl); R.css2dObjects.push(lbl);
    }
  }

  // Center hub
  { const g = new THREE.SphereGeometry(0.18, 16, 12);
    const m = new THREE.MeshPhongMaterial({
      color: 0xFFD700, emissive: 0xFFD700, emissiveIntensity: 0.45,
      transparent: true, opacity: 0.9,
    });
    R.disposables.push(g, m); CLKG.add(new THREE.Mesh(g, m)); }

  // Hands (hour=gold, minute=cyan, second=orange) — endpoints updated each frame
  const mkHand = (color, len) => {
    const arr  = new Float32Array(6);
    const geo  = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(arr, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    R.disposables.push(geo, mat);
    const line = new THREE.Line(geo, mat);
    CLKG.add(line);
    return { attr, arr, len };
  };
  const handH = mkHand(0xFFD700, CLK_R * 0.52); // hour
  const handM = mkHand(0x00E5FF, CLK_R * 0.76); // minute
  const handS = mkHand(0xFF6B35, CLK_R * 0.90); // second

  // Orbit-index dot at the 6 inner positions (mod-9 orbit on inner ring)
  // Orbit: {1,2,4,5,7,8} — trit faces 5=−1, 6=0, 7=+1 at 12-clock hours 5,6,7
  const INNER_R = CLK_R * 0.36;
  const orbitInner = [1, 2, 4, 8, 7, 5]; // ×2 mod 9 cycle
  for (let i = 0; i < 6; i++) {
    const a   = Math.PI / 2 - i * (Math.PI / 3);
    const val = orbitInner[i];
    const col = val === 7 ? 0x5060FF : val === 5 ? 0xFF6B35 : val === 1 ? 0xFFD700 : 0x00E5FF;
    const geo = new THREE.SphereGeometry(0.10, 12, 8);
    const mat = new THREE.MeshPhongMaterial({ color: col, emissive: col, emissiveIntensity: 0.4, transparent: true, opacity: 0.75, shininess: 70 });
    R.disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(INNER_R * Math.cos(a), INNER_R * Math.sin(a), 0);
    CLKG.add(mesh);
  }

  // "13" — the driver; sum of balance group {2,4,7}; external to orbit, defines it
  { const d = document.createElement('div');
    d.className = 'angle-lbl';
    d.style.cssText = 'font-size:13px;color:#C08800;opacity:.92;letter-spacing:.08em;font-weight:bold;';
    d.textContent = '13';
    const l = new CSS2DObject(d);
    l.position.set(0, 0.45, 0);
    CLKG.add(l); R.css2dObjects.push(l); }

  // Arc from h=6 to h=7 on mid-ring — nil + palindrome = driver; label "6+7"
  { const a6 = Math.PI / 2 - 6 * Math.PI / 6;
    const a7 = Math.PI / 2 - 7 * Math.PI / 6;
    const R_ARC = CLK_R * 0.78;
    const arcPts = [];
    for (let i = 0; i <= 18; i++) {
      const ang = a6 + (i / 18) * (a7 - a6);
      arcPts.push(new THREE.Vector3(R_ARC * Math.cos(ang), R_ARC * Math.sin(ang), 0));
    }
    const arcG = new THREE.BufferGeometry().setFromPoints(arcPts);
    const arcM = new THREE.LineDashedMaterial({ color: 0xC08800, dashSize: .10, gapSize: .07, transparent: true, opacity: .55 });
    const arcL = new THREE.Line(arcG, arcM); arcL.computeLineDistances();
    R.disposables.push(arcG, arcM); CLKG.add(arcL);
    const aMid = a6 + 0.5 * (a7 - a6);
    const d = document.createElement('div');
    d.className = 'angle-lbl';
    d.style.cssText = 'font-size:8px;color:#C08800;opacity:.75;white-space:nowrap;';
    d.textContent = '6+7';
    const l = new CSS2DObject(d);
    l.position.set((R_ARC - .52) * Math.cos(aMid), (R_ARC - .52) * Math.sin(aMid), 0);
    CLKG.add(l); R.css2dObjects.push(l); }

  // ── HUD ──────────────────────────────────────────────────────────────────
  ov.innerHTML =
    `<div style="color:#4ac880;letter-spacing:.1em">08 · JENNIE 21</div>` +
    `<div style="color:#FFD700;font-size:8px;margin-top:2px">896 = 2<sup>7</sup>×7 · τ=16 · φ-step</div>` +
    `<div style="color:#4a9068;font-size:7.5px;margin-top:2px">1→2→4→8→7→5 (×2 mod 9)</div>` +
    `<div style="font-size:7.5px;margin-top:2px">` +
      `<span style="color:#00E5FF">2,4,7</span>&nbsp;` +
      `<span style="color:#FF6B35">5,8</span>&nbsp;` +
      `<span style="color:#FFD700">1</span></div>` +
    `<div style="color:#5a8a6a;font-size:7px;margin-top:2px">trits: 5=−1&nbsp;<b style="color:#aab8ff">6=0</b>&nbsp;7=+1</div>` +
    `<div style="color:#5a7a8a;font-size:7px;margin-top:1px">golden angle ≈137.5° · F₈=21 anchor</div>` +
    `<div style="color:#c060ff;font-size:7px;margin-top:1px">757=∞ · 1001001=3⁶+3³+3⁰ · prime</div>`;

  // ── Live tri-base clock — rendered in bottom-right clkDisplay ─────────────
  const clkEl = R.clkDisplay;
  const toBin = (n, w) => n.toString(2).padStart(w, '0');
  let lastClkSec = -1;

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

  let showMeniscus = false;

  const setInvVisible = v => {
    invMeshes.forEach(m => { m.visible = v; });
    invLabelData.forEach(({ lbl }) => { lbl.visible = v; });
    invLineData.forEach(({ line }) => { line.visible = v; });
    invBackbone.visible = v;
    anchorLine.visible  = v;
    if (v && showMeniscus) menMesh.visible = true;
    else if (!v) menMesh.visible = showMeniscus;
  };

  const setMeniscus = on => {
    showMeniscus = on;
    menMesh.visible = on;
    document.getElementById('p8men').classList.toggle('lit', on);
  };

  document.getElementById('p8inv').onclick = () => {
    showInversion = !showInversion;
    document.getElementById('p8inv').classList.toggle('lit', showInversion);
    setInvVisible(showInversion);
    if (!showInversion && showShading) {
      showShading = false;
      document.getElementById('p8shade').classList.remove('lit');
      shadeMesh.visible = false;
    }
  };

  document.getElementById('p8shade').onclick = () => {
    showShading = !showShading;
    document.getElementById('p8shade').classList.toggle('lit', showShading);
    if (showShading && !showInversion) {
      showInversion = true;
      document.getElementById('p8inv').classList.add('lit');
      setInvVisible(true);
    }
    shadeMesh.visible = showShading;
  };

  // ── Independent strand rotation controls ─────────────────────────────────
  // spinA/spinB: positive = CCW from above, negative = CW.
  const makeSpin = (key, strand, dir) => {
    const btnId = `p8${strand}_${dir}`;
    document.getElementById(btnId).onclick = () => {
      const speed = dir === 'cw' ? -SPIN_SPEED : SPIN_SPEED;
      if (strand === 'a') {
        spinA = (spinA === speed) ? 0 : speed;
        document.getElementById('p8a_cw').classList.toggle('lit', spinA < 0);
        document.getElementById('p8a_ccw').classList.toggle('lit', spinA > 0);
      } else {
        spinB = (spinB === speed) ? 0 : speed;
        document.getElementById('p8b_cw').classList.toggle('lit', spinB < 0);
        document.getElementById('p8b_ccw').classList.toggle('lit', spinB > 0);
      }
    };
  };
  makeSpin('a', 'a', 'cw');
  makeSpin('a', 'a', 'ccw');
  makeSpin('b', 'b', 'cw');
  makeSpin('b', 'b', 'ccw');

  // ── Slider controls ───────────────────────────────────────────────────────
  const wireSlider = (id, onVal) => {
    const el  = document.getElementById(id);
    const vEl = document.getElementById(id + '_v');
    el.oninput = () => { onVal(+el.value); vEl.textContent = (+el.value).toFixed(2); };
  };
  wireSlider('p8_rbase', v => { R_BASE = v; });
  wireSlider('p8_rgrow', v => { R_GROW = v; });
  wireSlider('p8_hstep', v => { H_STEP = v; });
  wireSlider('p8_bamp',  v => { breathAmp = v; });
  wireSlider('p8_bfreq', v => { breathFreq = v; });
  wireSlider('p8_spin',  v => {
    SPIN_SPEED = v;
    if (spinA !== 0) spinA = spinA < 0 ? -v : v;
    if (spinB !== 0) spinB = spinB < 0 ? -v : v;
  });

  let fibVariant = ''; // '' | 'ga' | 'rational' | 'sine' | 'orbit'
  const RATIONAL_A = (2 * Math.PI) / 7; // 7-fold symmetry — closes after 7 steps
  const FIB_IDS = { ga: 'p8v_fib', rational: 'p8v_fibr', sine: 'p8v_fibs', orbit: 'p8v_fibo' };
  const SPEC_COL = { ga: '#00ffcc', rational: '#ffd700', sine: '#cc88ff', orbit: '#ff9800' };

  // ── Message encoding (ORBIT mode) ────────────────────────────────────────
  let msgOrbit = null; // null = default orbit pattern; Float32Array = encoded message
  let msgChars = [];   // decoded characters for spectrograph labels

  const encodeMsg = raw => {
    if (!raw) { msgOrbit = null; msgChars = []; return; }
    const arr = new Float32Array(STEPS + 1);
    const chars = [];
    for (let i = 0; i <= STEPS; i++) {
      const ch = raw[i % raw.length];
      arr[i] = ORBIT[ch.charCodeAt(0) % M];
      if (i < STEPS) chars.push(ch);
    }
    msgOrbit = arr;
    msgChars = chars;
  };

  const setFibVariant = v => {
    fibVariant = v;
    envMat.opacity = v ? 0.72 : 0;
    Object.values(FIB_IDS).forEach(id => document.getElementById(id).classList.remove('lit'));
    if (v) document.getElementById(FIB_IDS[v]).classList.add('lit');
  };

  // ── Orbit class → candidate letters ─────────────────────────────────────
  // For each orbit index (0-5) list lowercase letters where charCode % 6 === index
  const ORBIT_CANDS = (() => {
    const map = Array.from({ length: M }, () => []);
    for (let c = 97; c <= 122; c++) map[c % M].push(String.fromCharCode(c));
    return map; // index matches ORBIT array position
  })();

  const decodePanel = document.getElementById('decode-panel');

  const updateDecoder = () => {
    if (!decodePanel) return;
    let html = '';
    for (let s = 0; s < STEPS; s++) {
      const idx = Math.round(s * (N_ENV - 1) / (STEPS - 1));
      const wx = envArr[idx * 3], wz = envArr[idx * 3 + 2];
      const r = Math.sqrt(wx * wx + wz * wz);
      // find closest orbit value
      const ov = ORBIT.reduce((best, v) => {
        return Math.abs(R_BASE + v * 0.11 - r) < Math.abs(R_BASE + best * 0.11 - r) ? v : best;
      }, ORBIT[0]);
      const orbitIdx = ORBIT.indexOf(ov);
      const cands = ORBIT_CANDS[orbitIdx];
      const known = msgChars[s] ? msgChars[s].toLowerCase() : null;
      const candsHtml = cands.map(ch =>
        ch === known ? `<span class="hit">${ch}</span>` : `<span class="cands">${ch}</span>`
      ).join('');
      html += `<div class="dr"><div class="ov">${ov}</div><div>${candsHtml}</div></div>`;
    }
    decodePanel.innerHTML = html;
  };

  // ── Spectrograph canvas ──────────────────────────────────────────────────
  let showSpec = false;
  const specPanel  = document.getElementById('spec-panel');
  const specCanvas = document.getElementById('p8spec');
  const specCtx    = specCanvas ? specCanvas.getContext('2d') : null;
  const Y_WORLD_MAX = baseY(STEPS - 1) * 1.15;
  const X_WORLD_MAX = 3.6;

  let decoderSpeed = 0.5; // rev/sec (loops automatically in animation loop)

  const drawSpec = (t) => {
    if (!specCtx) return;
    const W = specCanvas.width, H = specCanvas.height;
    specCtx.clearRect(0, 0, W, H);
    // landscape: X = node index (0=left, STEPS-1=right), Y = amplitude
    const xAt  = s   => 6 + (s / (STEPS - 1)) * (W - 12);
    const yAmp = amp => H / 2 - (amp / X_WORLD_MAX) * (H / 2 - 6);
    // project (X, Z) onto decoder viewing angle — auto-loops at decoderSpeed rev/sec
    const decoderRot = t * decoderSpeed * Math.PI * 2;
    const projX = i => envArr[i * 3] * Math.cos(decoderRot) + envArr[i * 3 + 2] * Math.sin(decoderRot);
    // center baseline
    specCtx.strokeStyle = 'rgba(0,255,200,0.10)';
    specCtx.lineWidth = 0.75;
    specCtx.beginPath(); specCtx.moveTo(0, H / 2); specCtx.lineTo(W, H / 2); specCtx.stroke();
    // node tick marks + char labels at integer steps
    specCtx.strokeStyle = 'rgba(0,255,200,0.22)';
    specCtx.fillStyle = 'rgba(0,255,200,0.90)';
    specCtx.font = 'bold 8px monospace';
    specCtx.textAlign = 'center';
    for (let s = 0; s < STEPS; s++) {
      const x = xAt(s);
      specCtx.beginPath(); specCtx.moveTo(x, H / 2 - 4); specCtx.lineTo(x, H / 2 + 4); specCtx.stroke();
      if (msgChars[s]) specCtx.fillText(msgChars[s], x, H - 3);
    }
    specCtx.textAlign = 'left';
    // waveform
    const col = SPEC_COL[fibVariant] || '#00ffcc';
    specCtx.strokeStyle = col;
    specCtx.lineWidth = 2;
    specCtx.beginPath();
    for (let i = 0; i < N_ENV; i++) {
      const s  = (i / (N_ENV - 1)) * (STEPS - 1);
      const cx = xAt(s);
      const cy = yAmp(projX(i));
      i === 0 ? specCtx.moveTo(cx, cy) : specCtx.lineTo(cx, cy);
    }
    specCtx.stroke();
  };

  const PRESETS = {
    side:   { pos: [20,  5, 10],  tgt: [0, 7, 0] },
    top:    { pos: [ 0, 22,  0],  tgt: [0, 7, 0] },
    bottom: { pos: [ 0, -8,  0],  tgt: [0, 7, 0] },
  };
  const applyPreset = key => {
    const { pos, tgt } = PRESETS[key];
    camera.position.set(...pos);
    camera.lookAt(...tgt);
    controls.target.set(...tgt);
    controls.update();
  };
  ['side', 'top', 'bottom'].forEach(k => {
    document.getElementById(`p8v_${k}`).onclick = () => applyPreset(k);
  });
  // Always-visible recenter: restores the default view with the orbit target back
  // on the helix axis (0,7,0). Needed because shared links / panning can leave the
  // pivot off-axis, which makes the helix swing around instead of spinning in place.
  document.getElementById('p8center').onclick = () => applyPreset('side');
  Object.entries(FIB_IDS).forEach(([v, id]) => {
    document.getElementById(id).onclick = () => setFibVariant(fibVariant === v ? '' : v);
  });
  document.getElementById('p8men').onclick = () => setMeniscus(!showMeniscus);
  document.getElementById('p8msg').addEventListener('input', e => encodeMsg(e.target.value));
  document.getElementById('p8dec_rot').addEventListener('input', e => {
    decoderSpeed = parseFloat(e.target.value);
    document.getElementById('p8dec_hz_val').textContent = decoderSpeed.toFixed(1);
  });
  document.getElementById('p8spec_btn').onclick = () => {
    showSpec = !showSpec;
    document.getElementById('p8spec_btn').classList.toggle('lit', showSpec);
    specPanel.classList.toggle('vis', showSpec);
  };

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
      if (val === 7) h += `<p class="tr" style="color:#5060FF">+1 trit · orbit step 4</p>`;
      if (val === 1) h += `<p class="tr" style="color:#FFD700">identity — orbit generator</p>`;
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
  let lastAnimT = null;

  R.animFn = () => {
    const now = Date.now() * 0.001;
    const dt  = lastAnimT !== null ? Math.min(now - lastAnimT, 0.05) : 0;
    lastAnimT = now;
    const t   = now;

    rotA += spinA * dt;
    rotB += spinB * dt;

    const breath    = 1 + breathAmp * Math.sin(t * breathFreq);
    const breathInv = 1 - breathAmp * Math.sin(t * breathFreq);

    // ── Primary strand geometry (XYZ all dynamic) ──────────────────────────
    allMeshes.forEach((m, i) => {
      const { s, φ, isEcho } = m.userData;
      const rot = isEcho ? rotB : rotA;
      m.position.x = nodeX(s, φ, rot);
      m.position.y = baseY(s) * breath;
      m.position.z = nodeZ(s, φ, rot);
      if (i !== lastHl) {
        m.material.emissiveIntensity = m.userData.baseEI
          + 0.1 * Math.abs(Math.sin(t * 1.1 + s * 0.42));
      }
    });

    leaderData.forEach(({ attr, arr, s, φ }) => {
      const rot      = (φ === 0) ? rotA : rotB;
      const nx = nodeX(s, φ, rot), nz = nodeZ(s, φ, rot);
      const y  = baseY(s) * breath;
      const { lx, lz } = labelEnd(s, φ, rot, LEADER);
      arr[0] = nx; arr[1] = y;  arr[2] = nz;
      arr[3] = lx; arr[4] = y;  arr[5] = lz;
      attr.needsUpdate = true;
    });

    allLabels.forEach(l => {
      const rot = (l.φ === 0) ? rotA : rotB;
      const { lx, lz } = labelEnd(l.s, l.φ, rot, LEADER);
      l.lbl.position.set(lx, baseY(l.s) * breath + 0.12, lz);
    });

    strandLines.forEach(({ attr, arr, φ }) => {
      const rot = (φ === 0) ? rotA : rotB;
      for (let s = 0; s < STEPS; s++) {
        arr[s * 3]     = nodeX(s, φ, rot);
        arr[s * 3 + 1] = baseY(s) * breath;
        arr[s * 3 + 2] = nodeZ(s, φ, rot);
      }
      attr.needsUpdate = true;
    });

    rungData.forEach(({ attr, arr, mat, s }) => {
      const y = baseY(s) * breath;
      arr[0] = nodeX(s, 0,       rotA); arr[1] = y; arr[2] = nodeZ(s, 0,       rotA);
      arr[3] = nodeX(s, Math.PI, rotB); arr[4] = y; arr[5] = nodeZ(s, Math.PI, rotB);
      attr.needsUpdate = true;
      mat.opacity = 0.10 + 0.10 * Math.abs(Math.sin(t * 0.75 - s * 0.28));
    });

    nilRingData.forEach(({ attr, arr, s, N }) => {
      const r = helixR(s);
      const y = baseY(s) * breath;
      for (let i = 0; i < N; i++) {
        const θ = (i / (N - 1)) * Math.PI * 2;
        arr[i * 3]     = r * Math.cos(θ);
        arr[i * 3 + 1] = y;
        arr[i * 3 + 2] = r * Math.sin(θ);
      }
      attr.needsUpdate = true;
    });

    for (let i = 0; i < N_ENV; i++) {
      const s = (i / (N_ENV - 1)) * (STEPS - 1);
      let angle = s * GA + rotA;
      let radius = helixR(s);
      if (fibVariant === 'rational') {
        angle = s * RATIONAL_A + rotA;
      } else if (fibVariant === 'sine') {
        radius = helixR(s) + 0.38 * Math.sin(s * Math.PI / 3);
      } else if (fibVariant === 'orbit') {
        const si = Math.floor(s);
        const sf = s - si;
        const src = msgOrbit || ORBIT;
        const v0 = msgOrbit ? msgOrbit[si] : ORBIT[si % M];
        const v1 = msgOrbit ? msgOrbit[si + 1] : ORBIT[(si + 1) % M];
        radius = R_BASE + (v0 + (v1 - v0) * sf) * 0.11;
      }
      envArr[i * 3]     = radius * Math.cos(angle);
      envArr[i * 3 + 1] = baseY(s) * breath;
      envArr[i * 3 + 2] = radius * Math.sin(angle);
    }
    envAttr.needsUpdate = true;
    if (showSpec) { drawSpec(t); if (fibVariant === 'orbit') updateDecoder(); }

    // ── Driver helix updates (inverse, below clock) ───────────────────────
    if (showInversion) {
      invMeshes.forEach(m => {
        const s = m.userData.s;
        m.position.x = nodeX(s, 0, rotA);
        m.position.y = INV_Y0 - baseY(s) * breathInv;
        m.position.z = nodeZ(s, 0, rotA);
        m.material.emissiveIntensity = m.userData.baseEI
          + 0.12 * Math.abs(Math.sin(t * 1.1 + s * 0.42 + Math.PI));
      });

      invLabelData.forEach(l => {
        const { lx, lz } = labelEnd(l.s, 0, rotA, LEADER_INV);
        l.lbl.position.set(lx, INV_Y0 - baseY(l.s) * breathInv - 0.10, lz);
        l.lbl.element.textContent = showDecimal ? l.val : l.bt;
      });

      invLineData.forEach(({ attr, arr, s }) => {
        const x = nodeX(s, 0, rotA), z = nodeZ(s, 0, rotA);
        arr[0] = x; arr[1] = baseY(s) * breath;           arr[2] = z; // main (above)
        arr[3] = x; arr[4] = INV_Y0 - baseY(s) * breathInv; arr[5] = z; // driver (below)
        attr.needsUpdate = true;
      });

      for (let s = 0; s < STEPS; s++) {
        invBBArr[s * 3]     = nodeX(s, 0, rotA);
        invBBArr[s * 3 + 1] = INV_Y0 - baseY(s) * breathInv;
        invBBArr[s * 3 + 2] = nodeZ(s, 0, rotA);
      }
      invBBAttr.needsUpdate = true;

      const ancRcur = helixR(ANCHOR_S) + 0.55;
      const ancY    = CLK_Y; // gold ring sits at clock level — the dividing boundary
      for (let i = 0; i <= ancN; i++) {
        const θ = (i / ancN) * Math.PI * 2;
        ancArr[i * 3]     = ancRcur * Math.cos(θ);
        ancArr[i * 3 + 1] = ancY;
        ancArr[i * 3 + 2] = ancRcur * Math.sin(θ);
      }
      ancAttr.needsUpdate = true;
      ancMat.opacity = 0.45 + 0.25 * Math.abs(Math.sin(t * 0.5 + Math.PI));

      // Meniscus dips deeper as driver breathes out (breathInv at max)
      updateMeniscus(MEN_DIP * breathInv);
    }

    // ── Shading membrane ──────────────────────────────────────────────────
    if (showShading) {
      for (let s = 0; s < shadePairs; s++) {
        const base = s * 4;
        for (let k = 0; k < 4; k++) {
          const ss  = k < 2 ? s : s + 1;
          const ph  = k % 2 === 0 ? breath : breathInv;
          const idx = (base + k) * 3;
          shadePosArr[idx]     = nodeX(ss, 0, rotA);
          shadePosArr[idx + 1] = baseY(ss) * ph;
          shadePosArr[idx + 2] = nodeZ(ss, 0, rotA);
        }
      }
      shadePosAttr.needsUpdate = true;
      const gap = Math.abs(breath - breathInv);
      shadeMat.opacity = 0.07 + 0.12 * (gap / 0.20);
    }

    // ── 3D clock: smooth hand sweep (every frame) ────────────────────────
    { const nd  = new Date();
      const chh = nd.getHours(), cmm = nd.getMinutes(), css2 = nd.getSeconds();
      const cms = nd.getMilliseconds();
      const sF  = css2 + cms / 1000;
      const mF  = cmm + sF / 60;
      const hF  = (chh % 12 || 12) + mF / 60;
      const aH  = Math.PI / 2 - (hF / 12) * Math.PI * 2;
      const aM  = Math.PI / 2 - (mF / 60) * Math.PI * 2;
      const aS  = Math.PI / 2 - (sF  / 60) * Math.PI * 2;
      const setHand = (h, ang) => {
        h.arr[3] = h.len * Math.cos(ang);
        h.arr[4] = h.len * Math.sin(ang);
        h.attr.needsUpdate = true;
      };
      setHand(handH, aH); setHand(handM, aM); setHand(handS, aS); }
    CLKG.rotation.z = -rotA * 0.5; // co-rotate with strand A (turntable spin on base)

    // ── Tri-base clock HUD + dot updates (on second boundary) ─────────────
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec !== lastClkSec) {
      lastClkSec = nowSec;
      const nd  = new Date();
      const hh  = nd.getHours(), mm = nd.getMinutes(), ss = nd.getSeconds();
      const h12 = hh % 12 || 12;
      const deg = ((h12 + mm / 60 + ss / 3600) * 30).toFixed(1);
      clkEl.innerHTML =
        `<div style="color:#4a9068">` +
          `⊙ ${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}` +
          ` &nbsp;<span style="color:#3a6a50">${deg}°</span></div>` +
        `<div style="color:#2a6080">` +
          `₂ ${toBin(hh,5)}·${toBin(mm,6)}·${toBin(ss,6)}</div>` +
        `<div>` +
          `₃ <span style="color:#FF6B35">${toBT(hh)}</span>` +
          `·<span style="color:#00E5FF">${toBT(mm)}</span>` +
          `·<span style="color:#FFD700">${toBT(ss)}</span></div>`;
    }

    R.labelRenderer.render(scene, camera);
  };
}
