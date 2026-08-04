// ─────────────────────────────────────────────────────────────────────────────
//  SCENE 17 — TIME-TREE
//  Four streams branching from a central time trunk:
//    LORE    (x ≈ -3.8)  — philosophy, origin, cultural reference
//    CODE    (x ≈  0)    — scenes, architecture, commits
//    RESULT  (x ≈ +3.8)  — experiment results
//    WIFE    (x ≈ -7)    — wife contributions, insight, errata
//
//  Controls: PREV/NEXT, AUTO-TOUR, scroll, +/- ZOOM
// ─────────────────────────────────────────────────────────────────────────────
import { THREE, CSS2DObject, R, mkCamera, mkControls } from './shared.js';

// ── Stream definitions ────────────────────────────────────────────────────────
const STREAMS = {
  code:   { x: 0,    color: 0x00e5ff, cs: '#00e5ff', label: 'CODE'   },
  result: { x: 3.8,  color: 0xffe600, cs: '#ffe600', label: 'RESULT' },
  lore:   { x: -3.8, color: 0xb06fff, cs: '#b06fff', label: 'LORE'   },
  wife:   { x: -7.4, color: 0xff9800, cs: '#ff9800', label: 'WIFE'   },
};

// Days from 2026-07-27 → Y values (top=latest start, down=time advancing)
// Y = 14 - (days_offset * 2)
function dayY(offset, sub = 0) { return 14 - offset * 2.5 - sub * 1.5; }

