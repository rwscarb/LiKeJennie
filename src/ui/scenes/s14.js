// ─────────────────────────────────────────────────────────────────────────────
//  SCENE 14 — BUCKMINSTER
//  C₆₀ truncated icosahedron (3D rotating wireframe) alongside the
//  orbit ring {1,2,4,8,7,5}.  Key correspondences: 60≡6 (mod 9),
//  diameter 5 / period 6, single automorphic orbit.
// ─────────────────────────────────────────────────────────────────────────────
import { THREE, CSS2DObject, R, mkCamera, mkControls } from './shared.js';

const C_ORB  = 0x00ff88;  const CS_ORB  = '#00ff88';
const C_CYAN = 0x00e5ff;  const CS_CYAN = '#00e5ff';

// Six orbit-step hues (HSL, 0–1) cycling the spectrum: green → cyan → blue → pink → amber → lime
const STEP_HUES   = [0.33, 0.50, 0.62, 0.83, 0.10, 0.23];
const STEP_COLORS = STEP_HUES.map(h => new THREE.Color().setHSL(h, 0.9, 0.60));
const _tmpColor   = new THREE.Color();

// ── Truncated icosahedron geometry ────────────────────────────────────────────
const phi = (1 + Math.sqrt(5)) / 2;

function* signCombos(coords) {
  const nz = coords.reduce((acc, v, i) => v !== 0 ? [...acc, i] : acc, []);
  for (let mask = 0; mask < (1 << nz.length); mask++) {
    const r = [...coords];
    nz.forEach((idx, j) => { if (mask & (1 << j)) r[idx] = -r[idx]; });
    yield r;
  }
}
function cyclicPerms(v) {
  return [[v[0],v[1],v[2]], [v[1],v[2],v[0]], [v[2],v[0],v[1]]];
}

const C60_VERTS = [];
for (const t of [[0, 1, 3*phi], [1, 2+phi, 2*phi], [2, 1+2*phi, phi]])
  for (const s of signCombos(t))
    for (const p of cyclicPerms(s))
      C60_VERTS.push(p);   // 60 vertices

const C60_EDGES = [];
for (let i = 0; i < C60_VERTS.length; i++)
  for (let j = i+1; j < C60_VERTS.length; j++) {
    const [a,b,c] = C60_VERTS[i], [d,e,f] = C60_VERTS[j];
    if (Math.abs((a-d)**2+(b-e)**2+(c-f)**2 - 4) < 0.01)
      C60_EDGES.push([i,j]);
  }   // 90 edges

// ── Scene ─────────────────────────────────────────────────────────────────────
const ORBIT_SEQ = [1,2,4,8,7,5];
const C60_OFF   = new THREE.Vector3(-3.2, 0, 0);
const ORB_X     = 3.2;
const ORB_R     = 1.8;
const C60_S     = 0.37;   // scale: max extent ≈ 6.5 → ~2.4 units

