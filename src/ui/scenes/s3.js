// ─────────────────────────────────────────────────────
//  SCENE 3 — MoE 3D Point Cloud
// ─────────────────────────────────────────────────────
import {
  THREE, R, mkCamera, mkControls,
  tip, tmv, htip,
} from './shared.js';

export function buildS3() {
  const canvas = R.canvas, ov = R.ov;
  const scene = R.scene = new THREE.Scene();
  const camera = R.camera = mkCamera(); camera.position.set(0, 0, 14);
  const controls = R.controls = mkControls(camera);
  controls.autoRotate = true; controls.autoRotateSpeed = .4;

  const GS = [
    { size: 610, color: [0, 1, .53] },
    { size: 233, color: [0, .9, 1] },
    { size: 34, color: [1, .9, 0] },
    { size: 13, color: [1, .6, 0] },
    { size: 5, color: [1, .18, .47] },
    { size: 1, color: [.63, 1, .25] },
  ];
  const EG = []; GS.forEach((g, gi) => { for (let i = 0; i < g.size; i++) EG.push(gi); });
  const N = 896;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N);
  const COLS = 48;
  for (let i = 0; i < N; i++) {
    const c = i % COLS, r = Math.floor(i / COLS);
    const x = (c - COLS / 2) * .24, y = (r - Math.ceil(N / COLS) / 2) * .28;
    const z = Math.sin(c / COLS * Math.PI) * 1.2 + Math.cos(r / Math.ceil(N / COLS) * Math.PI) * .8;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    const g = GS[EG[i]];
    col[i * 3] = g.color[0] * .12; col[i * 3 + 1] = g.color[1] * .12; col[i * 3 + 2] = g.color[2] * .12; sz[i] = .07;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sz, 1));
  R.disposables.push(geo);
  const mat = new THREE.ShaderMaterial({
    vertexShader: `attribute float size;attribute vec3 color;varying vec3 vColor;void main(){vColor=color;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=size*(500.0/-mv.z);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `varying vec3 vColor;void main(){float d=length(gl_PointCoord-.5)*2.0;if(d>1.0)discard;float a=1.0-smoothstep(.5,1.0,d);gl_FragColor=vec4(vColor,a);}`,
    transparent: true, vertexColors: false, depthWrite: false
  });
  R.disposables.push(mat); scene.add(new THREE.Points(geo, mat));
  scene.add(new THREE.AmbientLight(0xffffff, .1));

  const lineGeo = new THREE.BufferGeometry();
  const linePos = new Float32Array(16 * 6);
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  R.disposables.push(lineGeo);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: .45 });
  R.disposables.push(lineMat);
  scene.add(new THREE.LineSegments(lineGeo, lineMat));

  let active = new Set(), tokens = 0, routing = false, routeAlpha = 0;
  const cAttr = geo.attributes.color, szAttr = geo.attributes.size;

  function pickActive() {
    const raw = GS.map(g => 16 * g.size / 896);
    const fl = raw.map(v => Math.floor(v));
    let rem = 16 - fl.reduce((a, b) => a + b, 0);
    raw.map((v, i) => ({ i, f: v - fl[i] })).sort((a, b) => b.f - a.f).slice(0, rem).forEach(({ i }) => fl[i]++);
    const act = new Set(); let off = 0;
    GS.forEach((g, gi) => { const n = fl[gi]; const pool = Array.from({ length: g.size }, (_, k) => off + k); for (let j = 0; j < n; j++) { const k = j + Math.floor(Math.random() * (pool.length - j)); [pool[j], pool[k]] = [pool[k], pool[j]]; act.add(pool[j]); } off += g.size; });
    return act;
  }
  function applyActive(act) {
    for (let i = 0; i < N; i++) { const g = GS[EG[i]], on = act.has(i); cAttr.array[i * 3] = g.color[0] * (on ? .95 : .1); cAttr.array[i * 3 + 1] = g.color[1] * (on ? .95 : .1); cAttr.array[i * 3 + 2] = g.color[2] * (on ? .95 : .1); szAttr.array[i] = on ? .22 : .07; }
    cAttr.needsUpdate = true; szAttr.needsUpdate = true;
    let li = 0;
    act.forEach(idx => { linePos[li * 6] = pos[idx * 3]; linePos[li * 6 + 1] = pos[idx * 3 + 1]; linePos[li * 6 + 2] = pos[idx * 3 + 2]; linePos[li * 6 + 3] = 0; linePos[li * 6 + 4] = 0; linePos[li * 6 + 5] = 0; li++; });
    lineGeo.attributes.position.needsUpdate = true; lineGeo.setDrawRange(0, act.size * 2);
  }
  active = pickActive(); applyActive(active);

  ov.innerHTML = `<div style="color:#2a9060;letter-spacing:.1em">04 · MoE ROUTING</div><div style="color:#2a6048;margin-top:3px">896 expert nodes</div><div style="color:#2a6048">16 active / token</div><div style="color:#2a6048;margin-top:3px">ZECKENDORF:</div>${GS.map((g, i) => `<div style="color:rgb(${g.color.map(v => Math.round(v * 210)).join(',')});font-size:7.5px">● ${['F₁₅', 'F₁₃', 'F₉', 'F₇', 'F₅', 'F₂'][i]}=${g.size}</div>`).join('')}`;

  const stat = document.getElementById('p4stat'), cntEl = document.getElementById('p4cnt');
  document.getElementById('p4rt').onclick = () => { if (routing) return; active = pickActive(); tokens++; cntEl.textContent = `tokens: ${tokens}`; routing = true; routeAlpha = 0; applyActive(active); };

  const ray = new THREE.Raycaster(); ray.params.Points.threshold = .18; const mouse = new THREE.Vector2();
  canvas.addEventListener('mousemove', e => {
    if (R.cur !== 3) return;
    const r = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(mouse, R.camera);
    const hits = ray.intersectObjects(R.scene.children.filter(c => c.isPoints));
    if (hits.length > 0) { const idx = hits[0].index, gi = EG[idx], g = GS[gi], gc = `rgb(${g.color.map(v => Math.round(v * 255)).join(',')})`, labels = ['F₁₅(610)', 'F₁₃(233)', 'F₉(34)', 'F₇(13)', 'F₅(5)', 'F₂(1)'], on = active.has(idx); let h = `<div class="th" style="color:${gc}">Expert #${idx + 1}</div>`; h += `<p class="tr">group: <b style="color:${gc}">${labels[gi]}</b></p>`; h += `<p class="tr">active: <b style="color:${on ? '#00ff88' : '#0a2a0a'}">${on ? 'YES ✦' : 'no'}</b></p>`; tip(e, h); stat.textContent = `#${idx + 1}`; }
    else { htip(); stat.textContent = 'hover an expert'; }
    if (hits.length > 0) tmv(e);
  });
  R.animFn = () => {
    if (routing) { routeAlpha += .04; lineMat.opacity = .15 + .4 * Math.abs(Math.sin(routeAlpha * Math.PI)); if (routeAlpha > 2) routing = false; }
    else lineMat.opacity = .2 + .1 * Math.sin(Date.now() * .001);
  };
}
