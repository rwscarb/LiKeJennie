// ─────────────────────────────────────────────────────────────────────────────
//  SCENE 17 — TIMELINE
//  Project history derived from git log + experiment results.
// ─────────────────────────────────────────────────────────────────────────────
import { THREE, CSS2DObject, R, mkCamera, mkControls } from './shared.js';

const C_DATE   = 0x00ff88;
const C_LINE   = 0x0d2a1a;
const C_NODE   = 0x00e5ff;
const C_RESULT = 0xffe600;
const C_DIM    = 0x1a3a2a;

const CS_DATE   = '#00ff88';
const CS_NODE   = '#00e5ff';
const CS_RESULT = '#ffe600';
const CS_DIM    = '#1a3a2a';
const CS_BODY   = '#2a5a3a';

// ── Timeline data (git log + experiment records) ──────────────────────────────
const EVENTS = [
  {
    date: '2026-07-27',
    title: 'Project begins',
    body: 'fib896.html ported to Svelte + Three.js. Scenes 01-08 built: divisor lattice, 1/89, φ sphere, MoE routing, Greek letters, sunflower, trit matrix, helix.',
    kind: 'milestone',
  },
  {
    date: '2026-07-28',
    title: '640 boundary settled',
    body: 'jennie21 / oliver42 project split decided. 640 framework (axis 4.5, mod9, ×3/2→640→960) moves to oliver42. jennie21 stays focused on the orbit.',
    kind: 'decision',
  },
  {
    date: '2026-07-29',
    title: 'Scenes 09-10 — CLOCK, ORBIT CYCLE',
    body: '75 commits in one day. Orbit cycle animation added. Fibonacci/Lucas structure visualized in full.',
    kind: 'milestone',
  },
  {
    date: '2026-07-31',
    title: 'Scenes 11-13 + all experiments',
    body: 'OLIVER 42, EXPERIMENTS, GNN MIRROR scenes built. All core PoC scripts added: Echo MoE, orbit GNN, ternary sweep, SGD orbit, trib 3-layer (33/33/33 result).',
    kind: 'milestone',
  },
  {
    date: '2026-08-01',
    title: 'Scenes 14-15 — BUCKMINSTER, ORBIT MUSIC',
    body: 'C₆₀ buckminsterfullerene scene. Penrose Tribar architecture invented: orbit permutation × gated skip × LayerNorm. Step sequencer with orbit arpeggio.',
    kind: 'milestone',
  },
  {
    date: '2026-08-02',
    title: 'Penrose Tribar PoC v1',
    body: 'poc_penrose_tribar.py: Fashion-MNIST, K=4 and K=32. Tribar beats baseline across all noise levels. First seismology experiments begin (ETHZ dataset).',
    kind: 'result',
    stat: 'K=32: tri 80.9% vs base 74.8%  (+6.1%)',
  },
  {
    date: '2026-08-03 (morning)',
    title: 'Tribar Fashion-MNIST ablation',
    body: 'K=32, 5 seeds, σ=[0.0,0.7,1.5]. Optuna sweep confirms hyperparameters. Seismology moves to STEAD chunk2 (84.9GB downloaded).',
    kind: 'result',
    stat: 'stride-5 ≈ random >> identity >> baseline',
  },
  {
    date: '2026-08-03 (evening)',
    title: 'STEAD seismology — earthquake vs noise',
    body: '7373 eq + 7373 noise waveforms. 30s windows. K=128, CYCLES=3, 3 seeds. Tribar positive at all noise levels. Peak gap at σ=0.3.',
    kind: 'result',
    stat: 'gap: +2.29% → +2.61% → +1.03% → +0.78% → +1.48%  (σ=0→1.5)',
  },
  {
    date: '2026-08-03 (late)',
    title: 'Early detection + streaming system',
    body: 'P-wave onset windows (1s): ~88% accuracy, 1s consumed, >8s warning before S-wave. StreamDetector class built. Scene 16 MUSIC added.',
    kind: 'result',
    stat: '1s window: base 87.4%  tri 88.4%  (+1.0%)',
  },
];

