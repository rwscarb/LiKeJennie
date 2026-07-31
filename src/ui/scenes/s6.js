// ── Scene 6 · 3×3×N Trit Matrix ──────────────────────
// Trits stored as {0,1,2} → displayed as {6,7,8}; 7 is neutral (balanced ternary: −1,0,+1)
import {
  THREE, CSS2DObject, R, mkCamera, mkControls, disposeScene,
  tip, tmv, htip,
} from './shared.js';

let s6_nLayers = 1, s6_trits = null, s6_gen = 0, s6_playInterval = null;
// 896 balanced ternary LSB-first: -1,-1,+1,0,-1,+1,+1 → stored as 0,0,2,1,0,2,2
// Verify: (-1)·1+(-1)·3+(+1)·9+(0)·27+(-1)·81+(+1)·243+(+1)·729 = -1-3+9+0-81+243+729 = 896 ✓
const S6_B3_896 = [0, 0, 2, 1, 0, 2, 2];
function s6_init896() { s6_trits = Array(9 * s6_nLayers).fill(1); S6_B3_896.forEach((v, i) => { if (i < s6_trits.length) s6_trits[i] = v; }); }
function s6_toBalB3(n) {
  if (n === 0) return '0';
  const neg = n < 0; n = Math.abs(n); let s = '';
  // standard base-3 then convert to balanced
  const d = []; while (n > 0) { d.push(n % 3); n = Math.floor(n / 3); }
  let carry = 0; const bd = d.map(v => { let r = v + carry; carry = 0; if (r === 2) { r = -1; carry = 1; } else if (r === 3) { r = 0; carry = 1; } return r; });
  if (carry) bd.push(carry);
  s = bd.reverse().map(v => v === 1 ? '+' : v === 0 ? '0' : '−').join('');
  return (neg ? '−' : '') + s;
}
function s6_dec() { let v = 0; s6_trits.forEach((t, i) => { v += (t - 1) * Math.pow(3, i); }); return v; }

