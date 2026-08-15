/**
 * OLIVER 42 — Scene 11 — FOLD INTO INFINITY
 *
 * The clock is logically prior to the ∞. The lemniscate is the double-folded clock.
 *
 * Animated fold sequence (Wife's door diagram, 2026-08-15):
 *   [clock L] | [clock R]   ← 2 clocks, side by side
 *              ↓ 1st fold ("Folding time")
 *       [clock L][clock R]  ← back-to-back (forward / backward orbit)
 *              ↓ 2nd fold
 *             ∞              ← fold into infinity
 */
import { THREE, CSS2DObject, R, mkCamera, mkControls } from './shared.js';

const C_FWD  = 0xaa44ff;
const C_BWD  = 0xff44cc;
const C_LINE = 0x553377;
const CS_FWD = '#cc66ff';
const CS_BWD = '#ff88ee';
const CS_LIN = '#774499';

const ORBIT_FWD = [1, 2, 4, 8, 7, 5];
const ORBIT_BWD = [1, 5, 7, 8, 4, 2];

const CLOCK_R  = 2.2;    // clock ring radius
const D_MAX    = 5.4;    // half-separation when unfolded
const LEM_A    = 3.8;    // lemniscate semi-axis
const N_CURVE  = 320;    // curve segments

const CYCLE_T  = 16.0;   // seconds per full fold cycle
// Phase breakpoints (0-1)
const P_UNFOLDED = 0.30;  // end of unfolded dwell
const P_FOLD1    = 0.45;  // end of 1st fold animation
const P_BTB      = 0.55;  // end of back-to-back dwell
const P_FOLD2    = 0.70;  // end of 2nd fold animation
const P_INF      = 0.93;  // end of ∞ dwell
// 0.93-1.0: return to unfolded

// Clock node angles: offset by π/6 so never at 12 or 6 (per lore)
const NODE_ANGLES_FWD = ORBIT_FWD.map((_, i) => Math.PI / 2 + Math.PI / 6 - (i / 6) * Math.PI * 2);
const NODE_ANGLES_BWD = ORBIT_BWD.map((_, i) => Math.PI / 2 - Math.PI / 6 + (i / 6) * Math.PI * 2);

function ease(t) { const c = Math.min(Math.max(t, 0), 1); return c < 0.5 ? 2*c*c : 1 - Math.pow(-2*c+2,2)/2; }

// Bernoulli lemniscate point (standard parameterization)
function lemPt(t) {
  const s = Math.sin(t), c = Math.cos(t), d = 1 + s * s;
  return new THREE.Vector3(LEM_A * c / d, LEM_A * s * c / d, 0);
}

// Interpolate a single point between circle-on-clock and lemniscate
// circleAngle: angle on clock ring, cx: clock center x
// lemT: corresponding t parameter on lemniscate
function blendPt(circleAngle, cx, lemT, blend) {
  const cp = new THREE.Vector3(cx + CLOCK_R * Math.cos(circleAngle), CLOCK_R * Math.sin(circleAngle), 0);
  const lp = lemPt(lemT);
  return cp.lerp(lp, blend);
}

