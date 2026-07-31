// ── Panel 6 · Sunflower Phyllotaxis ──────────────────
import {
  THREE, R, mkControls,
  FS, LS, FI, LI, nodeCls,
  tip, tmv, htip,
} from './shared.js';

export function buildS5() {
  const canvas = R.canvas, ov = R.ov;
  const scene = R.scene = new THREE.Scene();
  const camera = R.camera = new THREE.PerspectiveCamera(55, canvas.width / canvas.height, 0.1, 200);
  camera.position.set(0, 0, 22);
  camera.lookAt(0, 0, 0);
  const controls = R.controls = mkControls(camera);
  controls.autoRotate = false;

  // 987 seeds (F₁₆) using golden angle
  const N = 987;
  const GA = Math.PI * (3 - Math.sqrt(5)); // golden angle ≈ 137.508°
  const SCALE = 0.38;

  const positions = [];
  const colors = [];
  const sizes = [];
  const seeds = [];

  for (let i = 0; i < N; i++) {
    const r = SCALE * Math.sqrt(i + 0.5);
    const theta = i * GA;
    const x = r * Math.cos(theta), y = r * Math.sin(theta);
    positions.push(x, y, 0);
    seeds.push(i + 1);

    const n = i + 1;
    let col;
    if (n === 896) { col = [1, .6, 0]; }
    else if (FS.has(n) && LS.has(n)) { col = [1, .9, 0]; }
    else if (FS.has(n)) { col = [0, 1, .53]; }
    else if (LS.has(n)) { col = [0, .9, 1]; }
    else { col = [0.04, 0.12, 0.06]; }
    colors.push(...col);
    sizes.push((n === 896 || FS.has(n) || LS.has(n)) ? 10 : 5);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  R.disposables.push(geo);

  const mat = new THREE.ShaderMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    vertexShader: `attribute float aSize;varying vec3 vColor;varying float vAlpha;
      void main(){vColor=color;float s=aSize;if(color.x>.8&&color.y>.5&&color.z<.2)s*=2.2;
      vAlpha=s>7.?1.0:.75;gl_PointSize=s;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 vColor;varying float vAlpha;
      void main(){vec2 c=gl_PointCoord-.5;float d=dot(c,c);if(d>.25)discard;
      float e=1.-smoothstep(.18,.25,d);gl_FragColor=vec4(vColor*1.4,e*vAlpha);}`
  });
  R.disposables.push(mat);
  scene.add(new THREE.Points(geo, mat));

  // Fibonacci arm count labels (13 clockwise, 21 counter)
  const armData = [
    { count: 8, color: '#00e5ff', label: '8 spirals →' },
    { count: 13, color: '#00ff88', label: '13 spirals ←' },
    { count: 21, color: '#ffe600', label: '21 spirals →' },
    { count: 34, color: '#ff9800', label: '34 spirals ←' },
  ];

  ov.innerHTML = `<div style="color:#2a9060;letter-spacing:.1em">06 · SUNFLOWER</div>` +
    `<div style="color:#2a6048;margin-top:3px">987 = F₁₆ seeds</div>` +
    `<div style="color:#2a6048">golden angle: 137.5°</div>` +
    `<div style="margin-top:6px;font-size:8.5px;line-height:1.9">` +
    armData.map(a => `<div><span style="color:${a.color}">${a.label}</span></div>`).join('') +
    `</div>` +
    `<div style="color:#2a6048;margin-top:5px;font-size:8px">scroll to zoom · drag to pan</div>`;

  // Hover tooltip
  const ray = new THREE.Raycaster(); ray.params.Points.threshold = 0.4;
  const mouse = new THREE.Vector2();
  canvas.addEventListener('mousemove', e => {
    if (R.cur !== 5) return;
    const r = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(mouse, R.camera);
    const hits = ray.intersectObjects(R.scene.children, false);
    if (hits.length > 0 && hits[0].index != null) {
      const idx = hits[0].index, n = seeds[idx];
      const cl = nodeCls(n);
      let h = `<div class="th" style="color:${cl.c}">seed #${idx + 1}</div>`;
      h += `<p class="tr">value: <b style="color:${cl.c}">${n}</b> — ${cl.lbl}</p>`;
      if (FS.has(n)) { const fi = FI.get(n); h += `<p class="tr">F<sub>${fi}</sub> = ${n}</p>`; }
      if (LS.has(n)) { const li = LI.get(n); h += `<p class="tr">L<sub>${li}</sub> = ${n}</p>`; }
      const ang = ((idx * GA * 180 / Math.PI) % 360).toFixed(1);
      h += `<p class="tr">angle: ${ang}°</p>`;
      tip(e, h); tmv(e);
    } else htip();
  });
  canvas.addEventListener('mouseleave', () => htip());

  R.animFn = () => {};
}
