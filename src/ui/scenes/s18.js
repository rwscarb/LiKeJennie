// ─────────────────────────────────────────────────────────────────────────────
//  SCENE 18 — JO BURROWS
//  A worm burrowing through filigree — hypotrochoid spirograph curves that
//  cross and loop, building the dense scrollwork of card filigree as they fill.
//  Each completed curve adds a new layer. The worm accelerates. Lemons appear.
//
//  Named for:
//    Jo Nagai — memory survives metamorphosis; the IV persists
//    "burrow not flow" — systems tunnel through geometry, not along surfaces
//    Joe Burrow — #9; the absent number; QB Kings; filigree behind him always
// ─────────────────────────────────────────────────────────────────────────────
import { THREE, R, mkCamera, mkControls } from './shared.js';

function gcd(a, b) { while (b) { [a, b] = [b, a % b]; } return a; }

// Hypotrochoid: outer radius R, inner radius r, pen distance d
// Closes after (r / gcd(R,r)) revolutions of the inner circle
function makeHypo(R, r, d, scale, nPts = 4000) {
  const revs = r / gcd(R, r);
  const pts = [];
  for (let i = 0; i <= nPts; i++) {
    const t = (i / nPts) * revs * Math.PI * 2;
    pts.push(new THREE.Vector3(
      scale * ((R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t)),
      0,
      scale * ((R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t)),
    ));
  }
  return pts;
}

// Sequences of spirograph configs — each pass layers a new curve on top
const CONFIGS = [
  { R: 7,  r: 2, d: 5.8, scale: 1.55, trailColor: new THREE.Color(0xffaa20), dimColor: new THREE.Color(0x5a3008) },
  { R: 11, r: 4, d: 8.5, scale: 1.0,  trailColor: new THREE.Color(0xff8030), dimColor: new THREE.Color(0x4a1e04) },
  { R: 9,  r: 5, d: 7.8, scale: 1.2,  trailColor: new THREE.Color(0xffe040), dimColor: new THREE.Color(0x503a04) },
  { R: 13, r: 3, d: 11,  scale: 0.82, trailColor: new THREE.Color(0xd09010), dimColor: new THREE.Color(0x402808) },
];