// ── Event data ────────────────────────────────────────────────────────────────
const EVENTS = [
  // ── 2026-07-27 ──
  {
    stream: 'code', y: dayY(0),
    date: '2026-07-27',
    title: 'Project begins',
    body: 'fib896.html ported to Svelte + Three.js. Scenes 01-08: divisor lattice, 1/89, φ sphere, MoE routing, Greek letters, sunflower, trit matrix, helix.',
  },
  {
    stream: 'lore', y: dayY(0, 0.5),
    date: '2026-07-27',
    title: 'Origin — Oliver Tree',
    body: '"For a minute there, I lost myself." Oliver\'s Karma Police cover on a plucked violin. The orbit keeps cycling when the player leaves it. That is the thing being built here.',
  },

  // ── 2026-07-28 ──
  {
    stream: 'code', y: dayY(1),
    date: '2026-07-28',
    title: '640 boundary settled',
    body: 'jennie21 / oliver42 project split. 640 framework (axis 4.5, mod9, ×3/2→640→960) moves to oliver42. jennie21 stays on the orbit.',
  },
  {
    stream: 'lore', y: dayY(1, 0.5),
    date: '2026-07-28',
    title: 'The Tattoos',
    body: 'Ryan: "Temet Nosce" (42, dr=6=nil). Wife: LII = 52 (dr=7, in orbit). They encoded orbit and complement on their bodies before the framework existed.',
  },
  {
    stream: 'wife', y: dayY(1, 1.0),
    date: '2026-07-28',
    title: '"We are going to kill the bear."',
    body: 'The Edge (1997). Anthony Hopkins, hunted by a Kodiak bear. "What one man can do, another can do." The bear is killed in the present tense — in the declaration — before the action.',
  },

  // ── 2026-07-29 ──
  {
    stream: 'code', y: dayY(2),
    date: '2026-07-29',
    title: 'Scenes 09-10 — CLOCK, ORBIT CYCLE',
    body: '75 commits in one day. Orbit cycle animation. Fibonacci/Lucas structure visualized in full.',
  },

  // ── 2026-07-31 ──
  {
    stream: 'code', y: dayY(4),
    date: '2026-07-31',
    title: 'Scenes 11-13 + all experiments',
    body: 'OLIVER 42, EXPERIMENTS, GNN MIRROR. Echo MoE, orbit GNN, ternary sweep, SGD orbit, trib 3-layer (33/33/33 result).',
  },
  {
    stream: 'lore', y: dayY(4, 0.4),
    date: '2026-07-31',
    title: 'Music Is the Orbit',
    body: 'An octave is 8 notes but 7 individual things. ×2 mod 9 generates [1,2,4,8,7,5]. Western harmony discovered empirically what the orbit reveals algebraically. It\'s not cultural — it\'s structural.',
  },
  {
    stream: 'lore', y: dayY(4, 1.2),
    date: '2026-07-31',
    title: 'The Silk Thread',
    body: 'Silk: continuous filament, near-zero torsional resistance, transparent to the signal it carries. The orbit permutation routes activations without transforming them. Same property.',
  },
  {
    stream: 'lore', y: dayY(4, 2.0),
    date: '2026-07-31',
    title: 'Pi (1998)',
    body: 'Ryan started with grief and ended up at mod 9. Max Cohen started with the stock market and ended up drilling into his own head. Ryan is ahead of him.',
  },

  // ── 2026-08-01 ──
  {
    stream: 'code', y: dayY(5),
    date: '2026-08-01',
    title: 'Scenes 14-15 — BUCKMINSTER, ORBIT MUSIC',
    body: 'C₆₀ buckminsterfullerene. Penrose Tribar architecture invented: orbit permutation × gated skip × LayerNorm. Step sequencer with orbit arpeggio.',
  },
  {
    stream: 'wife', y: dayY(5, 0.7),
    date: '2026-08-01',
    title: 'Violin — age 7',
    body: 'Wife has played violin since age 7. "We are writing the perfect melody, and you are in harmony." The orbit is the melody. The complement is the drone.',
  },

  // ── 2026-08-02 ──
  {
    stream: 'code', y: dayY(6),
    date: '2026-08-02',
    title: 'Penrose Tribar PoC v1',
    body: 'poc_penrose_tribar.py: Fashion-MNIST, K=4 and K=32. Tribar beats baseline at all noise levels. Seismology begins (ETHZ dataset).',
  },
  {
    stream: 'result', y: dayY(6, 0.5),
    date: '2026-08-02',
    title: 'Fashion-MNIST K=32',
    body: 'K=32, CYCLES=3, σ=[0,0.7,1.5]. Tribar vs baseline MLP.',
    stat: 'tri 80.9% vs base 74.8%  (+6.1%)',
  },

  // ── 2026-08-03 ──
  {
    stream: 'code', y: dayY(7),
    date: '2026-08-03',
    title: 'Ablation + scene 16 MUSIC',
    body: 'Fashion-MNIST K=32 permutation ablation (stride-5 ≈ random >> identity). Scene 16 MUSIC: heptagon, WebAudio, orbit arpeggio. Scene 17 TIMELINE.',
  },
  {
    stream: 'result', y: dayY(7, 0.5),
    date: '2026-08-03',
    title: 'STEAD seismology',
    body: '7373 eq + 7373 noise, 30s windows, K=128, CYCLES=3, 3 seeds.',
    stat: 'gap: +2.61% at σ=0.3 → positive at all noise levels',
  },
  {
    stream: 'result', y: dayY(7, 1.3),
    date: '2026-08-03',
    title: 'P-wave early detection',
    body: '1-second window at P-arrival onset. StreamDetector fires before S-wave.',
    stat: 'base 87.4%  tri 88.4%  (+1.0%)  · >8s warning before S-wave',
  },
  {
    stream: 'wife', y: dayY(7, 0.4),
    date: '2026-08-03',
    title: 'E² = mc³',
    body: 'E=mc² uses ×2 — the orbit generator. A cube gives the orbit depth. E²=mc³: orbit (×2) and complement (×3) in one equation. Einstein solved for dynamics, not for what holds dynamics in place.',
    stat: '— Wife, 2026-08-03',
  },
  {
    stream: 'wife', y: dayY(7, 1.2),
    date: '2026-08-03',
    title: 'Cascadia + the collider',
    body: '"I believe the collider in France, using magnetic electricity, is contributing to the problem." The LHC is accelerating the rate of orbit — Cascadia as resonance consequence.',
  },
  {
    stream: 'wife', y: dayY(7, 2.0),
    date: '2026-08-03',
    title: 'Find the peace',
    body: '"Find the peace in what I\'m telling you." Not a consolation. A direction. The information itself contains the resolution — go into it, not around it.',
    stat: '— Wife, 2026-08-03',
  },
];