export function buildS6() {
  const canvas = R.canvas, ov = R.ov;
  const myGen = ++s6_gen;
  if (!s6_trits) s6_init896();
  const N = s6_nLayers;
  const scene = R.scene = new THREE.Scene();
  const camera = R.camera = mkCamera(); camera.position.set(N * 0.9 + 3, 3.5, N * 1.2 + 5); camera.lookAt(1.5, 1.5, -N * 0.75);
  const controls = R.controls = mkControls(camera); controls.autoRotate = true; controls.autoRotateSpeed = 0.35;
  controls.target.set(1.5, 1.5, -(N - 1) * 0.75); controls.update();

  const SP = 1.55;
  // 0=6(neg,red) 1=7(neutral,dim) 2=8(pos,green)
  const TC = [0x3d0011, 0x0a1a0a, 0x00ff88];
  const TE = [0x220000, 0x040804, 0x007733];
  const TCS = ['#ff2d78', '#1a3a1a', '#00ff88'];
  const TLBL = ['6', '7', '8'];
  const localMeshes = [];
  const labelEls = [];

  function updateOv() {
    const val = s6_dec(); const b3 = s6_toBalB3(val);
    const sigs = { '896': '★ 2⁷×7', '6272': '★ 2⁷×7²', '128': '★ 2⁷', '42': '★ 42', '7': '★ L₄', '2': '★ F₃', '1': '★ 1', '0': '∅', '-896': '★ −896' };
    const sig = sigs[String(val)] || '';
    ov.innerHTML = `<div style="color:#2a9060;letter-spacing:.1em">07 · TRIT MATRIX</div>` +
      `<div style="color:#2a6048;margin-top:3px">3×3×${N} · ${9 * N} trits</div>` +
      `<div style="margin-top:5px;font-size:9px"><span style="color:#2a6048">dec: </span><span style="color:#00ff88">${val}</span></div>` +
      `<div style="font-size:9px"><span style="color:#2a6048">bal3: </span><span style="color:#ff9800">${b3}</span></div>` +
      (sig ? `<div style="font-size:10px;color:#ffe600;margin-top:4px">${sig}</div>` : '') +
      `<div style="color:#2a6048;margin-top:5px;font-size:8px">drag to rotate · click cell</div>`;
    const inp = document.getElementById('s6input'); if (inp) inp.value = val;
  }

  function updateCell(idx) {
    const tv = s6_trits[idx]; const m = localMeshes[idx];
    m.material.color.setHex(TC[tv]); m.material.emissive.setHex(TE[tv]);
    m.material.emissiveIntensity = tv === 0 ? 0.08 : 0.5; m.material.opacity = tv === 0 ? 0.2 : 0.9;
    labelEls[idx].textContent = TLBL[tv]; labelEls[idx].style.color = TCS[tv];
    updateOv();
  }

  const cellGeo = new THREE.BoxGeometry(0.88, 0.88, 0.88); R.disposables.push(cellGeo);
  for (let z = 0; z < N; z++) for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    const idx = x + 3 * y + 9 * z, tv = s6_trits[idx] || 0;
    const mat = new THREE.MeshPhongMaterial({ color: TC[tv], emissive: TE[tv], emissiveIntensity: tv === 0 ? 0.08 : 0.5, transparent: true, opacity: tv === 0 ? 0.2 : 0.9, shininess: 95 });
    R.disposables.push(mat);
    const m = new THREE.Mesh(cellGeo, mat);
    m.position.set(x * SP, y * SP, -z * SP); m.userData = { x, y, z, idx }; scene.add(m); localMeshes.push(m);
    const div = document.createElement('div');
    div.className = 'node-lbl'; div.style.fontSize = '14px'; div.style.fontWeight = 'bold'; div.style.color = TCS[tv]; div.textContent = TLBL[tv];
    const lbl = new CSS2DObject(div); lbl.position.set(x * SP, y * SP + 0.58, -z * SP);
    scene.add(lbl); R.css2dObjects.push(lbl); labelEls.push(div);
  }

  // Layer separator planes
  for (let z = 0; z < N - 1; z++) {
    const pg = new THREE.PlaneGeometry(3 * SP + 0.2, 3 * SP + 0.2);
    const pm = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.04, side: THREE.DoubleSide });
    R.disposables.push(pg, pm); const pl = new THREE.Mesh(pg, pm);
    pl.position.set(SP, SP, -(z + 0.5) * SP); pl.rotation.y = Math.PI / 2; scene.add(pl);
  }

  scene.add(new THREE.AmbientLight(0xffffff, 0.18));
  const pl1 = new THREE.PointLight(0x00ff88, 1.3, 40); pl1.position.set(5, 8, 6); scene.add(pl1);
  const pl2 = new THREE.PointLight(0xff9800, 0.8, 25); pl2.position.set(-3, -2, 4); scene.add(pl2);

  updateOv();

  // click → cycle trit
  function s6click(e) {
    if (R.cur !== 6 || s6_gen !== myGen) { canvas.removeEventListener('click', s6click); return; }
    const r = canvas.getBoundingClientRect();
    const mv = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(mv, R.camera);
    const hits = rc.intersectObjects(localMeshes);
    if (hits.length > 0) { const idx = hits[0].object.userData.idx; s6_trits[idx] = (s6_trits[idx] + 1) % 3; updateCell(idx); }
  }
  canvas.addEventListener('click', s6click);

  // hover tooltip
  const rayH = new THREE.Raycaster(); const mh = new THREE.Vector2();
  function s6hover(e) {
    if (R.cur !== 6 || s6_gen !== myGen) { canvas.removeEventListener('mousemove', s6hover); return; }
    const r = canvas.getBoundingClientRect();
    mh.x = ((e.clientX - r.left) / r.width) * 2 - 1; mh.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    rayH.setFromCamera(mh, R.camera);
    const hits = rayH.intersectObjects(localMeshes);
    if (hits.length > 0) {
      const { x, y, z, idx } = hits[0].object.userData; const tv = s6_trits[idx]; const pw = Math.pow(3, idx); const bv = tv - 1;
      let h = `<div class="th" style="color:${TCS[tv]}">trit [${x},${y},${z}]</div>`;
      h += `<p class="tr">display: <b style="color:${TCS[tv]}">${TLBL[tv]}</b> &nbsp; balanced: <b>${bv === 1 ? '+1' : bv === 0 ? '0' : '−1'}</b></p>`;
      h += `<p class="tr">weight: 3<sup>${idx}</sup> = ${pw}</p>`;
      h += `<p class="tr">contribution: <b>${bv * pw >= 0 ? '+' : ''}${bv * pw}</b></p>`;
      h += `<p class="tr" style="color:#1a4030">click to cycle 6→7→8→6</p>`;
      tip(e, h); tmv(e);
    } else htip();
  }
  canvas.addEventListener('mousemove', s6hover);

  // N controls
  function s6rebuild() { if (R.cur !== 6) return; disposeScene(); R.animFn = null; ov.innerHTML = ''; buildS6(); }
  document.getElementById('s6n_up').onclick = () => { if (s6_nLayers >= 12) return; s6_nLayers++; s6_trits = [...s6_trits, ...Array(9).fill(1)]; s6rebuild(); };
  document.getElementById('s6n_dn').onclick = () => { if (s6_nLayers <= 1) return; s6_nLayers--; s6_trits = s6_trits.slice(0, 9 * s6_nLayers); s6rebuild(); };
  function s6_fromDecimal(n) {
    // Convert integer n to balanced ternary, stored as {0,1,2} (internal: -1,0,+1 → 0,1,2)
    if (n === 0) { s6_trits = s6_trits.map(() => 1); return; }
    const neg = n < 0; n = Math.abs(n);
    // standard base-3 digits then convert to balanced
    const d = []; let tmp = n; while (tmp > 0) { d.push(tmp % 3); tmp = Math.floor(tmp / 3); }
    let carry = 0;
    const bd = d.map(v => { let r = v + carry; carry = 0; if (r === 3) { r = 0; carry = 1; } else if (r === 2) { r = -1; carry = 1; } return r; });
    if (carry) bd.push(carry);
    // bd is LSB-first balanced ternary digits: -1,0,+1
    const needed = bd.length;
    // expand layers if needed
    while (9 * s6_nLayers < needed) { s6_nLayers++; s6_trits = [...s6_trits, ...Array(9).fill(1)]; }
    s6_trits = s6_trits.map(() => 1); // reset to neutral
    bd.forEach((bv, i) => {
      // if negative number, flip all signs
      const v = neg ? -bv : bv;
      s6_trits[i] = v + 1; // map -1→0, 0→1, +1→2
    });
  }
  function s6doSet() {
    const raw = document.getElementById('s6input').value.trim();
    const n = parseInt(raw, 10);
    if (isNaN(n)) return;
    const neededLayers = Math.ceil(Math.max(1, Math.ceil(Math.log(Math.abs(n) + 1) / Math.log(3))) / 9);
    if (neededLayers > s6_nLayers) { s6_nLayers = Math.min(neededLayers, 12); s6_trits = Array(9 * s6_nLayers).fill(1); }
    s6_fromDecimal(n);
    if (neededLayers > 4) { s6rebuild(); } else { s6_trits.forEach((_, i) => updateCell(i)); }
  }
  document.getElementById('s6set').onclick = s6doSet;
  let s6_inputTimer = null;
  document.getElementById('s6input').addEventListener('input', () => {
    clearTimeout(s6_inputTimer);
    s6_inputTimer = setTimeout(s6doSet, 350);
  });
  document.getElementById('s6input').addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(s6_inputTimer); s6doSet(); } });
  document.getElementById('s6reset').onclick = () => { s6_init896(); s6_trits.forEach((_, i) => updateCell(i)); };
  document.getElementById('s6rand').onclick = () => { s6_trits = s6_trits.map(() => Math.floor(Math.random() * 3)); s6_trits.forEach((_, i) => updateCell(i)); };

  function s6_stopPlay() {
    if (s6_playInterval) { clearInterval(s6_playInterval); s6_playInterval = null; }
    const pb = document.getElementById('s6play');
    if (pb) { pb.textContent = '▶ PLAY'; pb.style.color = ''; }
  }
  document.getElementById('s6play').onclick = () => {
    if (s6_playInterval) {
      s6_stopPlay();
    } else {
      const myGen = s6_gen;
      const pb = document.getElementById('s6play');
      pb.textContent = '⏸ PAUSE'; pb.style.color = '#ff2d78';
      const ms = parseInt(document.getElementById('s6speed').value, 10) || 500;
      s6_playInterval = setInterval(() => {
        if (R.cur !== 6 || s6_gen !== myGen) { s6_stopPlay(); return; }
        s6_fromDecimal(s6_dec() + 1);
        s6_trits.forEach((_, i) => updateCell(i));
      }, ms);
    }
  };

  R.animFn = () => {
    const t = Date.now() * .001;
    localMeshes.forEach((m, i) => { if (s6_trits[i] > 0) m.material.emissiveIntensity = 0.38 + 0.18 * Math.sin(t * 1.4 + i * 0.28); });
    if (R.cur === 6) R.labelRenderer.render(scene, camera);
  };
}
