// ─────────────────────────────────────────────────────
//  SCENE 2 — Golden Ratio Fibonacci Sphere
// ─────────────────────────────────────────────────────
import {
  THREE, R, mkCamera, mkControls,
  PHI, FS, LS, FI, LI, CDim, CG, CC, CY, CO, nodeCls,
  tip, tmv, htip,
} from './shared.js';

export function buildS2() {
  const canvas = R.canvas, ov = R.ov;
  const scene = R.scene = new THREE.Scene();
  const camera = R.camera = mkCamera(); camera.position.set(0, 0, 9);
  const controls = R.controls = mkControls(camera);
  controls.autoRotate = true; controls.autoRotateSpeed = .8;

  const N = 610, Rs = 3.5;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), sizes = new Float32Array(N);
  const nodeData = [];
  for (let i = 0; i < N; i++) {
    const θ = Math.acos(1 - 2 * (i + .5) / N);
    const φ = 2 * Math.PI * i / (PHI * PHI);
    const x = Rs * Math.sin(θ) * Math.cos(φ), y = Rs * Math.sin(θ) * Math.sin(φ), z = Rs * Math.cos(θ);
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    const n = i + 1;
    let c = CDim, cr = 10 / 255, cg = 26 / 255, cb = 10 / 255, sz = .055;
    if (n === 896) { c = CO; cr = 1; cg = .6; cb = 0; sz = .16; }
    else if (FS.has(n) && LS.has(n)) { c = CY; cr = 1; cg = .9; cb = 0; sz = .14; }
    else if (FS.has(n)) { c = CG; cr = 0; cg = 1; cb = .53; sz = .1; }
    else if (LS.has(n)) { c = CC; cr = 0; cg = .9; cb = 1; sz = .1; }
    col[i * 3] = cr; col[i * 3 + 1] = cg; col[i * 3 + 2] = cb;
    sizes[i] = sz;
    nodeData.push({ n, x, y, z, c, clabel: nodeCls(n).lbl });
  }
  const origCol = new Float32Array(col); // snapshot before BufferAttribute takes the same reference
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  R.disposables.push(geo);
  const mat = new THREE.ShaderMaterial({
    vertexShader: `attribute float size;attribute vec3 color;varying vec3 vColor;void main(){vColor=color;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=size*(600.0/-mv.z);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `varying vec3 vColor;void main(){float d=length(gl_PointCoord-.5)*2.0;if(d>1.0)discard;float a=1.0-smoothstep(.6,1.0,d);gl_FragColor=vec4(vColor,a);}`,
    transparent: true, vertexColors: false, depthWrite: false
  });
  R.disposables.push(mat);
  scene.add(new THREE.Points(geo, mat));
  const wg = new THREE.SphereGeometry(Rs, 32, 20);
  const wm = new THREE.MeshBasicMaterial({ color: 0x00e5ff, wireframe: true, transparent: true, opacity: .03 });
  R.disposables.push(wg, wm); scene.add(new THREE.Mesh(wg, wm));
  scene.add(new THREE.AmbientLight(0xffffff, .3));

  let fibOnly = false;
  document.getElementById('p3rot').onclick = () => { R.controls.autoRotate = !R.controls.autoRotate; document.getElementById('p3rot').classList.toggle('lit', R.controls.autoRotate); };
  document.getElementById('p3fib').onclick = () => {
    fibOnly = !fibOnly;
    document.getElementById('p3fib').classList.toggle('lit', fibOnly);
    const ca = geo.attributes.color;
    for (let i = 0; i < N; i++) {
      const n = i + 1, ok = FS.has(n) || LS.has(n) || n === 896;
      if (fibOnly && !ok) { ca.array[i * 3] = 10 / 255; ca.array[i * 3 + 1] = 10 / 255; ca.array[i * 3 + 2] = 10 / 255; }
      else { ca.array[i * 3] = origCol[i * 3]; ca.array[i * 3 + 1] = origCol[i * 3 + 1]; ca.array[i * 3 + 2] = origCol[i * 3 + 2]; }
    }
    ca.needsUpdate = true;
  };
  ov.innerHTML = `<div style="color:#2a9060;letter-spacing:.1em">03 · &phi; SPHERE</div><div style="color:#2a6048;margin-top:3px">610 = F&#8321;&#8325; seeds</div><div style="color:#2a6048">golden angle / sphere</div><div style="color:#ff9800;margin-top:4px">&phi; = ${PHI.toFixed(8)}</div>`;

  const ray = new THREE.Raycaster(); ray.params.Points.threshold = .15; const mouse = new THREE.Vector2();
  canvas.addEventListener('mousemove', e => {
    if (R.cur !== 2) return;
    const r = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(mouse, R.camera);
    const hits = ray.intersectObjects(R.scene.children.filter(c => c.isPoints));
    if (hits.length > 0) { const idx = hits[0].index, d = nodeData[idx], fi = FI.get(d.n), li = LI.get(d.n); let h = `<div class="th" style="color:${d.c}">Seed #${d.n}</div>`; h += `<p class="tr">class: <b style="color:${d.c}">${d.clabel}</b></p>`; if (fi) h += `<p class="tr">F<sub>${fi}</sub> = ${d.n}</p>`; if (li) h += `<p class="tr">L<sub>${li}</sub> = ${d.n}</p>`; tip(e, h); }
    else htip();
    if (hits.length > 0) tmv(e);
  });
  R.animFn = () => {};
}