export function buildS18() {
  const scene = R.scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010812);

  const camera = R.camera = mkCamera();
  camera.position.set(0, 20, 4);
  camera.lookAt(0, 0, 0);
  const controls = R.controls = mkControls(camera);
  controls.enablePan = false;
  controls.minDistance = 8; controls.maxDistance = 35;

  // ── Completed layer lines (accumulated filigree) ───────────────────────────
  // One permanent line object per completed pass — stays forever
  const layerLines = [];

  // ── Active trail ──────────────────────────────────────────────────────────
  const TRAIL = 120;
  const trailPos = new Float32Array(TRAIL * 3);
  const trailCol = new Float32Array(TRAIL * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute('color',    new THREE.BufferAttribute(trailCol, 3));
  R.disposables.push(trailGeo);
  const trailMat = new THREE.LineBasicMaterial({ vertexColors: true });
  R.disposables.push(trailMat);
  scene.add(new THREE.Line(trailGeo, trailMat));

  // ── Dim current-pass trace (full path up to worm) ─────────────────────────
  let dimGeo = null, dimLine = null;
  function resetDimLine(nPts) {
    if (dimLine) scene.remove(dimLine);
    if (dimGeo) dimGeo.dispose();
    dimGeo = new THREE.BufferGeometry();
    dimGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nPts * 3), 3));
    dimGeo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(nPts * 3), 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7 });
    R.disposables.push(mat);
    dimLine = new THREE.Line(dimGeo, mat);
    scene.add(dimLine);
  }

  // ── Worm head ─────────────────────────────────────────────────────────────
  const headGeo = new THREE.SphereGeometry(0.22, 12, 8);
  const headMat = new THREE.MeshPhongMaterial({
    color: 0xffcc44, emissive: 0xcc8800, emissiveIntensity: 1.0, shininess: 160,
  });
  R.disposables.push(headGeo, headMat);
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 0.22;
  scene.add(head);
  const wormLight = new THREE.PointLight(0xffcc44, 2.5, 6);
  scene.add(wormLight);

  // ── Lemons ────────────────────────────────────────────────────────────────
  const lemonGeo = new THREE.SphereGeometry(0.16, 8, 6);
  R.disposables.push(lemonGeo);
  const lemons = new Map(); // ptIndex → Mesh

  function spawnLemon(pts, minIdx) {
    for (let attempts = 0; attempts < 30; attempts++) {
      const stride = Math.floor(pts.length / 14);
      const idx = minIdx + stride + Math.floor(Math.random() * stride * 2);
      if (idx < pts.length && !lemons.has(idx)) {
        const lMat = new THREE.MeshPhongMaterial({
          color: 0x99cc00, emissive: 0x3a5200, emissiveIntensity: 0.7,
        });
        R.disposables.push(lMat);
        const m = new THREE.Mesh(lemonGeo, lMat);
        const p = pts[idx];
        m.position.set(p.x, 0.16, p.z);
        scene.add(m); lemons.set(idx, m);
        return;
      }
    }
  }

  // ── Lighting ──────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0x020810, 1.5));

  // ── Speed control ─────────────────────────────────────────────────────────
  const SPEEDS = [2, 10, 40, 150]; // steps per frame
  let speedIdx = 1; // default: 10 steps/frame
  const speedLabels = ['1× slow', '2× med', '3× fast', '4× ∞'];

  function onKey(e) {
    if      (e.key === ']') speedIdx = Math.min(3, speedIdx + 1);
    else if (e.key === '[') speedIdx = Math.max(0, speedIdx - 1);
    else return;
    updateLabel();
  }
  window.addEventListener('keydown', onKey);
  R.disposables.push({ dispose: () => window.removeEventListener('keydown', onKey) });

  // ── State ─────────────────────────────────────────────────────────────────
  let cfgIdx   = 0;
  let pts      = makeHypo(CONFIGS[0].R, CONFIGS[0].r, CONFIGS[0].d, CONFIGS[0].scale);
  let stepIdx  = 0;
  let frame    = 0;
  let flashT   = 0;
  let pass     = 0;
  const visitedThisPass = [];

  resetDimLine(pts.length);
  // Seed a few lemons
  for (let i = 0; i < 6; i++) spawnLemon(pts, Math.floor((pts.length / 6) * i));

  const hintStyle = 'color:#8a6020;font-size:.95em;line-height:1.7';
  function updateLabel() {
    if (R.ov) R.ov.innerHTML =
      `<span style="color:#c88a14;letter-spacing:.18em;font-size:1.1em">JO BURROWS</span>`
      + `<br><span style="${hintStyle}">[ slower &nbsp;&nbsp; ] faster</span>`
      + `<br><span style="${hintStyle}">← → scenes</span>`
      + `<br><span style="${hintStyle}">drag · orbit</span>`
      + `<br><span style="color:#c88a14;font-size:.9em">speed: ${speedLabels[speedIdx]}</span>`
      + (pass > 0 ? `<br><span style="color:#8a6020;font-size:.85em">layer ${pass + 1}</span>` : '');
    if (R.tt) R.tt.textContent = 'Jo Burrows — hypotrochoid filigree / worm / lemon / ∞';
  }
  updateLabel();

  // ── Animate ───────────────────────────────────────────────────────────────
  R.animFn = () => {
    frame++;
    const cfg = CONFIGS[cfgIdx];

    const stepsThisFrame = SPEEDS[speedIdx];
    for (let _s = 0; _s < stepsThisFrame && stepIdx < pts.length; _s++) {
      visitedThisPass.push(stepIdx);

      // Eat lemon — one per frame: stop advancing after the first bite
      if (lemons.has(stepIdx)) {
        scene.remove(lemons.get(stepIdx));
        lemons.delete(stepIdx);
        flashT = 18;
        spawnLemon(pts, stepIdx);
        stepIdx++;
        break;
      }

      stepIdx++;
    }

    if (stepIdx > 0 && stepIdx <= pts.length) {
      const p = pts[Math.min(stepIdx - 1, pts.length - 1)];
      head.position.set(p.x, 0.22, p.z);
      wormLight.position.set(p.x, 0.6, p.z);
    }

    if (stepIdx >= pts.length) {
      // Pass complete — bake current pass into a permanent layer line
      const layerPts = pts;
      const layerCol = cfg.dimColor;
      const lGeo = new THREE.BufferGeometry().setFromPoints(layerPts);
      const lColArr = new Float32Array(layerPts.length * 3);
      for (let i = 0; i < layerPts.length; i++) {
        lColArr[i * 3]     = layerCol.r * 0.85;
        lColArr[i * 3 + 1] = layerCol.g * 0.85;
        lColArr[i * 3 + 2] = layerCol.b * 0.85;
      }
      lGeo.setAttribute('color', new THREE.BufferAttribute(lColArr, 3));
      const lMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.65 });
      const lLine = new THREE.Line(lGeo, lMat);
      scene.add(lLine);
      layerLines.push(lLine);
      R.disposables.push(lGeo, lMat);

      // Next config
      pass++;
      cfgIdx = pass % CONFIGS.length;
      const nextCfg = CONFIGS[cfgIdx];
      pts = makeHypo(nextCfg.R, nextCfg.r, nextCfg.d, nextCfg.scale);
      stepIdx = 0;
      visitedThisPass.length = 0;
      resetDimLine(pts.length);

      lemons.forEach(m => scene.remove(m)); lemons.clear();
      for (let i = 0; i < 6; i++) spawnLemon(pts, Math.floor((pts.length / 6) * i));
      updateLabel();
    }

    // Flash decay
    if (flashT > 0) {
      flashT--;
      headMat.emissiveIntensity = 1.0 + (flashT / 18) * 2.5;
    } else {
      headMat.emissiveIntensity = 1.0;
    }
    wormLight.intensity = 2.0 + (flashT / 18) * 3;

    const cfg2 = CONFIGS[cfgIdx];

    // Active trail (most recent TRAIL steps)
    const tv = visitedThisPass.length > TRAIL
      ? visitedThisPass.slice(-TRAIL)
      : visitedThisPass;
    const tvLen = tv.length;
    for (let i = 0; i < TRAIL; i++) {
      if (i < tvLen) {
        const p = pts[tv[i]];
        trailPos[i * 3]     = p.x;
        trailPos[i * 3 + 1] = 0.05;
        trailPos[i * 3 + 2] = p.z;
        const t = i / tvLen; // 0=old, 1=new
        trailCol[i * 3]     = cfg2.trailColor.r * t + cfg2.dimColor.r * (1 - t);
        trailCol[i * 3 + 1] = cfg2.trailColor.g * t + cfg2.dimColor.g * (1 - t);
        trailCol[i * 3 + 2] = cfg2.trailColor.b * t + cfg2.dimColor.b * (1 - t);
      } else {
        trailPos[i * 3] = trailPos[i * 3 + 1] = trailPos[i * 3 + 2] = 0;
        trailCol[i * 3] = trailCol[i * 3 + 1] = trailCol[i * 3 + 2] = 0;
      }
    }
    trailGeo.setDrawRange(0, tvLen);
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.color.needsUpdate    = true;

    // Dim trace (all visited this pass)
    const vLen = visitedThisPass.length;
    const dPos = dimGeo.attributes.position.array;
    const dCol = dimGeo.attributes.color.array;
    for (let i = 0; i < vLen; i++) {
      const p = pts[visitedThisPass[i]];
      dPos[i * 3]     = p.x;
      dPos[i * 3 + 1] = 0.02;
      dPos[i * 3 + 2] = p.z;
      dCol[i * 3]     = cfg2.dimColor.r;
      dCol[i * 3 + 1] = cfg2.dimColor.g;
      dCol[i * 3 + 2] = cfg2.dimColor.b;
    }
    dimGeo.setDrawRange(0, vLen);
    dimGeo.attributes.position.needsUpdate = true;
    dimGeo.attributes.color.needsUpdate    = true;

    controls.update();
  };
}
