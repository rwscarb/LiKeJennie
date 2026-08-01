/**
 * JENNIE φ — Scene 08
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

  let R_BASE = 3.00;
  let R_GROW = 0.08;  // conical flare: r(s) = 3.00 + 0.08·s → radius expands from 3.0→4.6
  let H_STEP = 0.68;
  let breathAmp  = 0.10;
  let breathFreq = 0.50;
  const LEADER     = 0.88;
  const LEADER_INV = 0.36; // inversion labels sit inset toward axis

  // Harmonic radial wave: r(s,t) = base + flare + waveAmp·sin(2π·waveK·s/STEPS + waveOmega·t)
  let showWave  = false;
  let waveAmp   = 0.40;   // radial oscillation depth
  let waveK     = 2.0;    // full wave cycles across the helix (2 = two standing waves)
  let waveOmega = 0.85;   // temporal frequency rad/s
  let waveT     = 0;      // updated each frame

  const helixR = s => R_BASE + s * R_GROW
    + (showWave ? waveAmp * Math.sin(waveK * s * (2 * Math.PI / STEPS) + waveT) : 0);
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

  // Greek ordinal: value → letter at that position in the Greek alphabet
  const GREEK = { 1:'α', 2:'β', 4:'δ', 5:'ε', 7:'η', 8:'θ' };

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

  let showShading   = false;
  let showDecimal   = true;
  let showGreek     = false;
  let showOliver    = false;


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

  const CLK_R   = 2.6;  // hoisted — also used in clock section below
  const CLK_GAP = 1.0;
  const CLK_Y   = -CLK_GAP; // clock base world Y

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
  anchorLine.visible = true;
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

  // ── OLIVER 42 overlay — {3,6,9} complement as violin resonant body ───────────
  // Vertical figure-8: upper chamber (node 3, violet) arches UP from the bridge;
  // lower chamber (node 6, rose) descends DOWN. Bridge = absent 9. Strings pass through.
  // Geometry from Wife's drawing: two trapezoidal chambers meeting at a heavy horizontal ring.
  const OLV_A    = 2.2;   // lemniscate horizontal scale (inner loop spread)
  const OLV_DOME = 3.0;   // height of each chamber above/below CLK_Y
  const OLV_Y    = CLK_Y;
  const OLV_C3   = 0x9933ff;
  const OLV_C6   = 0xff33bb;
  const OLV_CS3  = '#bb55ff';
  const OLV_CS6  = '#ff55cc';

  // Vertical Bernoulli lemniscate (90°-rotated):
  //   t=0   → (0, OLV_Y+OLV_DOME, 0)  — top apex = node 3
  //   t=π   → (0, OLV_Y-OLV_DOME, 0)  — bottom apex = node 6
  //   t=π/2 → (0, OLV_Y, 0)           — bridge crossing (void/9)
  function olvPt(t) {
    const s = Math.sin(t), c = Math.cos(t), d = 1 + s * s;
    return new THREE.Vector3(
      -(OLV_A * s * c / d),      // horizontal spread inside chamber
      OLV_Y + OLV_DOME * c / d,  // vertical: up at t=0 (node 3), down at t=π (node 6)
      0,
    );
  }

  // Möbius lemniscate — full 2π path with a half-twist baked in.
  // The cross-section rotates 180° over one traversal: inside of the upper chamber
  // connects to the outside of the lower chamber — no boundary, just the void at 9.
  const OLV_SEGS = 256;
  const OLV_RSEG = 8;
  let olvMobius;
  {
    const nV  = (OLV_SEGS + 1) * (OLV_RSEG + 1);
    const pos = new Float32Array(nV * 3);
    const col = new Float32Array(nV * 3);
    const idx = [];
    const c3  = new THREE.Color(OLV_C3), c6 = new THREE.Color(OLV_C6), tc = new THREE.Color();
    let vi = 0;
    for (let i = 0; i <= OLV_SEGS; i++) {
      const t   = (i / OLV_SEGS) * Math.PI * 2;
      const pt  = olvPt(t);
      const pt1 = olvPt(t + Math.PI * 2 / OLV_SEGS);
      const tang = new THREE.Vector3().subVectors(pt1, pt);
      if (tang.lengthSq() < 1e-10) tang.set(0, 0.001, 0);
      tang.normalize();
      let up = new THREE.Vector3(0, 1, 0);
      if (Math.abs(tang.dot(up)) > 0.98) up.set(1, 0, 0);
      const right = new THREE.Vector3().crossVectors(tang, up).normalize();
      const nrm   = new THREE.Vector3().crossVectors(right, tang).normalize();
      // Möbius half-twist: cross-section rotates π over the full 2π path
      const cosT = Math.cos(t * 0.5), sinT = Math.sin(t * 0.5);
      // vertex color: violet at node 3 (t=0), rose at node 6 (t=π), back to violet
      tc.copy(c3).lerp(c6, 0.5 - 0.5 * Math.cos(t));
      for (let j = 0; j <= OLV_RSEG; j++) {
        const phi  = (j / OLV_RSEG) * Math.PI * 2;
        const cosP = Math.cos(phi), sinP = Math.sin(phi);
        const ru   = cosP * cosT - sinP * sinT;
        const rv   = cosP * sinT + sinP * cosT;
        pos[vi*3]   = pt.x + 0.052 * (ru * nrm.x + rv * right.x);
        pos[vi*3+1] = pt.y + 0.052 * (ru * nrm.y + rv * right.y);
        pos[vi*3+2] = pt.z + 0.052 * (ru * nrm.z + rv * right.z);
        col[vi*3] = tc.r; col[vi*3+1] = tc.g; col[vi*3+2] = tc.b;
        vi++;
      }
    }
    for (let i = 0; i < OLV_SEGS; i++) {
      for (let j = 0; j < OLV_RSEG; j++) {
        const a = i * (OLV_RSEG+1) + j, b = a + (OLV_RSEG+1);
        idx.push(a, b, a+1, b, b+1, a+1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshPhongMaterial({
      vertexColors: true, emissive: new THREE.Color(0x220033), emissiveIntensity: 0.28,
      transparent: true, opacity: 0.78, shininess: 60, side: THREE.DoubleSide,
    });
    R.disposables.push(geo, mat);
    olvMobius = new THREE.Mesh(geo, mat);
    olvMobius.visible = false;
    scene.add(olvMobius);
  }

  // Outer resonant chamber walls — truncated cones (frustums) meeting at the bridge.
  // Upper: wide at top, narrow at bridge. Lower: narrow at bridge, wide at bottom.
  const makeChamber = (color, yCenter, wideAtTop) => {
    const rNarrow = OLV_A * 0.18;
    const rWide   = OLV_A * 0.95;
    const geo = new THREE.CylinderGeometry(
      wideAtTop ? rWide : rNarrow,
      wideAtTop ? rNarrow : rWide,
      OLV_DOME, 32, 1, true,
    );
    const mat = new THREE.MeshPhongMaterial({
      color, emissive: color, emissiveIntensity: 0.10,
      transparent: true, opacity: 0.11,
      side: THREE.DoubleSide, depthWrite: false,
    });
    R.disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, yCenter, 0);
    m.visible = false;
    scene.add(m);
    return m;
  };

  const olvChamber3 = makeChamber(OLV_C3, OLV_Y + OLV_DOME / 2, true);  // upper: wide at top
  const olvChamber6 = makeChamber(OLV_C6, OLV_Y - OLV_DOME / 2, false); // lower: wide at bottom

  // Apex nodes
  const makeOlvNode = (pos, color) => {
    const geo = new THREE.SphereGeometry(0.22, 20, 14);
    const mat = new THREE.MeshPhongMaterial({
      color, emissive: color, emissiveIntensity: 0.55,
      transparent: true, opacity: 0.90,
    });
    R.disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    m.userData = { baseEI: 0.55 };
    m.visible = false;
    scene.add(m);
    return m;
  };

  const olvNode3Pos = olvPt(0);        // (0, OLV_Y+OLV_DOME, 0) — top
  const olvNode6Pos = olvPt(Math.PI);  // (0, OLV_Y-OLV_DOME, 0) — bottom
  const olvNode3    = makeOlvNode(olvNode3Pos, OLV_C3);
  Object.assign(olvNode3.userData, { olvType: 'apex', olvVal: 3 });
  const olvNode6    = makeOlvNode(olvNode6Pos, OLV_C6);
  Object.assign(olvNode6.userData, { olvType: 'apex', olvVal: 6 });

  // Bridge — prominent horizontal ring at CLK_Y (the absent 9, void at the waist)
  const olvBridgeGeo = new THREE.TorusGeometry(OLV_A * 0.62, 0.085, 8, 48);
  const olvBridgeMat = new THREE.MeshPhongMaterial({
    color: 0x330044, emissive: 0x220033, emissiveIntensity: 0.40,
    transparent: true, opacity: 0.65,
  });
  R.disposables.push(olvBridgeGeo, olvBridgeMat);
  const olvBridge = new THREE.Mesh(olvBridgeGeo, olvBridgeMat);
  olvBridge.rotation.x = Math.PI / 2;
  olvBridge.position.y = OLV_Y;
  olvBridge.visible = false;
  scene.add(olvBridge);

  // Labels
  const makeOlvLbl = (text, pos, color, size = '13px') => {
    const div = document.createElement('div');
    div.className = 'node-lbl';
    div.textContent = text;
    div.style.cssText = `font-size:${size};color:${color};`;
    const o = new CSS2DObject(div);
    o.position.copy(pos);
    o.visible = false;
    scene.add(o);
    R.css2dObjects.push(o);
    return o;
  };

  const olvLbl3    = makeOlvLbl('3', olvNode3Pos.clone().add(new THREE.Vector3(0.55,  0.30, 0)), OLV_CS3, '16px');
  const olvLbl6    = makeOlvLbl('6', olvNode6Pos.clone().add(new THREE.Vector3(0.55, -0.30, 0)), OLV_CS6, '16px');
  const olvLblVoid = makeOlvLbl('—', new THREE.Vector3(0.55, OLV_Y, 0), '#2a0033', '18px');

  // Strings — vertical wires through the bridge (the void crossing)
  const makeOlvString = (xOff) => {
    const pts = [
      new THREE.Vector3(xOff, OLV_Y - OLV_DOME * 1.05, 0),
      new THREE.Vector3(xOff, OLV_Y + OLV_DOME * 1.05, 0),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.11 });
    R.disposables.push(geo, mat);
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    scene.add(line);
    return line;
  };
  const olvStr1 = makeOlvString(-OLV_A * 0.28);
  const olvStr2 = makeOlvString(0);
  const olvStr3 = makeOlvString( OLV_A * 0.28);

  // Pulsing traveler
  const olvTravGeo = new THREE.SphereGeometry(0.16, 14, 10);
  const olvTravMat = new THREE.MeshPhongMaterial({
    color: OLV_C3, emissive: OLV_C3, emissiveIntensity: 1.0,
    transparent: true, opacity: 0.95,
  });
  R.disposables.push(olvTravGeo, olvTravMat);
  const olvTrav = new THREE.Mesh(olvTravGeo, olvTravMat);
  olvTrav.visible = false;
  scene.add(olvTrav);

  // Tail
  const OLV_TAIL   = 16;
  const olvTailArr  = new Float32Array((OLV_TAIL + 1) * 3);
  const olvTailGeo  = new THREE.BufferGeometry();
  const olvTailAttr = new THREE.BufferAttribute(olvTailArr, 3);
  olvTailAttr.setUsage(THREE.DynamicDrawUsage);
  olvTailGeo.setAttribute('position', olvTailAttr);
  const olvTailMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.20 });
  R.disposables.push(olvTailGeo, olvTailMat);
  const olvTailLine = new THREE.Line(olvTailGeo, olvTailMat);
  olvTailLine.visible = false;
  scene.add(olvTailLine);
  const olvTailHistory = [];

  const OLV_LOOP_T = 5.5; // seconds per full lemniscate cycle
  let olvStartT    = null;

  // ── Complement helix — {3,6} going DOWN from bridge (CLK_Y) ──────────────
  // orbit[s] × 3 mod 9 → 3 or 6, giving the complement 2-cycle at the same
  // angular positions as Strand A. The bridge ring is where they hand off.
  const compY      = s => CLK_Y - s * H_STEP;
  const COMP_SEQ   = [3, 6]; // orbit × 3 mod 9 = [3,6,3,6,…]
  const compMeshes = [];
  const compLbls   = [];

  // Backbone spine
  const compBBArr  = new Float32Array(STEPS * 3);
  const compBBGeo  = new THREE.BufferGeometry();
  const compBBAttr = new THREE.BufferAttribute(compBBArr, 3);
  compBBAttr.setUsage(THREE.DynamicDrawUsage);
  compBBGeo.setAttribute('position', compBBAttr);
  const compBBMat  = new THREE.LineBasicMaterial({ color: 0xcc44ff, transparent: true, opacity: 0.32 });
  R.disposables.push(compBBGeo, compBBMat);
  const compBackbone = new THREE.Line(compBBGeo, compBBMat);
  compBackbone.visible = false;
  scene.add(compBackbone);

  // ×3 connection rungs: each orbit node → complement node (shows ×3 gate)
  const compRungArr  = new Float32Array(STEPS * 6);
  const compRungGeo  = new THREE.BufferGeometry();
  const compRungAttr = new THREE.BufferAttribute(compRungArr, 3);
  compRungAttr.setUsage(THREE.DynamicDrawUsage);
  compRungGeo.setAttribute('position', compRungAttr);
  const compRungMat  = new THREE.LineBasicMaterial({ color: 0x6622aa, transparent: true, opacity: 0.20 });
  R.disposables.push(compRungGeo, compRungMat);
  const compRungs = new THREE.LineSegments(compRungGeo, compRungMat);
  compRungs.visible = false;
  scene.add(compRungs);

  for (let s = 0; s < STEPS; s++) {
    const val = COMP_SEQ[s % 2];
    const col = val === 3 ? OLV_C3 : OLV_C6;
    const cs  = val === 3 ? OLV_CS3 : OLV_CS6;

    const geo = new THREE.SphereGeometry(0.12, 14, 9);
    const mat = new THREE.MeshPhongMaterial({
      color: col, emissive: col, emissiveIntensity: 0.35,
      transparent: true, opacity: 0.78, shininess: 70,
    });
    R.disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(nodeX(s, 0, rotA), compY(s), nodeZ(s, 0, rotA));
    mesh.userData = { baseEI: 0.35, olvType: 'comp', olvVal: val, olvS: s };
    mesh.visible = false;
    scene.add(mesh);
    compMeshes.push(mesh);

    const div = document.createElement('div');
    div.className = 'node-lbl';
    div.textContent = String(val);
    div.style.cssText = `font-size:10px;color:${cs};opacity:0.80;`;
    const lbl = new CSS2DObject(div);
    lbl.visible = false;
    scene.add(lbl);
    R.css2dObjects.push(lbl);
    compLbls.push(lbl);
  }

  // Complement helix Strand B — second {6,3} strand at φ=π (phase-shifted by half revolution).
  // Mirrors the double-helix structure of jennie21: the two complement strands interweave.
  const compMeshesB = [];
  const compLblsB   = [];

  const compBBBArr  = new Float32Array(STEPS * 3);
  const compBBBGeo  = new THREE.BufferGeometry();
  const compBBBAttr = new THREE.BufferAttribute(compBBBArr, 3);
  compBBBAttr.setUsage(THREE.DynamicDrawUsage);
  compBBBGeo.setAttribute('position', compBBBAttr);
  const compBBBMat  = new THREE.LineBasicMaterial({ color: 0xff44cc, transparent: true, opacity: 0.28 });
  R.disposables.push(compBBBGeo, compBBBMat);
  const compBackboneB = new THREE.Line(compBBBGeo, compBBBMat);
  compBackboneB.visible = false;
  scene.add(compBackboneB);

  // Rungs connecting Strand A ↔ Strand B of complement (internal double-helix rungs)
  const compRungsABArr  = new Float32Array(STEPS * 6);
  const compRungsABGeo  = new THREE.BufferGeometry();
  const compRungsABAttr = new THREE.BufferAttribute(compRungsABArr, 3);
  compRungsABAttr.setUsage(THREE.DynamicDrawUsage);
  compRungsABGeo.setAttribute('position', compRungsABAttr);
  const compRungsABMat  = new THREE.LineBasicMaterial({ color: 0x882299, transparent: true, opacity: 0.20 });
  R.disposables.push(compRungsABGeo, compRungsABMat);
  const compRungsAB = new THREE.LineSegments(compRungsABGeo, compRungsABMat);
  compRungsAB.visible = false;
  scene.add(compRungsAB);

  for (let s = 0; s < STEPS; s++) {
    const val = COMP_SEQ[(s + 1) % 2]; // phase-shifted: starts on 6
    const col = val === 3 ? OLV_C3 : OLV_C6;
    const cs  = val === 3 ? OLV_CS3 : OLV_CS6;
    const geo = new THREE.SphereGeometry(0.10, 14, 9);
    const mat = new THREE.MeshPhongMaterial({
      color: col, emissive: col, emissiveIntensity: 0.28,
      transparent: true, opacity: 0.62, shininess: 70,
    });
    R.disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(nodeX(s, Math.PI, rotA), compY(s), nodeZ(s, Math.PI, rotA));
    mesh.userData = { baseEI: 0.28, olvType: 'compB', olvVal: val, olvS: s };
    mesh.visible = false;
    scene.add(mesh);
    compMeshesB.push(mesh);

    const div = document.createElement('div');
    div.className = 'node-lbl';
    div.textContent = String(val);
    div.style.cssText = `font-size:10px;color:${cs};opacity:0.60;`;
    const lbl = new CSS2DObject(div);
    lbl.visible = false;
    scene.add(lbl);
    R.css2dObjects.push(lbl);
    compLblsB.push(lbl);
  }

  // 640 axis — central vertical spine running through the full structure.
  // 640 (dr=1) is the anti-matter ground: 640×3→dr=3, 896×3→dr=6; ×3/2 is the bridge ratio.
  const olv640TopY = baseY(STEPS - 1) + 1.2;
  const olv640BotY = CLK_Y - (STEPS - 1) * H_STEP - 1.2;
  const olv640Geo  = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, olv640BotY, 0),
    new THREE.Vector3(0, olv640TopY, 0),
  ]);
  const olv640Mat  = new THREE.LineBasicMaterial({ color: 0x440066, transparent: true, opacity: 0.20 });
  R.disposables.push(olv640Geo, olv640Mat);
  const olv640Line = new THREE.Line(olv640Geo, olv640Mat);
  olv640Line.visible = false;
  scene.add(olv640Line);
  const olv640Lbl = makeOlvLbl('640', new THREE.Vector3(0.38, OLV_Y + 0.60, 0), '#660088', '12px');

  const oliverHoverMeshes = [olvNode3, olvNode6, ...compMeshes, ...compMeshesB];
  let   lastOlvHl         = -1;

  const olvAllObjs = [olvMobius, olvChamber3, olvChamber6, olvNode3, olvNode6,
                      olvBridge, olvTrav, olvTailLine, olvLbl3, olvLbl6, olvLblVoid,
                      olvStr1, olvStr2, olvStr3,
                      compBackbone, compRungs, ...compMeshes, ...compLbls,
                      compBackboneB, compRungsAB, ...compMeshesB, ...compLblsB,
                      olv640Line, olv640Lbl];
  const setOliver = on => {
    showOliver = on;
    olvAllObjs.forEach(o => { o.visible = on; });
    if (on) olvStartT = null;
    document.getElementById('p8oliver')?.classList.toggle('lit', on);
  };

  // ── HUD ──────────────────────────────────────────────────────────────────
  ov.innerHTML =
    `<div style="color:#4ac880;letter-spacing:.1em">08 · JENNIE φ</div>` +
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

  const setGreekTitle = on => {
    const h1 = document.getElementById('site-title');
    if (h1) h1.textContent = on ? 'JENNIE φ' : 'JENNIE 21';
    document.title = on ? 'JENNIE φ' : 'JENNIE 21';
  };

  document.getElementById('p8comp').onclick = () => {
    showDecimal = !showDecimal;
    showGreek = false;
    document.getElementById('p8comp').classList.toggle('lit', showDecimal);
    document.getElementById('p8greek').classList.remove('lit');
    setGreekTitle(false);
    invLabelData.forEach(l => { l.lbl.element.textContent = nodeLabel(l); });
    syncOrbitLabels();
  };

  document.getElementById('p8greek').onclick = () => {
    showGreek = !showGreek;
    document.getElementById('p8greek').classList.toggle('lit', showGreek);
    if (showGreek) {
      showDecimal = false;
      document.getElementById('p8comp').classList.remove('lit');
    }
    setGreekTitle(showGreek);
    invLabelData.forEach(l => { l.lbl.element.textContent = nodeLabel(l); });
    syncOrbitLabels();
  };

  let showMeniscus = false;

  const setMeniscus = on => {
    showMeniscus = on;
    menMesh.visible = on;
    document.getElementById('p8men').classList.toggle('lit', on);
  };

  document.getElementById('p8shade').onclick = () => {
    showShading = !showShading;
    document.getElementById('p8shade').classList.toggle('lit', showShading);
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

  // Position-shifted encoding: orbit slot = (charCode % M + nodeIdx) % M
  // Same letter at different positions → different orbit values → unique waveform
  const slotForChar = (ch, i) => (ch.charCodeAt(0) % M + i) % M;
  const orbitValForChar = (ch, i) => ORBIT[slotForChar(ch, i)];

  const encodeMsg = raw => {
    if (!raw) { msgOrbit = null; msgChars = []; }
    else {
      const arr = new Float32Array(STEPS + 1);
      const chars = [];
      for (let i = 0; i <= STEPS; i++) {
        const ch = raw[i % raw.length];
        arr[i] = orbitValForChar(ch, i);
        if (i < STEPS) chars.push(ch);
      }
      msgOrbit = arr;
      msgChars = chars;
    }
    if (showSpec) updateDecoder();
    syncOrbitLabels();
  };

  const nodeLabel = l => showGreek ? GREEK[l.val] ?? l.val : showDecimal ? l.val : l.bt;

  const syncOrbitLabels = () => {
    if (fibVariant !== 'orbit' || !msgChars.length || !showSpec) {
      allLabels.forEach(l => {
        l.lbl.element.textContent = nodeLabel(l);
        l.lbl.element.style.fontSize = '';
        l.lbl.element.style.color = '';
        l.lbl.element.style.textShadow = '';
      });
    } else {
      allLabels.forEach(l => {
        if (l.φ === 0) {
          // strand A: show encoded character — larger, vivid magenta
          const ch = msgChars[l.s] || '·';
          l.lbl.element.textContent = ch;
          l.lbl.element.style.fontSize = '20px';
          l.lbl.element.style.color = '#ff55ff';
          l.lbl.element.style.textShadow = '0 0 12px #ff55ff, 0 0 24px #aa00aa';
        } else {
          l.lbl.element.textContent = nodeLabel(l);
          l.lbl.element.style.fontSize = '';
          l.lbl.element.style.color = '';
          l.lbl.element.style.textShadow = '';
        }
      });
    }
  };

  const setFibVariant = v => {
    fibVariant = v;
    envMat.opacity = v ? 0.72 : 0;
    Object.values(FIB_IDS).forEach(id => document.getElementById(id).classList.remove('lit'));
    if (v) document.getElementById(FIB_IDS[v]).classList.add('lit');
    syncOrbitLabels();
    if (showSpec) updateDecoder();
  };

  // ── Position-aware candidate lookup ──────────────────────────────────────
  // At node i with detected orbit value ov, candidates are letters where
  // (charCode % M + i) % M === ORBIT.indexOf(ov)
  const candsAt = (nodeIdx, ov) => {
    const targetSlot = ((ORBIT.indexOf(ov) - nodeIdx) % M + M) % M;
    const out = [];
    for (let c = 97; c <= 122; c++) if (c % M === targetSlot) out.push(String.fromCharCode(c));
    return out;
  };

  const decodePanel = document.getElementById('decode-panel');

  const updateDecoder = () => {
    if (!decodePanel) return;
    const decoded = msgChars.length
      ? msgChars.map(c => c || '·').join('')
      : '·'.repeat(STEPS);
    let colsHtml = '';
    if (fibVariant === 'orbit') {
      let cols = '';
      for (let s = 0; s < STEPS; s++) {
        const idx = Math.round(s * (N_ENV - 1) / (STEPS - 1));
        const wx = envArr[idx * 3], wz = envArr[idx * 3 + 2];
        const r = Math.sqrt(wx * wx + wz * wz);
        const ov = ORBIT.reduce((best, v) =>
          Math.abs(R_BASE + v * 0.11 - r) < Math.abs(R_BASE + best * 0.11 - r) ? v : best
        , ORBIT[0]);
        const cands = candsAt(s, ov);
        const known = msgChars[s] ? msgChars[s].toLowerCase() : null;
        const candsHtml = cands.map(ch =>
          ch === known ? `<span class="hit">${ch}</span>` : `<span class="cands">${ch}</span>`
        ).join('');
        cols += `<div class="dr"><div class="orv">${ov}</div><div>${candsHtml}</div></div>`;
      }
      colsHtml = `<div class="decode-cols">${cols}</div>`;
    }
    decodePanel.innerHTML = `<div class="decode-msg">${decoded}</div>${colsHtml}`;
  };

  // ── Spectrograph canvas ──────────────────────────────────────────────────
  let showSpec = false;
  const specPanel  = document.getElementById('spec-panel');
  const specCanvas = document.getElementById('p8spec');
  const specCtx    = specCanvas ? specCanvas.getContext('2d') : null;
  const Y_WORLD_MAX = baseY(STEPS - 1) * 1.15;
  const X_WORLD_MAX = 3.6;

  let decoderSpeed = 1.4; // rev/sec (loops automatically in animation loop)

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
    // background grid — vertical lines at each node, horizontal amplitude lines
    specCtx.strokeStyle = 'rgba(0,255,200,0.10)';
    specCtx.lineWidth = 0.5;
    // vertical columns at each node
    for (let s = 0; s < STEPS; s++) {
      const x = xAt(s);
      specCtx.beginPath(); specCtx.moveTo(x, 0); specCtx.lineTo(x, H); specCtx.stroke();
    }
    // horizontal rows: center + ±half amplitude
    for (const frac of [0, 0.5, -0.5, 1, -1]) {
      const y = yAmp(frac * X_WORLD_MAX);
      specCtx.beginPath(); specCtx.moveTo(0, y); specCtx.lineTo(W, y); specCtx.stroke();
    }
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
  document.getElementById('p8men').onclick    = () => setMeniscus(!showMeniscus);
  document.getElementById('p8oliver').onclick = () => setOliver(!showOliver);
  document.getElementById('p8wave').onclick   = () => {
    showWave = !showWave;
    document.getElementById('p8wave')?.classList.toggle('lit', showWave);
  };
  document.getElementById('p8msg').addEventListener('input', e => encodeMsg(e.target.value));
  const sliderToHz = v => Math.pow(10, v / 100 - 1);
  const fmtHz = hz => hz >= 1e6 ? (hz/1e6).toFixed(2)+'M' : hz >= 1e3 ? (hz/1e3).toFixed(hz>=1e4?1:2)+'k' : hz >= 10 ? hz.toFixed(1) : hz.toFixed(2);
  document.getElementById('p8dec_rot').addEventListener('input', e => {
    decoderSpeed = sliderToHz(parseFloat(e.target.value));
    document.getElementById('p8dec_hz_val').textContent = fmtHz(decoderSpeed);
  });
  document.getElementById('p8spec_btn').onclick = () => {
    showSpec = !showSpec;
    document.getElementById('p8spec_btn').classList.toggle('lit', showSpec);
    specPanel.classList.toggle('vis', showSpec);
    syncOrbitLabels();
  };

  // defaults: FIB active, decoder visible + Jennie message pre-loaded
  setFibVariant('orbit');
  const DEFAULT_MSG = 'kill this love always';
  document.getElementById('p8msg').value = DEFAULT_MSG;
  encodeMsg(DEFAULT_MSG);
  showSpec = false;

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

    // Main helix nodes
    const hits = raycaster.intersectObjects(allMeshes);
    const idx  = hits.length > 0 ? allMeshes.indexOf(hits[0].object) : -1;
    if (idx !== lastHl) {
      if (lastHl >= 0) { allMeshes[lastHl].material.emissiveIntensity = allMeshes[lastHl].userData.baseEI; allMeshes[lastHl].scale.setScalar(1); }
      if (idx >= 0)    { allMeshes[idx].material.emissiveIntensity = 0.95; allMeshes[idx].scale.setScalar(2.2); }
      lastHl = idx;
    }

    // Oliver 42 nodes (only when visible)
    let olvHl = -1;
    if (showOliver) {
      const olvHits = raycaster.intersectObjects(oliverHoverMeshes);
      olvHl = olvHits.length > 0 ? oliverHoverMeshes.indexOf(olvHits[0].object) : -1;
    }
    if (lastOlvHl !== olvHl) {
      if (lastOlvHl >= 0) { oliverHoverMeshes[lastOlvHl].material.emissiveIntensity = oliverHoverMeshes[lastOlvHl].userData.baseEI; oliverHoverMeshes[lastOlvHl].scale.setScalar(1); }
      if (olvHl >= 0)     { oliverHoverMeshes[olvHl].material.emissiveIntensity = 1.2; oliverHoverMeshes[olvHl].scale.setScalar(1.8); }
      lastOlvHl = olvHl;
    }

    if (idx >= 0) {
      const { val, bt, cs, isEcho } = allMeshes[idx].userData;
      const echo = COMP_OF[val];
      const glabel = showGreek ? (GREEK[val] ?? val) : null;
      let h = `<div class="th" style="color:${cs}">${glabel ?? val}</div>`;
      if (glabel) h += `<p class="tr" style="color:#888aaa">decimal: <b>${val}</b></p>`;
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
    } else if (olvHl >= 0) {
      const om = oliverHoverMeshes[olvHl];
      const { olvType, olvVal, olvS } = om.userData;
      const cs = olvVal === 3 ? OLV_CS3 : OLV_CS6;
      let h = `<div class="th" style="color:${cs}">${olvVal}</div>`;
      h += `<p class="tr">BT: <b>${toBT(olvVal)}</b></p>`;
      if (olvType === 'apex') {
        const gates = ORBIT.filter(v => (v * 3) % 9 === olvVal);
        h += `<p class="tr">×3 mod 9 → <b>${olvVal}</b></p>`;
        h += `<p class="tr" style="color:#888aaa">orbit: {${gates.join(', ')}} × 3</p>`;
      } else {
        const orbitVal = ORBIT[olvS % M];
        h += `<p class="tr">step ${olvS} · orbit[${olvS % M}] = <b>${orbitVal}</b></p>`;
        h += `<p class="tr">${orbitVal} × 3 = <b>${olvVal}</b> (mod 9)</p>`;
      }
      h += `<p class="tr" style="color:#888aaa">complement · {3,6} under ×2 mod 9</p>`;
      tip(e, h);
      statEl.textContent = String(olvVal);
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
    if (lastOlvHl >= 0) {
      oliverHoverMeshes[lastOlvHl].material.emissiveIntensity = oliverHoverMeshes[lastOlvHl].userData.baseEI;
      oliverHoverMeshes[lastOlvHl].scale.setScalar(1);
    }
    lastOlvHl = -1;
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
    if (showWave) waveT = t * waveOmega;

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
    if (showSpec) { drawSpec(t); updateDecoder(); }

    // ── Anchor ring — always-on gold ring at F₈ step (step 20 = count 21) ─────
    { const ancRcur = helixR(ANCHOR_S) + 0.55;
      for (let i = 0; i <= ancN; i++) {
        const θ = (i / ancN) * Math.PI * 2;
        ancArr[i * 3]     = ancRcur * Math.cos(θ);
        ancArr[i * 3 + 1] = CLK_Y;
        ancArr[i * 3 + 2] = ancRcur * Math.sin(θ);
      }
      ancAttr.needsUpdate = true;
      ancMat.opacity = 0.45 + 0.25 * Math.abs(Math.sin(t * 0.5 + Math.PI));
    }
    if (showMeniscus) updateMeniscus(MEN_DIP * breathInv);

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

    // ── Oliver 42 traveler animation ──────────────────────────────────────
    if (showOliver) {
      if (olvStartT === null) olvStartT = t;
      const olvElapsed = t - olvStartT;
      const olvLoopT   = (olvElapsed / OLV_LOOP_T) % 1;
      const olvParam   = olvLoopT * Math.PI * 2;

      const olvPos = olvPt(olvParam);
      olvTrav.position.copy(olvPos);

      // Upper chamber (node 3): t where cos(t)>0, i.e. t in (-π/2, π/2)
      const inUpper = olvParam < Math.PI / 2 || olvParam > 3 * Math.PI / 2;
      const olvCol  = inUpper ? OLV_C3 : OLV_C6;
      olvTravMat.color.setHex(olvCol);
      olvTravMat.emissive.setHex(olvCol);

      // Dim near the bridge crossing (y close to OLV_Y)
      const bridgeDist = Math.abs(olvPos.y - OLV_Y);
      olvTravMat.opacity = 0.30 + 0.65 * Math.min(1, bridgeDist / OLV_DOME);

      // Pulse apex nodes as traveler approaches
      const d3 = olvPos.distanceTo(olvNode3Pos);
      const d6 = olvPos.distanceTo(olvNode6Pos);
      olvNode3.material.emissiveIntensity = olvNode3.userData.baseEI + 2.0 * Math.max(0, 1 - d3 / 1.0);
      olvNode6.material.emissiveIntensity = olvNode6.userData.baseEI + 2.0 * Math.max(0, 1 - d6 / 1.0);

      // Tail
      olvTailHistory.push(olvPos.clone());
      if (olvTailHistory.length > OLV_TAIL) olvTailHistory.shift();
      for (let i = 0; i < olvTailHistory.length; i++) {
        olvTailArr[i * 3]     = olvTailHistory[i].x;
        olvTailArr[i * 3 + 1] = olvTailHistory[i].y;
        olvTailArr[i * 3 + 2] = olvTailHistory[i].z;
      }
      olvTailAttr.needsUpdate = true;
      olvTailGeo.setDrawRange(0, olvTailHistory.length);

      // Complement helix Strand A + B: positions follow rotA
      for (let s = 0; s < STEPS; s++) {
        const cx  = nodeX(s, 0,        rotA), cz  = nodeZ(s, 0,        rotA), cy = compY(s);
        const cxB = nodeX(s, Math.PI,  rotA), czB = nodeZ(s, Math.PI,  rotA);
        // Strand A
        compMeshes[s].position.set(cx, cy, cz);
        const { lx, lz } = labelEnd(s, 0, rotA, LEADER);
        compLbls[s].position.set(lx, cy - 0.10, lz);
        compBBArr[s * 3]     = cx;
        compBBArr[s * 3 + 1] = cy;
        compBBArr[s * 3 + 2] = cz;
        // ×3 rung: orbit node (above) → Strand A complement node (below)
        const base = s * 6;
        compRungArr[base]     = cx; compRungArr[base + 1] = baseY(s) * breath; compRungArr[base + 2] = cz;
        compRungArr[base + 3] = cx; compRungArr[base + 4] = cy;               compRungArr[base + 5] = cz;
        // Strand B
        compMeshesB[s].position.set(cxB, cy, czB);
        const lb = labelEnd(s, Math.PI, rotA, LEADER);
        compLblsB[s].position.set(lb.lx, cy - 0.10, lb.lz);
        compBBBArr[s * 3]     = cxB;
        compBBBArr[s * 3 + 1] = cy;
        compBBBArr[s * 3 + 2] = czB;
        // A↔B rungs
        compRungsABArr[base]     = cx;  compRungsABArr[base + 1] = cy; compRungsABArr[base + 2] = cz;
        compRungsABArr[base + 3] = cxB; compRungsABArr[base + 4] = cy; compRungsABArr[base + 5] = czB;
      }
      compBBAttr.needsUpdate    = true;
      compRungAttr.needsUpdate  = true;
      compBBBAttr.needsUpdate   = true;
      compRungsABAttr.needsUpdate = true;
      // 640 axis: pulse opacity when wave is active
      olv640Mat.opacity = showWave
        ? 0.14 + 0.18 * (0.5 + 0.5 * Math.sin(waveT * 1.5))
        : 0.20;
    }

    R.labelRenderer.render(scene, camera);
  };
}