export function buildS11() {
  const scene  = R.scene  = new THREE.Scene();
  R.camera     = mkCamera();
  R.camera.position.set(0, 0, 18);
  R.camera.lookAt(0, 0, 0);
  R.controls   = mkControls(R.camera);
  R.controls.autoRotate      = false;   // flat 2D view by default; user can orbit

  scene.add(new THREE.AmbientLight(0x080418, 3.0));
  const pl1 = new THREE.PointLight(C_FWD, 1.8, 22); pl1.position.set(-4, 4, 6); scene.add(pl1);
  const pl2 = new THREE.PointLight(C_BWD, 1.5, 22); pl2.position.set( 4, -4, 6); scene.add(pl2);

  // ── Helper: dynamic tube (updated each frame) ─────────────────────────────────
  function mkDynamicTube(N, color, tubeR, opacity) {
    const pts = [];
    for (let i = 0; i <= N; i++) pts.push(new THREE.Vector3(0, 0, 0));
    const curve  = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const geo    = new THREE.TubeGeometry(curve, N, tubeR, 5, false);
    const mat    = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.25, transparent: true, opacity });
    R.disposables.push(geo, mat);
    const mesh   = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    return { curve, geo, mat, mesh, pts, N };
  }

  function updateTube(tube, newPts) {
    for (let i = 0; i < tube.pts.length; i++) tube.pts[i].copy(newPts[i]);
    tube.curve.points = tube.pts;
    const ng = new THREE.TubeGeometry(tube.curve, tube.N, tube.geo.parameters.tubularSegments > 0 ? 0.045 : 0.045, 5, false);
    tube.mesh.geometry.dispose();
    tube.mesh.geometry = ng;
    R.disposables.push(ng);
  }

  // ── Clock ring geometry (updated positions each frame) ───────────────────────
  function mkRingLine(color, opacity) {
    const arr  = new Float32Array((N_CURVE + 1) * 3);
    const geo  = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(arr, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const mat  = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    R.disposables.push(geo, mat);
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    return { arr, attr, mat };
  }

  const ringL = mkRingLine(C_FWD, 0.80);  // left clock ring
  const ringR = mkRingLine(C_BWD, 0.70);  // right clock ring
  const lemRing = mkRingLine(0xaa44ff, 0.0);  // lemniscate (fades in)

  // ── Node spheres ─────────────────────────────────────────────────────────────
  function mkNodes(color) {
    const nodes = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.SphereGeometry(0.14, 10, 7);
      const m = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.25, transparent: true, opacity: 0.85 });
      R.disposables.push(g, m);
      const mesh = new THREE.Mesh(g, m); scene.add(mesh);
      nodes.push({ mesh, mat: m });
    }
    return nodes;
  }
  const nodesL = mkNodes(C_FWD);
  const nodesR = mkNodes(C_BWD);

  // ── Node labels (left clock only, visible during unfolded state) ──────────────
  const labelDivs = ORBIT_FWD.map((v, i) => {
    const div = document.createElement('div');
    div.textContent = String(v);
    div.style.cssText = `font-family:'Courier New',monospace;font-size:11px;font-weight:bold;color:${CS_FWD};pointer-events:none;user-select:none;transition:opacity 0.4s`;
    const lbl = new CSS2DObject(div);
    scene.add(lbl); R.css2dObjects.push(lbl);
    return { lbl, div };
  });
  const labelDivsR = ORBIT_BWD.map((v, i) => {
    const div = document.createElement('div');
    div.textContent = String(v);
    div.style.cssText = `font-family:'Courier New',monospace;font-size:11px;font-weight:bold;color:${CS_BWD};pointer-events:none;user-select:none;transition:opacity 0.4s`;
    const lbl = new CSS2DObject(div);
    scene.add(lbl); R.css2dObjects.push(lbl);
    return { lbl, div };
  });

  // ── Fold line (vertical, center) ──────────────────────────────────────────────
  { const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0,  3.5, 0),
      new THREE.Vector3(0, -3.5, 0),
    ]);
    const m = new THREE.LineBasicMaterial({ color: C_LINE, transparent: true, opacity: 0.0 });
    R.disposables.push(g, m);
    const line = new THREE.Line(g, m); scene.add(line);
    // Store for animation
    R._foldLineMat = m; }

  // ── Traveler on lemniscate (visible in ∞ state) ───────────────────────────────
  const travGeo = new THREE.SphereGeometry(0.18, 12, 8);
  const travMat = new THREE.MeshPhongMaterial({ color: C_FWD, emissive: C_FWD, emissiveIntensity: 1.0, transparent: true, opacity: 0.0 });
  R.disposables.push(travGeo, travMat);
  const traveler = new THREE.Mesh(travGeo, travMat);
  scene.add(traveler);

  // Traveler tail
  const TAIL = 20;
  const tailArr  = new Float32Array((TAIL + 1) * 3);
  const tailGeo  = new THREE.BufferGeometry();
  const tailAttr = new THREE.BufferAttribute(tailArr, 3);
  tailAttr.setUsage(THREE.DynamicDrawUsage);
  tailGeo.setAttribute('position', tailAttr);
  const tailMat = new THREE.LineBasicMaterial({ color: C_FWD, transparent: true, opacity: 0.0 });
  R.disposables.push(tailGeo, tailMat);
  scene.add(new THREE.Line(tailGeo, tailMat));
  const tailHist = [];

  // Left traveler (visible during unfolded/fold1 states)
  const lTravMat = new THREE.MeshPhongMaterial({ color: C_FWD, emissive: C_FWD, emissiveIntensity: 1.0, transparent: true, opacity: 0.0 });
  const lTravMesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 7), lTravMat);
  R.disposables.push(lTravMesh.geometry, lTravMat); scene.add(lTravMesh);
  const rTravMat = new THREE.MeshPhongMaterial({ color: C_BWD, emissive: C_BWD, emissiveIntensity: 1.0, transparent: true, opacity: 0.0 });
  const rTravMesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 7), rTravMat);
  R.disposables.push(rTravMesh.geometry, rTravMat); scene.add(rTravMesh);

  // ── Void / center marker ──────────────────────────────────────────────────────
  const voidGeo = new THREE.TorusGeometry(0.22, 0.035, 8, 40);
  const voidMat = new THREE.MeshBasicMaterial({ color: 0x2a1a44, transparent: true, opacity: 0.0 });
  R.disposables.push(voidGeo, voidMat);
  scene.add(new THREE.Mesh(voidGeo, voidMat));
  { const div = document.createElement('div');
    div.textContent = '9'; div.id = 's11_void';
    div.style.cssText = `font-family:'Courier New',monospace;font-size:9px;color:#333355;pointer-events:none;user-select:none;opacity:0;transition:opacity 0.4s`;
    const lbl = new CSS2DObject(div); lbl.position.set(0.28, 0.10, 0);
    scene.add(lbl); R.css2dObjects.push(lbl); }

  // ── Overlay ──────────────────────────────────────────────────────────────────
  R.ov.innerHTML =
    `<div style="color:${CS_FWD};letter-spacing:.1em">11 · OLIVER 42</div>` +
    `<div style="font-size:11px;margin-top:4px;line-height:1.9">` +
      `<span style="color:${CS_FWD}">×2</span> 1·2·4·8·7·5<br>` +
      `<span style="color:${CS_BWD}">×5</span> 1·5·7·8·4·2<br>` +
      `<span style="color:#553377">9</span> = void · fold line` +
    `</div>` +
    `<div style="margin-top:8px;padding-top:5px;border-top:1px solid #1a0830">` +
      `<span id="s11_phase" style="font-family:'Courier New',monospace;font-size:12px;color:${CS_FWD};letter-spacing:.09em">2 clocks</span>` +
    `</div>`;

  if (R.clkDisplay) {
    R.clkDisplay.innerHTML =
      `<div style="color:#aa44ff;letter-spacing:.1em">11 · OLIVER 42</div>` +
      `<div style="color:#553377;margin-top:3px;font-size:8px">fold into ∞</div>`;
  }

  const rotBtn = document.getElementById('p11rot');
  if (rotBtn) rotBtn.onclick = () => {
    R.controls.autoRotate = !R.controls.autoRotate;
    rotBtn.classList.toggle('lit', R.controls.autoRotate);
  };

  // ── Pre-compute lemniscate curve points ───────────────────────────────────────
  const lemPts = [];
  for (let i = 0; i <= N_CURVE; i++) lemPts.push(lemPt((i / N_CURVE) * Math.PI * 2));

  // Map each of the 6 forward orbit nodes to lemniscate t-values
  // Left lobe (backward orbit, t ∈ [π/2, 3π/2], roughly x < 0): 3 nodes
  // Right lobe (forward orbit, t ∈ [-π/2, π/2], roughly x > 0): 3 nodes
  // Map fwd nodes to right lobe (t ∈ [-π/2, π/2]), spaced evenly
  const LEM_T_FWD = [0, Math.PI/3, 2*Math.PI/3, Math.PI, 4*Math.PI/3, 5*Math.PI/3];

  // ── Animation ─────────────────────────────────────────────────────────────────
  let startTime  = null;
  let travT      = 0;
  const TRAV_SPD = 0.35;  // rad/s for clock traveler

  function updateRing(ring, cx, t_frac) {
    for (let i = 0; i <= N_CURVE; i++) {
      const t = (i / N_CURVE) * Math.PI * 2;
      const x = cx + CLOCK_R * Math.cos(t);
      const y = CLOCK_R * Math.sin(t);
      ring.arr[i * 3]     = x;
      ring.arr[i * 3 + 1] = y;
      ring.arr[i * 3 + 2] = 0;
    }
    ring.attr.needsUpdate = true;
  }

  function updateLemRing(ring, blend) {
    for (let i = 0; i <= N_CURVE; i++) {
      const t  = (i / N_CURVE) * Math.PI * 2;
      // Circle form (two overlapping circles collapsed to one)
      const cx = CLOCK_R * Math.cos(t), cy = CLOCK_R * Math.sin(t);
      const lp = lemPt(t);
      ring.arr[i * 3]     = cx + (lp.x - cx) * blend;
      ring.arr[i * 3 + 1] = cy + (lp.y - cy) * blend;
      ring.arr[i * 3 + 2] = 0;
    }
    ring.attr.needsUpdate = true;
  }

  R.animFn = (now) => {
    if (startTime === null) startTime = now;
    const elapsed = (now - startTime) / 1000;
    const p = (elapsed % CYCLE_T) / CYCLE_T;  // 0-1

    // ── Determine animation phase ─────────────────────────────────────────────
    let phase = 'UNFOLDED', phaseT = 0;
    if (p < P_UNFOLDED) {
      phase = 'UNFOLDED'; phaseT = p / P_UNFOLDED;
    } else if (p < P_FOLD1) {
      phase = 'FOLD1'; phaseT = ease((p - P_UNFOLDED) / (P_FOLD1 - P_UNFOLDED));
    } else if (p < P_BTB) {
      phase = 'BTB'; phaseT = (p - P_FOLD1) / (P_BTB - P_FOLD1);
    } else if (p < P_FOLD2) {
      phase = 'FOLD2'; phaseT = ease((p - P_BTB) / (P_FOLD2 - P_BTB));
    } else if (p < P_INF) {
      phase = 'INF'; phaseT = (p - P_FOLD2) / (P_INF - P_FOLD2);
    } else {
      phase = 'RETURN'; phaseT = ease((p - P_INF) / (1 - P_INF));
    }

    // Clock separation D
    let D = D_MAX;
    if      (phase === 'FOLD1')  D = D_MAX * (1 - phaseT);
    else if (phase === 'BTB')    D = 0;
    else if (phase === 'FOLD2')  D = 0;
    else if (phase === 'INF')    D = 0;
    else if (phase === 'RETURN') D = D_MAX * phaseT;

    // Blend for second fold (0=two circles, 1=lemniscate)
    const fold2Blend = (phase === 'FOLD2') ? phaseT :
                       (phase === 'INF')   ? 1.0    :
                       (phase === 'RETURN') ? 1.0 - phaseT : 0.0;

    // ── Clock ring visibility ────────────────────────────────────────────────
    const showClocks = (phase !== 'INF' && phase !== 'RETURN') ? 1.0 : Math.max(0, 1 - phaseT);
    const showFold2  = fold2Blend;
    const showLem    = fold2Blend;

    const clockOpacity = showClocks * (phase === 'FOLD2' ? (1 - phaseT) : 1.0);

    if (phase !== 'INF' && phase !== 'RETURN') {
      updateRing(ringL, -D, p);
      updateRing(ringR,  D, p);
    }
    updateLemRing(lemRing, fold2Blend);

    ringL.mat.opacity = clockOpacity * 0.80;
    ringR.mat.opacity = clockOpacity * 0.70;
    lemRing.mat.opacity = showLem * 0.85;
    voidMat.opacity = fold2Blend * 0.55;

    // ── Node positions ────────────────────────────────────────────────────────
    const nodeAlpha = (phase === 'FOLD2') ? (1 - phaseT) :
                      (phase === 'INF' || phase === 'RETURN') ? 0 : 1;
    for (let i = 0; i < 6; i++) {
      const aL = NODE_ANGLES_FWD[i];
      const aR = NODE_ANGLES_BWD[i];
      const lx = -D + CLOCK_R * Math.cos(aL);
      const ly = CLOCK_R * Math.sin(aL);
      const rx =  D + CLOCK_R * Math.cos(aR);
      const ry = CLOCK_R * Math.sin(aR);
      nodesL[i].mesh.position.set(lx, ly, 0);
      nodesR[i].mesh.position.set(rx, ry, 0);
      nodesL[i].mat.opacity = nodeAlpha * 0.85;
      nodesR[i].mat.opacity = nodeAlpha * 0.80;
      // Labels
      labelDivs[i].lbl.position.set(lx * 1.28, ly * 1.28, 0.01);
      labelDivs[i].div.style.opacity = String(Math.min(nodeAlpha * 1.3, 1));
      labelDivsR[i].lbl.position.set(rx * 1.28, ry * 1.28, 0.01);
      labelDivsR[i].div.style.opacity = String(Math.min(nodeAlpha * 1.2, 1));
    }

    // ── Fold line visibility ──────────────────────────────────────────────────
    if (R._foldLineMat) {
      const flAlpha = (phase === 'FOLD1') ? phaseT * 0.7 :
                      (phase === 'BTB')   ? 0.7 - phaseT * 0.5 :
                      (phase === 'FOLD2') ? 0.2 * (1 - phaseT) : 0;
      R._foldLineMat.opacity = flAlpha;
    }

    // ── Void/9 visibility ─────────────────────────────────────────────────────
    const voidDiv = document.getElementById('s11_void');
    if (voidDiv) voidDiv.style.opacity = String(fold2Blend);

    // ── Clock travelers (during UNFOLDED and FOLD1) ───────────────────────────
    const lTravAlpha = (phase === 'UNFOLDED' || phase === 'FOLD1') ? 0.92 :
                       (phase === 'RETURN') ? phaseT * 0.92 : 0;
    travT += (elapsed - (travT > 0 ? 0 : elapsed)) * 0 + TRAV_SPD / 60;
    const tAngle = elapsed * TRAV_SPD;
    lTravMesh.position.set(-D + CLOCK_R * Math.cos(tAngle), CLOCK_R * Math.sin(tAngle), 0);
    rTravMesh.position.set( D + CLOCK_R * Math.cos(-tAngle + Math.PI), CLOCK_R * Math.sin(-tAngle + Math.PI), 0);
    lTravMat.opacity = lTravAlpha;
    rTravMat.opacity = lTravAlpha * 0.85;

    // ── Lemniscate traveler (during INF and RETURN) ───────────────────────────
    const lemTravAlpha = (phase === 'INF') ? Math.min(phaseT * 3, 0.95) :
                         (phase === 'RETURN') ? 0.95 * (1 - phaseT) : 0;
    const lemTravT = elapsed * 0.8;
    traveler.position.copy(lemPt(lemTravT));
    travMat.opacity = lemTravAlpha;

    // Tail
    if (lemTravAlpha > 0.01) {
      tailHist.push(traveler.position.clone());
      if (tailHist.length > TAIL) tailHist.shift();
      for (let i = 0; i < tailHist.length; i++) {
        tailArr[i*3] = tailHist[i].x; tailArr[i*3+1] = tailHist[i].y; tailArr[i*3+2] = tailHist[i].z;
      }
      tailAttr.needsUpdate = true;
      tailGeo.setDrawRange(0, tailHist.length);
      tailMat.opacity = lemTravAlpha * 0.35;
    } else {
      tailMat.opacity = 0;
      tailHist.length = 0;
    }

    // ── HUD phase label ───────────────────────────────────────────────────────
    const phaseEl = document.getElementById('s11_phase');
    if (phaseEl) {
      const labels = {
        UNFOLDED: '2 clocks', FOLD1: 'folding time →',
        BTB: 'back to back', FOLD2: '2nd fold →',
        INF: 'fold into ∞', RETURN: '↺',
      };
      phaseEl.textContent = labels[phase] || '';
    }

    if (R.clkDisplay) {
      const cycle = (Math.floor(elapsed / CYCLE_T) % 42) + 1;
      R.clkDisplay.innerHTML =
        `<div style="color:#aa44ff;letter-spacing:.1em">11 · OLIVER 42</div>` +
        `<div style="color:#553377;margin-top:3px;font-size:8px">cycle ${String(cycle).padStart(2,'0')}/42</div>`;
    }
  };
}