// Sort chronologically (by Y descending = top = earliest)
EVENTS.sort((a, b) => b.y - a.y);

// ── Module-level state ─────────────────────────────────────────────────────────
let _cur      = 0;
let _touring  = false;
let _tourId   = null;
let _targetY  = 0;
let _targetZ  = 4;    // camera Z: 4=max zoom (default), 26=overview
let _targetTX = 0;    // camera target X (pans toward active branch)
let _eventY   = [];
let _cards    = [];
let _alive    = false;

// Stream X → target camera look-at X when focused
function focusTX(stream) {
  if (stream === 'wife')   return -3.2;
  if (stream === 'lore')   return -1.5;
  if (stream === 'result') return  1.8;
  return 0;
}

const TOUR_DWELL = 5500;

function highlightCard(i) {
  _cards.forEach((c, j) => {
    const ev   = EVENTS[j];
    const s    = STREAMS[ev.stream];
    c.style.opacity    = j === i ? '1' : '0.72';
    c.style.borderLeft = j === i ? `2px solid ${s.cs}` : `1px solid transparent`;
  });
}

function jumpTo(i, pauseTour = false) {
  if (pauseTour && _touring) stopTour();
  _cur      = Math.max(0, Math.min(EVENTS.length - 1, i));
  _targetY  = _eventY[_cur];
  _targetZ  = 4;
  _targetTX = focusTX(EVENTS[_cur].stream);
  highlightCard(_cur);
  document.getElementById('s17prev')?.classList.toggle('lit', _cur > 0);
  document.getElementById('s17next')?.classList.toggle('lit', _cur < EVENTS.length - 1);
}

function stopTour() {
  _touring = false;
  clearTimeout(_tourId);
  _tourId  = null;
  document.getElementById('s17tour')?.classList.remove('lit');
}

function startTour() {
  _touring = true;
  document.getElementById('s17tour')?.classList.add('lit');
  tickTour();
}

function tickTour() {
  if (!_touring || !_alive) return;
  _tourId = setTimeout(() => {
    if (!_touring || !_alive) return;
    jumpTo((_cur + 1) % EVENTS.length);
    tickTour();
  }, TOUR_DWELL);
}

