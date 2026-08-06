// ─────────────────────────────────────────────────────────────────────────────
//  SCENE 20 — BTCVM
//
//  A minimal register machine running a Fibonacci program, clocked by
//  simulated Bitcoin blocks.
//
//  Layout:
//    LEFT        — 20-bar equalizer (log-scaled fibonacci register history)
//    CENTRE-LEFT — Orbit ring floating above equalizer bars at ORBIT_Y
//    CENTRE      — Register tape (scrolling 22-cell history)
//    RIGHT       — Bitcoin blocks falling vertically (₿ front face)
//    ABOVE TAPE  — Opcode flash plane
//    FLOOR       — Grid with labels
//    BEAMS       — Horizontal commit beams (₿ → EQ) on block sync
// ─────────────────────────────────────────────────────────────────────────────
import { THREE, R, mkCamera, mkControls, CG, CC, CY, CO } from './shared.js';

// ── Layout constants ──────────────────────────────────────────────────────────
const EQ_N       = 20;
const EQ_X0      = -5.8;
const EQ_SPACING = 0.38;
const EQ_CX      = EQ_X0 + ((EQ_N - 1) * EQ_SPACING) / 2;
const EQ_BASE_Y  = 0.0;
const EQ_MAX_H   = 4.2;
const MAX_REG_LOG = Math.log10(1e14 + 1);   // saturation ceiling (fib growth)

const ORBIT_R    = 3.0;
const ORBIT_Y    = 2.2;

const BTC_X      = 7.5;
const BTC_SPAWN_Y= 7.5;
const SYNC_Y     = 1.2;
const BTC_FALL   = 0.022;
const BTC_INTERVAL = 220;

const TAPE_N     = 22;
const TAPE_X0    = -1.0;
const TAPE_DX    = 0.42;
const TAPE_Y     = 3.8;

// ── Minimal Register-Machine VM (fibonacci program) ───────────────────────────
// Opcodes: 0=MOV, 1=ADD, 2=CPY, 3=SWAP, 4=MOD9, 5=NOP, 6=JMP
const OP_NAMES   = ['MOV', 'ADD', 'CPY', 'SWAP', 'MOD9', 'NOP', 'JMP'];
const OP_COLORS  = ['#00e5ff', '#00ff88', '#ffe600', '#ff9800', '#cc44ff', '#444', '#ff4444'];

// Fibonacci program: r0 = current fib, r1 = previous fib, r2 = tmp, r3 = cycle count
const FIB_PROG = [
  { op: 2, a: 2, b: 0 },    // CPY  r2 ← r0
  { op: 1, a: 0, b: 1 },    // ADD  r0 += r1
  { op: 2, a: 1, b: 2 },    // CPY  r1 ← r2
  { op: 1, a: 3, b: -1 },   // ADD  r3 += 1  (cycle counter, b=-1 → literal 1)
  { op: 4, a: 4, b: 0 },    // MOD9 r4 ← r0 mod 9
  { op: 5, a: 0, b: 0 },    // NOP
  { op: 6, a: 0, b: 0 },    // JMP → 0
];

class BTCVM {
  constructor() {
    this.regs = new Array(8).fill(0);
    this.regs[0] = 1;  // F(1)
    this.regs[1] = 1;  // F(0)
    this.pc = 0;
    this.cycles = 0;
    this.lastOp = 5;   // NOP initially
  }

  step() {
    const instr = FIB_PROG[this.pc % FIB_PROG.length];
    this.lastOp = instr.op;
    switch (instr.op) {
      case 0:  // MOV r[a] ← literal b
        this.regs[instr.a] = instr.b; break;
      case 1:  // ADD r[a] += r[b] (b<0 → literal 1)
        this.regs[instr.a] += (instr.b < 0 ? 1 : this.regs[instr.b]); break;
      case 2:  // CPY r[a] ← r[b]
        this.regs[instr.a] = this.regs[instr.b]; break;
      case 3:  // SWAP r[a] ↔ r[b]
        [this.regs[instr.a], this.regs[instr.b]] = [this.regs[instr.b], this.regs[instr.a]]; break;
      case 4:  // MOD9 r[a] ← r[b] mod 9
        this.regs[instr.a] = ((this.regs[instr.b] % 9) + 9) % 9; break;
      case 5:  // NOP
        break;
      case 6:  // JMP → 0
        this.pc = -1; break;
    }
    this.pc = (this.pc + 1) % FIB_PROG.length;
    this.cycles++;
    // Clamp r0 to avoid BigInt territory
    if (this.regs[0] > 1e15) this.regs[0] = 1; // reset to keep it visual
  }
}