export function buildS17() {
  const scene    = R.scene    = new THREE.Scene();
  const camera   = R.camera   = mkCamera();
  camera.position.set(0, 0, 18);
  camera.lookAt(0, 0, 0);
  const controls = R.controls = mkControls(camera);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.autoRotate    = false;

  scene.add(new THREE.AmbientLight(0xffffff, 0.4));

  const N     = EVENTS.length;
  const YSPAN = 14;
  const Y_TOP = YSPAN / 2;
  const YSTEP = YSPAN / (N - 1);

  // Vertical spine
  const spinePts = [new THREE.Vector3(0, Y_TOP + 0.5, 0), new THREE.Vector3(0, -Y_TOP - 0.5, 0)];
  const spineG = new THREE.BufferGeometry().setFromPoints(spinePts);
  const spineM = new THREE.LineBasicMaterial({ color: C_LINE });
  R.disposables.push(spineG, spineM);
  scene.add(new THREE.Line(spineG, spineM));

  EVENTS.forEach((ev, i) => {
    const y    = Y_TOP - i * YSTEP;
    const side = i % 2 === 0 ? 1 : -1;  // alternate left/right

    // Node sphere
    const col  = ev.kind === 'result' ? C_RESULT : C_NODE;
    const cols = ev.kind === 'result' ? CS_RESULT : CS_NODE;
    const nr   = ev.kind === 'result' ? 0.18 : 0.14;
    const ng   = new THREE.SphereGeometry(nr, 14, 10);
    const nm   = new THREE.MeshPhongMaterial({ color: col, emissive: col, emissiveIntensity: 0.2 });
    R.disposables.push(ng, nm);
    const node = new THREE.Mesh(ng, nm);
    node.position.set(0, y, 0);
    scene.add(node);

    // Horizontal tick
    const tickPts = [new THREE.Vector3(0, y, 0), new THREE.Vector3(side * 0.7, y, 0)];
    const tg = new THREE.BufferGeometry().setFromPoints(tickPts);
    const tm = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.5 });
    R.disposables.push(tg, tm);
    scene.add(new THREE.Line(tg, tm));

    // Card div
    const card = document.createElement('div');
    card.style.cssText = [
      `width:220px`,
      `background:rgba(0,8,0,0.85)`,
      `border:1px solid ${cols}22`,
      `border-left:2px solid ${cols}`,
      `padding:5px 8px`,
      `font-family:'Courier New',monospace`,
      `pointer-events:none;user-select:none`,
    ].join(';');

    const dateDiv = document.createElement('div');
    dateDiv.textContent = ev.date;
    dateDiv.style.cssText = `font-size:10px;color:${CS_DIM};letter-spacing:.05em`;
    card.appendChild(dateDiv);

    const titleDiv = document.createElement('div');
    titleDiv.textContent = ev.title;
    titleDiv.style.cssText = `font-size:13px;font-weight:bold;color:${cols};margin:2px 0 3px`;
    card.appendChild(titleDiv);

    const bodyDiv = document.createElement('div');
    bodyDiv.textContent = ev.body;
    bodyDiv.style.cssText = `font-size:10px;color:${CS_BODY};line-height:1.4`;
    card.appendChild(bodyDiv);

    if (ev.stat) {
      const statDiv = document.createElement('div');
      statDiv.textContent = ev.stat;
      statDiv.style.cssText = `font-size:10px;color:${CS_RESULT};margin-top:3px;font-weight:bold`;
      card.appendChild(statDiv);
    }

    const lbl = new CSS2DObject(card);
    lbl.position.set(side * (1.0 + 0.2), y, 0);
    scene.add(lbl);
    R.css2dObjects.push(lbl);
  });

  // "NOW" marker at bottom
  const nowDiv = document.createElement('div');
  nowDiv.textContent = '▶ NOW';
  nowDiv.style.cssText = [
    `font-family:'Courier New',monospace`,
    `font-size:11px;font-weight:bold`,
    `color:${CS_DATE}`,
    `text-shadow:0 0 8px ${CS_DATE}`,
    `pointer-events:none;user-select:none`,
  ].join(';');
  const nowLbl = new CSS2DObject(nowDiv);
  nowLbl.position.set(0.5, -Y_TOP - 0.7, 0);
  scene.add(nowLbl);
  R.css2dObjects.push(nowLbl);

  R.ov.innerHTML =
    `<div style="color:#00ff88;letter-spacing:.1em">17 · TIMELINE</div>` +
    `<div style="color:#3a6a5a;font-size:14px;margin-top:3px">project history · 2026-07-27 →</div>` +
    `<div style="font-size:12px;margin-top:4px;color:#1a3a2a">253 commits over 8 days</div>` +
    `<div style="font-size:12px;color:#00e5ff">milestones</div>` +
    `<div style="font-size:12px;color:#ffe600">experiment results</div>`;

  R.animFn = () => { controls.update(); };
}