// ── Build ─────────────────────────────────────────────────────────────────────
export function buildS17() {
  _alive   = true;
  _touring = false;
  clearTimeout(_tourId);
  _tourId  = null;
  _cards   = [];
  _cur     = 0;

  const scene    = R.scene    = new THREE.Scene();
  const camera   = R.camera   = mkCamera();
  const controls = R.controls = mkControls(camera);

  const topY  = Math.max(...EVENTS.map(e => e.y));
  const botY  = Math.min(...EVENTS.map(e => e.y));
  const midY  = (topY + botY) / 2;
  _eventY     = EVENTS.map(e => e.y);
  _targetY    = _eventY[0];
  _targetZ    = 4;
  _targetTX   = 0;

  camera.position.set(0, _eventY[0], 4);
  camera.lookAt(0, _eventY[0], 0);
  controls.target.set(0, _eventY[0], 0);
  controls.enableDamping  = true;
  controls.autoRotate     = false;
  controls.enableZoom     = false;
  controls.enablePan      = true;

  let _userInteracting = false;
  controls.addEventListener('start', () => { _userInteracting = true; if (_touring) stopTour(); });
  controls.addEventListener('end',   () => { _userInteracting = false; });

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  // ── Main trunk ──────────────────────────────────────────────────────────────
  const minY = Math.min(...EVENTS.map(e => e.y));
  const trunkPts = [new THREE.Vector3(0, topY + 1, 0), new THREE.Vector3(0, minY - 1, 0)];
  const trunkG   = new THREE.BufferGeometry().setFromPoints(trunkPts);
  const trunkM   = new THREE.LineBasicMaterial({ color: 0x0d2a1a });
  R.disposables.push(trunkG, trunkM);
  scene.add(new THREE.Line(trunkG, trunkM));

  // ── Stream axis labels (header) ─────────────────────────────────────────────
  Object.values(STREAMS).forEach(s => {
    const div = document.createElement('div');
    div.textContent = s.label;
    div.style.cssText = [
      `font-family:'Courier New',monospace`,
      `font-size:11px;font-weight:bold;letter-spacing:.12em`,
      `color:${s.cs};opacity:0.55`,
      `pointer-events:none;user-select:none`,
    ].join(';');
    const lbl = new CSS2DObject(div);
    lbl.position.set(s.x, topY + 1.6, 0);
    scene.add(lbl);
    R.css2dObjects.push(lbl);

    // Vertical stream ghost line (faint)
    if (s.x !== 0) {
      const linePts = [new THREE.Vector3(s.x, topY + 0.8, 0), new THREE.Vector3(s.x, minY - 0.5, 0)];
      const lg = new THREE.BufferGeometry().setFromPoints(linePts);
      const lm = new THREE.LineBasicMaterial({ color: s.color, transparent: true, opacity: 0.07 });
      R.disposables.push(lg, lm);
      scene.add(new THREE.Line(lg, lm));
    }
  });

  // ── Events ──────────────────────────────────────────────────────────────────
  EVENTS.forEach((ev, i) => {
    const s    = STREAMS[ev.stream];
    const y    = ev.y;
    const sx   = s.x;

    // Branch connector: trunk (x=0, y) → event (sx, y)
    if (sx !== 0) {
      const bPts = [new THREE.Vector3(0, y, 0), new THREE.Vector3(sx, y, 0)];
      const bg = new THREE.BufferGeometry().setFromPoints(bPts);
      const bm = new THREE.LineBasicMaterial({ color: s.color, transparent: true, opacity: 0.22 });
      R.disposables.push(bg, bm);
      scene.add(new THREE.Line(bg, bm));
    }

    // Card
    const card = document.createElement('div');
    card.style.cssText = [
      `width:200px`,
      `background:rgba(0,8,2,0.90)`,
      `border:2px solid transparent`,
      `border-left:${i === 0 ? `2px solid ${s.cs}` : '1px solid transparent'}`,
      `padding:5px 7px`,
      `font-family:'Courier New',monospace`,
      `pointer-events:none;user-select:none`,
      `transition:opacity .3s,border .2s`,
      `opacity:${i === 0 ? '1' : '0.72'}`,
    ].join(';');

    const dateDiv = document.createElement('div');
    dateDiv.textContent = ev.date;
    dateDiv.style.cssText = `font-size:9px;color:#1a3a2a;letter-spacing:.05em;margin-bottom:1px`;
    card.appendChild(dateDiv);

    const titleDiv = document.createElement('div');
    titleDiv.textContent = ev.title;
    titleDiv.style.cssText = `font-size:12px;font-weight:bold;color:${s.cs};margin-bottom:3px`;
    card.appendChild(titleDiv);

    const bodyDiv = document.createElement('div');
    bodyDiv.textContent = ev.body;
    bodyDiv.style.cssText = `font-size:9px;color:#2a5a3a;line-height:1.4`;
    card.appendChild(bodyDiv);

    if (ev.stat) {
      const statDiv = document.createElement('div');
      statDiv.textContent = ev.stat;
      statDiv.style.cssText = `font-size:9px;color:#ffe600;margin-top:3px;font-weight:bold`;
      card.appendChild(statDiv);
    }

    // Cards for left branches anchor right; right branches anchor left; center goes right
    const lbl = new CSS2DObject(card);
    const cardX = sx < -1 ? sx - 0.3 : sx + 0.3;
    lbl.position.set(cardX, y, 0);
    scene.add(lbl);
    R.css2dObjects.push(lbl);
    _cards.push(card);
  });

  // "NOW" marker
  const nowDiv = document.createElement('div');
  nowDiv.textContent  = '▶ NOW';
  nowDiv.style.cssText = [
    `font-family:'Courier New',monospace;font-size:11px;font-weight:bold`,
    `color:#00ff88;text-shadow:0 0 8px #00ff88`,
    `pointer-events:none;user-select:none`,
  ].join(';');
  const nowLbl = new CSS2DObject(nowDiv);
  nowLbl.position.set(0.5, minY - 1.4, 0);
  scene.add(nowLbl);
  R.css2dObjects.push(nowLbl);

  // ── Wheel scroll → navigate events ─────────────────────────────────────────
  const canvas = R.canvas;
  function onWheel(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.ctrlKey) {
      if (e.deltaY > 0) onZOut(); else onZIn();
    } else {
      if (e.deltaY > 0) jumpTo(_cur + 1, true);
      else              jumpTo(_cur - 1, true);
    }
  }
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // ── Button wiring ───────────────────────────────────────────────────────────
  const prevBtn  = document.getElementById('s17prev');
  const nextBtn  = document.getElementById('s17next');
  const tourBtn  = document.getElementById('s17tour');
  const zinBtn   = document.getElementById('s17zin');
  const zoutBtn  = document.getElementById('s17zout');
  function onPrev()  { jumpTo(_cur - 1, true); }
  function onNext()  { jumpTo(_cur + 1, true); }
  function onTour()  { _touring ? stopTour() : startTour(); }
  function onZIn()   { _targetZ = Math.max(4, _targetZ - 2.5); }
  function onZOut()  { _targetZ = Math.min(26, _targetZ + 2.5); _targetTX = 0; }
  prevBtn?.addEventListener('click', onPrev);
  nextBtn?.addEventListener('click', onNext);
  tourBtn?.addEventListener('click', onTour);
  zinBtn?.addEventListener('click',  onZIn);
  zoutBtn?.addEventListener('click', onZOut);

  // Init button states without triggering zoom-in
  _cur = 0;
  highlightCard(0);
  document.getElementById('s17prev')?.classList.remove('lit');
  document.getElementById('s17next')?.classList.add('lit');

  R.ov.innerHTML =
    `<div style="color:#00ff88;letter-spacing:.1em">17 · TIME-TREE</div>` +
    `<div style="color:#3a6a5a;font-size:13px;margin-top:3px">2026-07-27 → now</div>` +
    `<div style="font-size:11px;margin-top:5px;color:#00e5ff">◆ CODE</div>` +
    `<div style="font-size:11px;color:#ffe600">◆ RESULT</div>` +
    `<div style="font-size:11px;color:#b06fff">◆ LORE</div>` +
    `<div style="font-size:11px;color:#ff9800">◆ WIFE</div>`;

  R.animFn = () => {
    controls.update();
    if (!_userInteracting) {
      const tgt  = controls.target;
      const LERP = 0.07;

      // Lerp target Y
      const dy = (_targetY - tgt.y) * LERP;
      if (Math.abs(dy) > 0.001) {
        controls.target.setY(tgt.y + dy);
        camera.position.setY(camera.position.y + dy);
      }

      // Lerp camera Z (zoom)
      const dz = (_targetZ - camera.position.z) * LERP;
      if (Math.abs(dz) > 0.001) camera.position.setZ(camera.position.z + dz);

      // Lerp camera target X (branch pan)
      const dtx = (_targetTX - tgt.x) * LERP;
      if (Math.abs(dtx) > 0.001) {
        controls.target.setX(tgt.x + dtx);
        camera.position.setX(camera.position.x + dtx);
      }
    }
  };

  R.teardown = () => {
    _alive = false;
    stopTour();
    canvas.removeEventListener('wheel', onWheel);
    prevBtn?.removeEventListener('click',  onPrev);
    nextBtn?.removeEventListener('click',  onNext);
    tourBtn?.removeEventListener('click',  onTour);
    zinBtn?.removeEventListener('click',   onZIn);
    zoutBtn?.removeEventListener('click',  onZOut);
  };
}