// ── Build ─────────────────────────────────────────────────────────────────────
export function buildS20() {
  const ov = R.ov;
  const scene = R.scene = new THREE.Scene();
  const camera = R.camera = mkCamera();
  camera.position.set(2, 7, 16);
  camera.lookAt(2, -0.5, 0);
  const controls = R.controls = mkControls(camera);
  controls.autoRotate = false;
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.38));
  const pl1 = new THREE.PointLight(CG,  4.0, 60); pl1.position.set(-4, 5, 6);  scene.add(pl1);
  const pl2 = new THREE.PointLight(CO,  3.5, 50); pl2.position.set( 8, 4, 6);  scene.add(pl2);
  const pl3 = new THREE.PointLight(CY,  2.5, 40); pl3.position.set( 2,-2, 5);  scene.add(pl3);

  const grid = new THREE.GridHelper(30, 30, 0x0a1a0a, 0x050f05);
  grid.position.y = -0.5;
  scene.add(grid);

  // ── Floor labels ─────────────────────────────────────────────────────────────
  function mkFloorLabel(text, x, z, color = '#00ff88', fs = 13, cw = 128, ch = 40) {
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    ctx.fillStyle = color; ctx.font = `bold ${fs}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, cw / 2, ch / 2);
    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(cw / 32, ch / 32);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    R.disposables.push(tex, geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, -0.48, z);
    scene.add(m); return m;
  }

  mkFloorLabel('EQ / FIB HISTORY', EQ_CX,       1.4, '#33aa55', 12, 256, 36);
  mkFloorLabel('BTCVM',             1.5,          3.5, '#ff980077', 18, 224, 52);
  mkFloorLabel('₿ CHAIN',           BTC_X,        3.5, '#ff9800',   13, 128, 40);

  // ── Equalizer — 20 bars showing log-scaled fibonacci register history ─────────
  const eqBuf     = new Array(EQ_N).fill(1);
  const eqSmooth  = new Array(EQ_N).fill(0.05);

  function fibLogH(v) {
    return Math.max(0.05, (Math.log10(Math.abs(v) + 1) / MAX_REG_LOG) * EQ_MAX_H);
  }
  function pushEqValue(r0) {
    const h = fibLogH(r0);
    eqBuf.shift(); eqBuf.push(h);
  }

  const eqMeshes = [], eqMats = [];
  for (let i = 0; i < EQ_N; i++) {
    const geo = new THREE.BoxGeometry(EQ_SPACING * 0.76, 1, 0.38);
    const mat = new THREE.MeshPhongMaterial({ color: CG, emissive: CG, emissiveIntensity: 0.5, transparent: true, opacity: 0.88 });
    R.disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(EQ_X0 + i * EQ_SPACING, EQ_BASE_Y + 0.5, 0);
    scene.add(m);
    eqMeshes.push(m); eqMats.push(mat);
  }

  // ── Orbit ring (flat, floating at ORBIT_Y) ────────────────────────────────────
  const ORBIT_N = 9;
  const orbitHits = new Array(ORBIT_N).fill(0);
  const orbitDots = [];

  const torusGeo = new THREE.TorusGeometry(ORBIT_R, 0.055, 8, 56);
  const torusMat = new THREE.MeshBasicMaterial({ color: CY, transparent: true, opacity: 0.22 });
  R.disposables.push(torusGeo, torusMat);
  const torusMesh = new THREE.Mesh(torusGeo, torusMat);
  torusMesh.rotation.x = Math.PI / 2;
  torusMesh.position.set(EQ_CX, ORBIT_Y, 0);
  scene.add(torusMesh);

  for (let i = 0; i < ORBIT_N; i++) {
    const a = (i / ORBIT_N) * Math.PI * 2;
    const geo = new THREE.SphereGeometry(0.12, 10, 6);
    const mat = new THREE.MeshPhongMaterial({
      color: CY, emissive: CY, emissiveIntensity: 0.15,
      transparent: true, opacity: 0.28,
    });
    R.disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(EQ_CX + Math.cos(a) * ORBIT_R, ORBIT_Y, Math.sin(a) * ORBIT_R);
    scene.add(m);
    orbitDots.push({ mesh: m, mat, a, i });
  }

  // Orbit label
  const orbCv = document.createElement('canvas'); orbCv.width = 128; orbCv.height = 64;
  const orbCtx = orbCv.getContext('2d');
  const orbTex = new THREE.CanvasTexture(orbCv);
  const orbGeo = new THREE.PlaneGeometry(1.8, 0.9);
  const orbMat2 = new THREE.MeshBasicMaterial({ map: orbTex, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  R.disposables.push(orbGeo, orbMat2, orbTex);
  const orbMesh = new THREE.Mesh(orbGeo, orbMat2);
  orbMesh.position.set(EQ_CX, ORBIT_Y + 0.6, 0.2);
  scene.add(orbMesh);

  function drawOrbitLabel(mod9) {
    orbCtx.clearRect(0, 0, 128, 64);
    orbCtx.fillStyle = '#443300';
    orbCtx.font = '9px monospace'; orbCtx.textAlign = 'center';
    orbCtx.fillText('r0 mod 9', 64, 14);
    orbCtx.fillStyle = '#ffe600'; orbCtx.font = 'bold 30px monospace';
    orbCtx.fillText(String(mod9), 64, 52);
    orbTex.needsUpdate = true;
  }
  drawOrbitLabel(0);

  // ── Register tape (22 scrolling cells) ────────────────────────────────────────
  const tapeHistory = new Array(TAPE_N).fill(0);  // last N values of r0 mod 9
  const tapeMeshes  = [], tapeMats = [];

  function mod9Color(v) {
    // orbit cycle {1,2,4,8,7,5} = active; {3,6} = complement; 0 = zero
    const palette = ['#222', '#00ff88', '#00cc66', '#4466ff', '#009966', '#007744',
                     '#0055aa', '#004422', '#2200aa'];
    return palette[((v % 9) + 9) % 9];
  }

  for (let i = 0; i < TAPE_N; i++) {
    const geo = new THREE.BoxGeometry(TAPE_DX * 0.8, 0.32, 0.22);
    const mat = new THREE.MeshPhongMaterial({ color: 0x222222, emissive: 0x111111, emissiveIntensity: 0.5 });
    R.disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(TAPE_X0 + i * TAPE_DX, TAPE_Y, 0.2);
    scene.add(m);
    tapeMeshes.push(m); tapeMats.push(mat);
  }

  function updateTape(r0) {
    tapeHistory.shift(); tapeHistory.push(((r0 % 9) + 9) % 9);
    for (let i = 0; i < TAPE_N; i++) {
      const col = new THREE.Color(mod9Color(tapeHistory[i]));
      tapeMats[i].color.copy(col); tapeMats[i].emissive.copy(col);
      tapeMats[i].emissiveIntensity = tapeHistory[i] === 0 ? 0.08 : 0.65;
    }
  }

  // Tape head marker (bright cell at right end)
  const headGeo = new THREE.BoxGeometry(TAPE_DX * 0.84, 0.38, 0.26);
  const headMat = new THREE.MeshPhongMaterial({ color: CY, emissive: CY, emissiveIntensity: 0.9, wireframe: true });
  R.disposables.push(headGeo, headMat);
  const headMesh = new THREE.Mesh(headGeo, headMat);
  headMesh.position.set(TAPE_X0 + (TAPE_N - 1) * TAPE_DX, TAPE_Y, 0.22);
  scene.add(headMesh);

  // ── Opcode flash plane ────────────────────────────────────────────────────────
  const opCv = document.createElement('canvas'); opCv.width = 256; opCv.height = 96;
  const opCtx = opCv.getContext('2d');
  const opTex = new THREE.CanvasTexture(opCv);
  const opGeo = new THREE.PlaneGeometry(2.2, 1.0);
  const opMat = new THREE.MeshBasicMaterial({ map: opTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  R.disposables.push(opGeo, opMat, opTex);
  const opMesh = new THREE.Mesh(opGeo, opMat);
  opMesh.position.set(TAPE_X0 + (TAPE_N - 1) * TAPE_DX, TAPE_Y + 0.95, 0.4);
  scene.add(opMesh);
  let opFlash = 0;

  function showOpFlash(opIdx) {
    opCtx.clearRect(0, 0, 256, 96);
    opCtx.fillStyle = OP_COLORS[opIdx] ?? '#888';
    opCtx.font = 'bold 38px monospace'; opCtx.textAlign = 'center'; opCtx.textBaseline = 'middle';
    opCtx.fillText(OP_NAMES[opIdx] ?? 'NOP', 128, 48);
    opTex.needsUpdate = true;
    opFlash = 20;
  }

  // ── Bitcoin blocks ────────────────────────────────────────────────────────────
  function mkBlockTex(n) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1a0a00';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#ff9800';
    ctx.font = 'bold 56px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('₿', 64, 52);
    ctx.fillStyle = '#ff980077';
    ctx.font = '16px monospace'; ctx.textBaseline = 'bottom';
    ctx.fillText(`#${n}`, 64, 120);
    const tex = new THREE.CanvasTexture(c);
    R.disposables.push(tex); return tex;
  }

  function mkBlockMats(n, emissive = 0.5) {
    const plain = () => new THREE.MeshPhongMaterial({ color: 0x2a1500, emissive: 0x1a0a00, emissiveIntensity: emissive });
    const tex = mkBlockTex(n);
    const front = new THREE.MeshPhongMaterial({ map: tex, emissiveMap: tex, emissiveIntensity: 0.1 });
    const mats = [plain(), plain(), plain(), plain(), front, plain()];
    R.disposables.push(...mats); return mats;
  }

  const blocks = [];
  let blkAccum = BTC_INTERVAL * 0.55;
  let blkCount = 0;

  function spawnBlock(y, committed = false) {
    const geo = new THREE.BoxGeometry(0.85, 0.85, 0.85);
    const mats = mkBlockMats(blkCount);
    R.disposables.push(geo);
    const m = new THREE.Mesh(geo, mats);
    m.position.set(BTC_X, y, 0);
    scene.add(m);
    blocks.push({ mesh: m, y, committed });
    blkCount++;
  }

  // Seed blocks evenly throughout the visible column
  const SEED_SPACING = BTC_INTERVAL * BTC_FALL;
  for (let seedY = BTC_SPAWN_Y - SEED_SPACING; seedY > -8; seedY -= SEED_SPACING) {
    spawnBlock(seedY, seedY <= SYNC_Y);
  }

  // ── Commit beams (BTC column → EQ cluster) ────────────────────────────────────
  const beams = [];

  function spawnBeam(by) {
    const pts = [
      new THREE.Vector3(BTC_X - 0.7, by, 0),
      new THREE.Vector3(EQ_CX + 1.0,  by, 0),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: CO, transparent: true, opacity: 0.8 });
    R.disposables.push(geo, mat);
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    beams.push({ line, mat, age: 0 });
  }

  // ── VM state ──────────────────────────────────────────────────────────────────
  const vm = new BTCVM();
  let paused = false, speedMult = 1.0;
  let targetN = 200, targetArmed = true;
  let rvFlash = 0;
  let lastR0 = -1;

  const SPEEDS = { slow: 0.2, normal: 1.0, fast: 4.0 };

  function setActiveSpeed(id) {
    ['s20pause', 's20slow', 's20normal', 's20fast'].forEach(s =>
      document.getElementById(s)?.classList.toggle('lit', s === id)
    );
  }

  document.getElementById('s20pause')?.addEventListener('click', () => {
    paused = !paused;
    const el = document.getElementById('s20pause');
    if (el) el.textContent = paused ? '▶ PLAY' : '⏸ PAUSE';
    if (!paused) targetArmed = false;  // don't re-pause immediately on PLAY
  });
  document.getElementById('s20slow')?.addEventListener('click',   () => { speedMult = SPEEDS.slow;   setActiveSpeed('s20slow');   });
  document.getElementById('s20normal')?.addEventListener('click', () => { speedMult = SPEEDS.normal; setActiveSpeed('s20normal'); });
  document.getElementById('s20fast')?.addEventListener('click',   () => { speedMult = SPEEDS.fast;   setActiveSpeed('s20fast');   });
  document.getElementById('s20commit')?.addEventListener('click', () => {
    // Manual commit: sync VM state to the top committed block
    rvFlash = 30;
    for (const b of blocks) {
      if (b.committed) {
        spawnBeam(b.y);
        break;
      }
    }
  });

  const targetInput = document.getElementById('s20target');
  targetInput?.addEventListener('change', () => {
    const v = parseInt(targetInput.value, 10);
    if (!isNaN(v) && v > 0) { targetN = v; targetArmed = true; }
  });
  targetInput?.addEventListener('input', () => {
    const v = parseInt(targetInput.value, 10);
    if (!isNaN(v) && v > 0) { targetN = v; targetArmed = true; }
  });

  // ── Overlay ───────────────────────────────────────────────────────────────────
  ov.innerHTML = `
    <div style="color:#ff9800;letter-spacing:.1em;font-size:11px">BTCVM</div>
    <div style="color:#555;font-size:8px">Bitcoin-Clocked Register Machine</div>
    <div style="margin-top:6px;font-size:7.5px;color:#3a1a00;line-height:1.9">
      r0: <span id="s20r0" style="color:#ff9800">1</span><br>
      r1: <span id="s20r1" style="color:#ff9800">1</span><br>
      r4: <span id="s20r4" style="color:#ffe600">0</span> (mod9)<br>
      cycles: <span id="s20cyc" style="color:#888">0</span>
    </div>
    <div style="margin-top:5px;font-size:7px;color:#443300;line-height:1.6">
      EQ = log(r0) history<br>
      orbit = r0 mod 9<br>
      ₿ clocks execution
    </div>`;

  // ── Animation ─────────────────────────────────────────────────────────────────
  R.animFn = () => {
    controls.update();

    const spd = paused ? 0 : Math.ceil(speedMult * 2);
    const now = Date.now();

    // Step VM
    for (let s = 0; s < spd; s++) {
      vm.step();
    }
    if (spd > 0) {
      showOpFlash(vm.lastOp);
      updateTape(vm.regs[0]);
    }

    // EQ update: push new value only when r0 changes
    if (vm.regs[0] !== lastR0) {
      lastR0 = vm.regs[0];
      pushEqValue(vm.regs[0]);
      drawOrbitLabel(((vm.regs[0] % 9) + 9) % 9);
      const pos = ((vm.regs[0] % 9) + 9) % 9;
      orbitHits[pos] = (orbitHits[pos] ?? 0) + 1;
      const mx = Math.max(1, ...orbitHits);
      for (const d of orbitDots) {
        const rel = orbitHits[d.i] / mx;
        d.mesh.scale.setScalar(0.5 + rel * 2.5);
        d.mat.opacity = 0.18 + rel * 0.82;
        d.mat.emissiveIntensity = 0.12 + rel * 0.85;
      }
    }

    // EQ bar update
    const eqMax = Math.max(0.1, ...eqBuf);
    for (let i = 0; i < EQ_N; i++) {
      eqSmooth[i] += (eqBuf[i] - eqSmooth[i]) * 0.12;
      const h = Math.max(0.04, eqSmooth[i]);
      eqMeshes[i].scale.y = h; eqMeshes[i].position.y = EQ_BASE_Y + h / 2;
      const rel = h / eqMax;
      const hue = 0.34 - rel * 0.27;
      const col = new THREE.Color().setHSL(hue, 0.9, 0.55);
      eqMats[i].color.copy(col); eqMats[i].emissive.copy(col);
      eqMats[i].emissiveIntensity = 0.38 + rel * 0.55;
    }

    // Orbit spin
    for (const d of orbitDots) {
      const a = d.a + now * 0.0003;
      d.mesh.position.x = EQ_CX + Math.cos(a) * ORBIT_R;
      d.mesh.position.y = ORBIT_Y;
      d.mesh.position.z = Math.sin(a) * ORBIT_R;
    }

    // Opcode flash fade
    if (opFlash > 0) {
      opFlash--;
      opMat.opacity = Math.min(0.95, (opFlash / 14) * 0.95);
    }

    // Auto-pause target
    if (targetArmed && vm.cycles >= targetN) {
      targetArmed = false;
      paused = true;
      rvFlash = 60;
      const el = document.getElementById('s20pause');
      if (el) el.textContent = '▶ PLAY';
    }

    // Bitcoin blocks
    blkAccum += speedMult;
    if (blkAccum >= BTC_INTERVAL) {
      blkAccum -= BTC_INTERVAL;
      spawnBlock(BTC_SPAWN_Y);
    }

    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (!b.committed) {
        b.y -= BTC_FALL * speedMult;
        b.mesh.position.y = b.y;
        if (b.y <= SYNC_Y + 0.4 && !b.committed) {
          b.committed = true;
          spawnBeam(b.y);
        }
      }
      if (b.y < -8) {
        scene.remove(b.mesh);
        blocks.splice(i, 1);
      }
    }

    // Commit beams fade
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i];
      b.age++;
      b.mat.opacity = Math.max(0, 0.8 - b.age / 30);
      if (b.age > 35) { scene.remove(b.line); beams.splice(i, 1); }
    }

    // Overlay update
    document.getElementById('s20r0')?.innerText !== undefined &&
      (document.getElementById('s20r0').textContent = vm.regs[0].toFixed(0));
    document.getElementById('s20r1') && (document.getElementById('s20r1').textContent = vm.regs[1].toFixed(0));
    document.getElementById('s20r4') && (document.getElementById('s20r4').textContent = vm.regs[4].toFixed(0));
    document.getElementById('s20cyc') && (document.getElementById('s20cyc').textContent = vm.cycles);
  };
}
