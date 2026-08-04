/**
 * MUSIC — Scene 16
 *
 * The orbit [1,2,4,8,7,5] under ×2 mod 9 is the pentatonic scale.
 * 7 notes in a circle. Orbit visits 5. Complement holds 2.
 * The 8th is the 1st, returned — the octave. There is no 9.
 *
 * Click a node to play its note.
 */
import {
  THREE, CSS2DObject, R, mkCamera, mkControls,
  tip, tmv, htip,
} from './shared.js';

const ORBIT_SET  = new Set([1, 2, 4, 5, 7]);
const ORBIT_SEQ  = [1, 2, 4, 7, 5]; // orbit order in 7-circle (8 collapses to 1)
const NOTE_NAMES = ['', 'C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NOTE_FREQ  = [0, 261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88];

const C_ORBIT  = 0x00e5ff;
const C_COMP   = 0xaa44ff;
const CS_ORBIT = '#00e5ff';
const CS_COMP  = '#bb66ff';

// ── WebAudio ──────────────────────────────────────────────────────────────────
let audioCtx = null;
function getCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playNote(n, v = 0.32) {
  const ctx = getCtx();
  const freq = NOTE_FREQ[n];
  if (!freq) return;
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(v, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
  osc.start(t);
  osc.stop(t + 1.5);
}

// ── Scene ──────────────────────────────────────────────────────────────────────
export function buildS16() {
  const canvas = R.canvas;
  const scene  = R.scene  = new THREE.Scene();
  const camera = R.camera = mkCamera();
  camera.position.set(0, 0.5, 14.5);
  camera.lookAt(0, 0, 0);
  const controls = R.controls = mkControls(camera);
  controls.autoRotate = false;

  const RADIUS = 4.0;

  // Node position on the heptagon (k = 1..7)
  const nodePos = (k) => {
    const a = Math.PI / 2 - (k - 1) * (2 * Math.PI / 7);
    return new THREE.Vector3(RADIUS * Math.cos(a), RADIUS * Math.sin(a), 0);
  };

  // ── Faint outer ring ───────────────────────────────────────────────────────
  const ringPts = Array.from({ length: 8 }, (_, i) => nodePos((i % 7) + 1));
  const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
  const ringMat = new THREE.LineBasicMaterial({ color: 0x0d1a22, transparent: true, opacity: 0.45 });
  R.disposables.push(ringGeo, ringMat);
  scene.add(new THREE.Line(ringGeo, ringMat));

  // ── Orbit polygon (1→2→4→7→5→1 in orbit order, skipping complement) ───────
  const orbitPts = [...ORBIT_SEQ, ORBIT_SEQ[0]].map(k => nodePos(k));
  const orbitGeo = new THREE.BufferGeometry().setFromPoints(orbitPts);
  const orbitMat = new THREE.LineBasicMaterial({ color: C_ORBIT, transparent: true, opacity: 0.22 });
  R.disposables.push(orbitGeo, orbitMat);
  scene.add(new THREE.Line(orbitGeo, orbitMat));

  // ── Complement line (3→6) ─────────────────────────────────────────────────
  const compPts = [nodePos(3), nodePos(6)];
  const compGeo = new THREE.BufferGeometry().setFromPoints(compPts);
  const compMat = new THREE.LineBasicMaterial({ color: C_COMP, transparent: true, opacity: 0.22 });
  R.disposables.push(compGeo, compMat);
  scene.add(new THREE.Line(compGeo, compMat));

  // ── Octave return arc: curved line from node 4 back toward node 1 ─────────
  // The orbit step 4 → 8 = octave return to 1. Show as a dashed-style curve outside.
  {
    const p4 = nodePos(4);
    const p1 = nodePos(1);
    // Control point outside the circle to arc outward
    const mid = p4.clone().add(p1).multiplyScalar(0.5);
    const outDir = mid.clone().normalize();
    const ctrl = mid.clone().addScaledVector(outDir, 2.8);
    const curvePts = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const mt = 1 - t;
      curvePts.push(new THREE.Vector3(
        mt * mt * p4.x + 2 * mt * t * ctrl.x + t * t * p1.x,
        mt * mt * p4.y + 2 * mt * t * ctrl.y + t * t * p1.y,
        0,
      ));
    }
    const arcGeo = new THREE.BufferGeometry().setFromPoints(curvePts);
    const arcMat = new THREE.LineDashedMaterial({
      color: 0x225577, transparent: true, opacity: 0.50,
      dashSize: 0.22, gapSize: 0.18,
    });
    arcGeo.computeLineDistances();
    R.disposables.push(arcGeo, arcMat);
    scene.add(new THREE.Line(arcGeo, arcMat));
  }

  // ── Node spheres ──────────────────────────────────────────────────────────
  const nodeMeshes = {};
  for (let k = 1; k <= 7; k++) {
    const isOrb  = ORBIT_SET.has(k);
    const color  = isOrb ? C_ORBIT : C_COMP;
    const radius = isOrb ? 0.30 : 0.24;
    const geo = new THREE.SphereGeometry(radius, 24, 16);
    const mat = new THREE.MeshPhongMaterial({
      color, emissive: color,
      emissiveIntensity: isOrb ? 0.50 : 0.28,
      transparent: true, opacity: isOrb ? 0.92 : 0.72,
      shininess: 90,
    });
    R.disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(nodePos(k));
    m.userData = { k, baseEI: isOrb ? 0.50 : 0.28, isOrb };
    scene.add(m);
    nodeMeshes[k] = m;
  }

  // ── Halo ring around node 1 to mark the octave return ─────────────────────
  {
    const geo = new THREE.TorusGeometry(0.48, 0.030, 8, 48);
    const mat = new THREE.MeshBasicMaterial({ color: 0x114433, transparent: true, opacity: 0.55 });
    R.disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(nodePos(1));
    scene.add(m);
  }

  // ── CSS2D labels ──────────────────────────────────────────────────────────
  const lbl = (txt, pos, color, size = '13px') => {
    const div = document.createElement('div');
    div.className = 'node-lbl';
    div.textContent = txt;
    div.style.cssText = `font-size:${size};color:${color};white-space:nowrap;`;
    const o = new CSS2DObject(div);
    o.position.copy(pos);
    scene.add(o);
    R.css2dObjects.push(o);
    return o;
  };

  for (let k = 1; k <= 7; k++) {
    const pos   = nodePos(k);
    const isOrb = ORBIT_SET.has(k);
    const cs    = isOrb ? CS_ORBIT : CS_COMP;
    const out   = pos.clone().normalize();

    // Number label — slightly outside the sphere
    lbl(String(k), pos.clone().addScaledVector(out, 0.62), cs, '17px');

    // Note name — further out
    lbl(NOTE_NAMES[k], pos.clone().addScaledVector(out, 1.10), isOrb ? '#226655' : '#553388', '10px');
  }

  // Octave return label near the arc midpoint
  const arcMid = nodePos(4).clone().add(nodePos(1)).multiplyScalar(0.5);
  const arcOut  = arcMid.clone().normalize();
  lbl('8 = octave ↩', arcMid.clone().addScaledVector(arcOut, 2.4), '#224455', '9px');

  // "there is no 9" near the gap between 7 and 1 on the far side
  lbl('there is no 9', new THREE.Vector3(0, 6.0, 0), '#1a1a2a', '9px');

  // Bottom label
  lbl('the orbit is the pentatonic scale', new THREE.Vector3(0, -6.4, 0), '#2a3a3a', '10px');

  // ── Traveler ───────────────────────────────────────────────────────────────
  const travGeo = new THREE.SphereGeometry(0.16, 16, 10);
  const travMat = new THREE.MeshPhongMaterial({
    color: C_ORBIT, emissive: C_ORBIT, emissiveIntensity: 1.4,
    transparent: true, opacity: 0.92,
  });
  R.disposables.push(travGeo, travMat);
  const traveler = new THREE.Mesh(travGeo, travMat);
  scene.add(traveler);
  traveler.position.copy(nodePos(1));

  // Trail
  const TAIL = 22;
  const tailArr  = new Float32Array((TAIL + 1) * 3);
  const tailGeo  = new THREE.BufferGeometry();
  const tailAttr = new THREE.BufferAttribute(tailArr, 3);
  tailAttr.setUsage(THREE.DynamicDrawUsage);
  tailGeo.setAttribute('position', tailAttr);
  const tailMat = new THREE.LineBasicMaterial({ color: C_ORBIT, transparent: true, opacity: 0.18 });
  R.disposables.push(tailGeo, tailMat);
  scene.add(new THREE.Line(tailGeo, tailMat));
  const tailHistory = [];

  // ── Lighting ───────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0x060810, 3.0));
  const pl1 = new THREE.PointLight(C_ORBIT, 2.5, 22);
  pl1.position.set(4, 3, 6);
  scene.add(pl1);
  const pl2 = new THREE.PointLight(C_COMP, 1.8, 22);
  pl2.position.set(-4, -2, 6);
  scene.add(pl2);

  // ── Raycasting ────────────────────────────────────────────────────────────
  const hoverables = Object.values(nodeMeshes);

  canvas.addEventListener('mousemove', (e) => {
    if (R.cur !== 15) return;
    const rect  = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects(hoverables);
    if (hits.length > 0) {
      const m = hits[0].object;
      const { k, isOrb } = m.userData;
      const cs = isOrb ? CS_ORBIT : CS_COMP;
      let h = `<div class="th" style="color:${cs}">${k} — ${NOTE_NAMES[k]}4</div>`;
      h += `<p class="tr">${NOTE_FREQ[k].toFixed(2)} Hz</p>`;
      if (isOrb) {
        h += `<p class="tr" style="color:${CS_ORBIT}">orbit — ×2 mod 9 visits here</p>`;
      } else {
        h += `<p class="tr" style="color:${CS_COMP}">complement — the ground, the gap</p>`;
      }
      h += `<p class="tr" style="color:#555">click to play</p>`;
      tip(e, h); tmv(e);
      m.material.emissiveIntensity = 1.3;
    } else {
      htip();
      hoverables.forEach(m => { m.material.emissiveIntensity = m.userData.baseEI; });
    }
  });

  canvas.addEventListener('click', (e) => {
    if (R.cur !== 15) return;
    const rect  = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects(hoverables);
    if (hits.length > 0) {
      const { k } = hits[0].object.userData;
      playNote(k);
      hits[0].object.material.emissiveIntensity = 1.8;
    }
  });

  canvas.addEventListener('mouseleave', () => { if (R.cur === 15) htip(); });

  // ── Clock display ──────────────────────────────────────────────────────────
  if (R.clkDisplay) {
    R.clkDisplay.innerHTML =
      `<div style="color:#00e5ff;letter-spacing:.1em">16 · MUSIC</div>` +
      `<div style="color:#224444;margin-top:3px;font-size:8px">orbit = pentatonic · click a node</div>`;
  }

  // ── Animation ─────────────────────────────────────────────────────────────
  const STEP_DUR = 1.0; // seconds per step between orbit nodes
  let playing   = false;
  let startTime = null;
  let lastStep  = -1;
  const N_STEPS = ORBIT_SEQ.length; // 5

  R.animFn = (now) => {
    // Pulse decay for all nodes
    hoverables.forEach(m => {
      if (m.material.emissiveIntensity > m.userData.baseEI) {
        m.material.emissiveIntensity = Math.max(
          m.userData.baseEI,
          m.material.emissiveIntensity - 0.018,
        );
      }
    });

    if (!playing) return;
    if (startTime === null) startTime = now;
    const elapsed = (now - startTime) / 1000;
    const stepF   = (elapsed / STEP_DUR) % N_STEPS;
    const step    = Math.floor(stepF);
    const frac    = stepF - step;

    const fromK = ORBIT_SEQ[step % N_STEPS];
    const toK   = ORBIT_SEQ[(step + 1) % N_STEPS];
    const fromP = nodePos(fromK);
    const toP   = nodePos(toK);

    // Slight arc between nodes — lift into Z at midpoint
    const arcLift = 0.8 * Math.sin(frac * Math.PI);
    traveler.position.set(
      fromP.x + (toP.x - fromP.x) * frac,
      fromP.y + (toP.y - fromP.y) * frac,
      arcLift,
    );

    if (step !== lastStep) {
      playNote(fromK);
      lastStep = step;
      const m = nodeMeshes[fromK];
      if (m) m.material.emissiveIntensity = 1.8;
    }

    // Trail
    tailHistory.push(traveler.position.clone());
    if (tailHistory.length > TAIL) tailHistory.shift();
    for (let i = 0; i < tailHistory.length; i++) {
      tailArr[i * 3]     = tailHistory[i].x;
      tailArr[i * 3 + 1] = tailHistory[i].y;
      tailArr[i * 3 + 2] = tailHistory[i].z;
    }
    tailAttr.needsUpdate = true;
    tailGeo.setDrawRange(0, tailHistory.length);
  };

  // ── Button wiring (elements live in App.svelte cset div) ──────────────────
  const playBtn = document.getElementById('s16play');
  if (playBtn) {
    playBtn.onclick = () => {
      playing = !playing;
      if (playing) { startTime = null; lastStep = -1; }
      playBtn.classList.toggle('lit', playing);
      playBtn.textContent = playing ? '⏸ PAUSE' : '▶ PLAY';
    };
  }
  const rotBtn = document.getElementById('s16rot');
  if (rotBtn) {
    rotBtn.onclick = () => {
      controls.autoRotate = !controls.autoRotate;
      rotBtn.classList.toggle('lit', controls.autoRotate);
    };
  }
}