export function buildS14() {
  const scene = new THREE.Scene();
  R.scene  = scene;
  R.camera = mkCamera();
  R.camera.position.set(0, 3, 9.5);
  R.camera.lookAt(0, 0, 0);
  R.controls = mkControls(R.camera);

  scene.add(new THREE.AmbientLight(0xffffff, 0.3));

  // ── C60 wireframe (LineSegments with vertex colors) ──────────────────────
  const posArr   = new Float32Array(C60_EDGES.length * 6);
  const colArr   = new Float32Array(C60_EDGES.length * 6);
  const geo      = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colArr, 3));
  const lineMat  = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true });
  R.disposables.push(geo, lineMat);
  const c60Lines = new THREE.LineSegments(geo, lineMat);
  c60Lines.position.copy(C60_OFF);
  scene.add(c60Lines);

  // Small node spheres (only front-facing shown via opacity)
  const nodeMeshes = [], nodeMats = [];
  for (let i = 0; i < 60; i++) {
    const ng = new THREE.SphereGeometry(0.055, 6, 4);
    const nm = new THREE.MeshBasicMaterial({ color: C_ORB, transparent: true, opacity: 0.4 });
    R.disposables.push(ng, nm);
    const mesh = new THREE.Mesh(ng, nm);
    scene.add(mesh);
    nodeMeshes.push(mesh);
    nodeMats.push(nm);
  }

  // C60 annotation labels
  function mkLabel(html, css, px, py, pz) {
    const div = document.createElement('div');
    div.innerHTML = html;
    div.style.cssText = `font-family:'Courier New',monospace;pointer-events:none;user-select:none;${css}`;
    const lbl = new CSS2DObject(div);
    lbl.position.set(px, py, pz);
    scene.add(lbl);
    R.css2dObjects.push(lbl);
  }

  mkLabel('C₆₀',
    `font-size:15px;font-weight:bold;color:${CS_ORB};opacity:.65`,
    C60_OFF.x, -2.7, 0);
  mkLabel('60 ≡ 6 (mod 9)',
    `font-size:9px;color:${CS_CYAN};opacity:.50`,
    C60_OFF.x, -3.15, 0);

  // "×" connector
  mkLabel('×', `font-size:18px;color:#1a4a2a`, 0, 0, 0);

  // ── Orbit ring ──────────────────────────────────────────────────────────
  function orbitPos(i) {
    const a = (i/6)*Math.PI*2 - Math.PI/2;
    return new THREE.Vector3(ORB_X + Math.cos(a)*ORB_R, Math.sin(a)*ORB_R, 0);
  }

  // Ring guide (dark torus-like circle)
  const rpts = [];
  for (let s = 0; s <= 80; s++) {
    const a = (s/80)*Math.PI*2;
    rpts.push(new THREE.Vector3(ORB_X + Math.cos(a)*ORB_R, Math.sin(a)*ORB_R, 0));
  }
  const rg = new THREE.BufferGeometry().setFromPoints(rpts);
  const rm = new THREE.LineBasicMaterial({ color: 0x061408, transparent: true, opacity: 0.9, linewidth: 3 });
  R.disposables.push(rg, rm);
  scene.add(new THREE.Line(rg, rm));

  // Orbit edges (animated — active arc turns white)
  const orbitEdgeMats = [];
  for (let i = 0; i < 6; i++) {
    const from = orbitPos(i);
    const to   = orbitPos((i+1)%6);
    // arc control point: outward from ring center
    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    const outDir = new THREE.Vector3(mid.x - ORB_X, mid.y, 0).normalize();
    const ctrl   = mid.clone().addScaledVector(outDir, ORB_R * 0.14);

    const pts = [];
    for (let s = 0; s <= 22; s++) {
      const t = s/22, mt = 1-t;
      pts.push(new THREE.Vector3(
        mt*mt*from.x + 2*mt*t*ctrl.x + t*t*to.x,
        mt*mt*from.y + 2*mt*t*ctrl.y + t*t*to.y, 0));
    }
    const eg = new THREE.BufferGeometry().setFromPoints(pts);
    const em = new THREE.LineBasicMaterial({ color: STEP_COLORS[i], transparent: true, opacity: 0.35 });
    R.disposables.push(eg, em);
    scene.add(new THREE.Line(eg, em));
    orbitEdgeMats.push(em);
  }

  // Orbit nodes + labels — each step gets its own hue
  const orbitNodeMats = [];
  for (let i = 0; i < 6; i++) {
    const pos = orbitPos(i);
    const ng  = new THREE.SphereGeometry(0.13, 12, 8);
    const nm  = new THREE.MeshBasicMaterial({ color: STEP_COLORS[i], transparent: true, opacity: 0.55 });
    R.disposables.push(ng, nm);
    const mesh = new THREE.Mesh(ng, nm);
    mesh.position.copy(pos);
    scene.add(mesh);
    orbitNodeMats.push(nm);

    const d = document.createElement('div');
    d.textContent = String(ORBIT_SEQ[i]);
    d.style.cssText = `font-family:'Courier New',monospace;font-size:13px;font-weight:bold;color:${CS_ORB};pointer-events:none`;
    const lbl = new CSS2DObject(d);
    lbl.position.set(pos.x, pos.y + 0.28, 0);
    scene.add(lbl);
    R.css2dObjects.push(lbl);
  }

  // Orbit center label
  mkLabel(`<div style="font-size:10px;opacity:.40">×2</div><div style="font-size:8px;opacity:.32;margin-top:2px">mod 9</div>`,
    `color:${CS_CYAN};text-align:center`, ORB_X, 0, 0);

  mkLabel('period 6  →  identity',
    `font-size:9px;color:#2a4a2a`,
    ORB_X, -2.7, 0);

  // Orbit ring label above
  mkLabel('ORBIT {1,2,4,8,7,5}',
    `font-size:10px;color:${CS_ORB};opacity:.60;letter-spacing:.06em`,
    ORB_X, 2.4, 0);

  // ── Bottom fact strip (CSS2D, y = -3.8) ─────────────────────────────────
  const FACTS = [
    ['60 ≡ 6 (mod 9)', 'nil element · hollow container', -5.5],
    ['diameter 5 / period 6', 'info propagates in 5 · orbit closes in 6', -1.8],
    ['1 automorphic orbit', 'every node = every node (Narcissus)', 1.8],
    ['|Ih| = 120 = 20×6', '20 hexagonal faces · 6-step orbit', 5.4],
  ];
  for (const [val, sub, fx] of FACTS) {
    mkLabel(
      `<div style="font-size:10px;font-weight:bold;color:${CS_ORB}">${val}</div>` +
      `<div style="font-size:8px;color:#2a4a2a;margin-top:2px">${sub}</div>`,
      '', fx, -3.85, 0);
  }

  // Dividers between facts
  for (const fx of [-0.1, 3.6]) {
    const dg = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(fx, -3.4, 0), new THREE.Vector3(fx, -4.3, 0)
    ]);
    const dm = new THREE.LineBasicMaterial({ color: 0x0d2a1a, transparent: true, opacity: 0.8 });
    R.disposables.push(dg, dm);
    scene.add(new THREE.Line(dg, dm));
  }

  // ── HUD overlay ──────────────────────────────────────────────────────────
  R.ov.innerHTML =
    `<div style="color:${CS_CYAN};letter-spacing:.10em">14 · BUCKMINSTER</div>` +
    `<div style="color:#00ff88;font-size:13px;margin-top:3px">C₆₀ × orbit {1,2,4,8,7,5}</div>` +
    `<div style="font-size:11px;margin-top:6px;line-height:1.85;color:#2a5a2a">` +
      `60 vertices &nbsp;·&nbsp; 90 edges<br>` +
      `12 pentagons + 20 hexagons<br>` +
      `symmetry group I<sub>h</sub> (order 120)<br>` +
      `<span style="color:#00ff88;opacity:.6">·</span> all 60 atoms one orbit` +
    `</div>`;

  // ── Animation ─────────────────────────────────────────────────────────────
  let lastT      = null;
  let c60Angle   = 0;
  let oPhase     = 0;
  let c60Hue     = STEP_HUES[0];   // current C60 iridescent base hue (lerps toward active step)
  const ROT_X    = 0.38;
  const cosRX    = Math.cos(ROT_X), sinRX = Math.sin(ROT_X);

  R.animFn = (t) => {
    const dt = lastT === null ? 0 : Math.min(t - lastT, 0.08);
    lastT = t;
    c60Angle = (c60Angle + dt * 0.27) % (Math.PI * 2);
    oPhase   = (oPhase   + dt / 1.6) % 6;

    const oStep  = Math.floor(oPhase) % 6;
    const oFrac  = oPhase - Math.floor(oPhase);
    const cosY   = Math.cos(c60Angle), sinY = Math.sin(c60Angle);

    // Lerp C60 hue toward active step's hue
    const targetHue = STEP_HUES[oStep];
    let dh = targetHue - c60Hue;
    // Shortest path around the hue circle
    if (dh >  0.5) dh -= 1.0;
    if (dh < -0.5) dh += 1.0;
    c60Hue = (c60Hue + dh * Math.min(1, dt * 2.5) + 1.0) % 1.0;

    // Rotate all 60 vertices once
    const rotV = C60_VERTS.map(([vx,vy,vz]) => {
      const y1 = vy*cosRX - vz*sinRX;
      const z1 = vy*sinRX + vz*cosRX;
      const x2 = vx*cosY  + z1*sinY;
      const z2 = -vx*sinY + z1*cosY;
      return [x2, y1, z2];
    });

    let zMin = Infinity, zMax = -Infinity;
    for (const [,,z] of rotV) { if (z < zMin) zMin = z; if (z > zMax) zMax = z; }
    const zR = zMax - zMin || 1;

    // Pulse: when orbit step transitions (oFrac < 0.25), a brightness wave
    const pulse = Math.max(0, 1 - oFrac * 5) * 0.35;

    // Update C60 edge positions + iridescent colors
    C60_EDGES.forEach(([i,j], ei) => {
      const [xi,yi,zi] = rotV[i], [xj,yj,zj] = rotV[j];
      const base = ei * 6;
      posArr[base]   = xi*C60_S; posArr[base+1] = yi*C60_S; posArr[base+2] = zi*C60_S;
      posArr[base+3] = xj*C60_S; posArr[base+4] = yj*C60_S; posArr[base+5] = zj*C60_S;

      // Iridescent: depth varies hue ±0.10 around the step-driven base
      const depth = ((zi+zj)/2 - zMin) / zR;
      const hue   = (c60Hue + depth * 0.18 - 0.09 + 1.0) % 1.0;
      const lum   = 0.05 + depth * 0.50 + pulse * depth;
      _tmpColor.setHSL(hue, 0.95, lum);

      colArr[base]   = _tmpColor.r; colArr[base+1] = _tmpColor.g; colArr[base+2] = _tmpColor.b;
      colArr[base+3] = _tmpColor.r; colArr[base+4] = _tmpColor.g; colArr[base+5] = _tmpColor.b;
    });
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate    = true;

    // Update node sphere positions + depth-fade + step-color
    for (let i = 0; i < 60; i++) {
      const [rx,ry,rz] = rotV[i];
      const depth = (rz - zMin) / zR;
      nodeMeshes[i].position.set(rx*C60_S + C60_OFF.x, ry*C60_S, rz*C60_S);
      const nOpacity = depth < 0.28 ? 0 : 0.06 + depth * 0.55;
      nodeMats[i].opacity = nOpacity;
      // Tint nodes toward active step color
      nodeMats[i].color.copy(STEP_COLORS[oStep]).lerp(new THREE.Color(0xffffff), depth * 0.3);
    }

    // Orbit ring: per-step hue; active arc → white + glow
    for (let i = 0; i < 6; i++) {
      const active = (i === oStep);
      if (active) {
        orbitEdgeMats[i].color.set(0xffffff);
        orbitEdgeMats[i].opacity   = 0.90;
        orbitNodeMats[i].color.set(0xffffff);
        orbitNodeMats[i].opacity   = 1.0;
      } else {
        orbitEdgeMats[i].color.copy(STEP_COLORS[i]);
        orbitEdgeMats[i].opacity   = 0.38;
        orbitNodeMats[i].color.copy(STEP_COLORS[i]);
        orbitNodeMats[i].opacity   = 0.52;
      }
    }
  };
}
