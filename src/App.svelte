<script>
import { onMount, afterUpdate } from 'svelte';
import { get } from 'svelte/store';
import { scenes } from './scenes/index.js';
import { cur, goTo } from './lib/state.js';
import {
  THREE, CSS2DRenderer,
  R, disposeScene, resetTip,
} from './scenes/shared.js';

let glc, ov, tt, rain, labelHost, panelwrap, camCoords, clkDisplay;
let renderer, labelRenderer, rafId = 0;
let active = 7;
const unsub = cur.subscribe(v => { active = v; });

function resize() {
  if (!glc || !renderer) return;
  const w = glc.clientWidth || 960;
  const h = glc.clientHeight || 480;
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
  if (R.camera) {
    R.camera.aspect = w / h;
    R.camera.updateProjectionMatrix();
  }
}

function show(idx) {
  disposeScene();
  resetTip();
  R.animFn = null;
  R.cur = idx;
  ov.innerHTML = '';
  if (clkDisplay) clkDisplay.innerHTML = '';
  scenes[idx].build();
  resize();
}

let _loopFrame = 0;
function loop(t) {
  rafId = requestAnimationFrame(loop);
  if (R.controls) R.controls.update();
  if (R.animFn) R.animFn(t);
  if (R.scene && R.camera) {
    renderer.render(R.scene, R.camera);
    labelRenderer.render(R.scene, R.camera);
    if (camCoords && ++_loopFrame % 4 === 0) {
      const p = R.camera.position;
      camCoords.textContent = `x ${p.x.toFixed(1)}\ny ${p.y.toFixed(1)}\nz ${p.z.toFixed(1)}`;
    }
  }
}

function onKey(e) {
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.key === 'ArrowRight') goTo(get(cur) + 1);
  else if (e.key === 'ArrowLeft') goTo(get(cur) - 1);
  else if (/^[1-9]$/.test(e.key)) goTo(parseInt(e.key, 10) - 1);
}

function fullscreen() {
  const el = panelwrap;
  if (document.fullscreenElement) document.exitFullscreen();
  else if (el.requestFullscreen) el.requestFullscreen();
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
}

function startRain() {
  const ctx = rain.getContext('2d');
  const glyphs = '01ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｹﾑﾕﾗｾﾈｽﾀﾇﾍ896FibLucasφτ';
  let cols, drops;
  const fit = () => {
    rain.width = innerWidth;
    rain.height = innerHeight;
    cols = Math.floor(rain.width / 14);
    drops = Array.from({ length: cols }, () => Math.random() * rain.height / 14);
  };
  fit();
  const onResize = () => fit();
  addEventListener('resize', onResize);
  const iv = setInterval(() => {
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, 0, rain.width, rain.height);
    ctx.font = '13px monospace';
    for (let i = 0; i < cols; i++) {
      const ch = glyphs[Math.floor(Math.random() * glyphs.length)];
      ctx.fillStyle = Math.random() < 0.03 ? '#ff9800' : '#00ff88';
      ctx.fillText(ch, i * 14, drops[i] * 14);
      if (drops[i] * 14 > rain.height && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    }
  }, 66);
  return () => { clearInterval(iv); removeEventListener('resize', onResize); };
}

onMount(async () => {
  R.canvas = glc; R.ov = ov; R.tt = tt; R.clkDisplay = clkDisplay;
  renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  labelHost.appendChild(labelRenderer.domElement);
  R.renderer = renderer; R.labelRenderer = labelRenderer;

  // ── URL param restore ────────────────────────────────────────────────────
  const urlP = new URLSearchParams(location.search);
  const initScene = Math.min(Math.max(parseInt(urlP.get('s') ?? '7', 10), 0), scenes.length - 1);
  if (initScene !== 7) cur.set(initScene);   // sync store if needed
  show(initScene);
  // apply saved camera
  if (urlP.has('cx') && R.camera) {
    const [cx, cy, cz] = ['cx','cy','cz'].map(k => parseFloat(urlP.get(k) ?? '0'));
    const [tx, ty, tz] = ['tx','ty','tz'].map(k => parseFloat(urlP.get(k) ?? '0'));
    R.camera.position.set(cx, cy, cz);
    R.camera.lookAt(tx, ty, tz);
    if (R.controls) { R.controls.target.set(tx, ty, tz); R.controls.update(); }
  }
  // apply scene-7 slider/toggle params
  if (initScene === 7) {
    for (const key of ['rbase','rgrow','hstep','bamp','bfreq','spin']) {
      if (!urlP.has(key)) continue;
      const el = document.getElementById(`p8_${key}`);
      if (el) { el.value = urlP.get(key); el.dispatchEvent(new Event('input')); }
    }
    for (const id of ['inv','shade','comp']) {
      if (urlP.get(id) === '1') {
        const btn = document.getElementById(`p8${id}`);
        if (btn && !btn.classList.contains('lit')) btn.click();
      }
    }
  }

  // ── SHARE button ──────────────────────────────────────────────────────────
  document.getElementById('shareBtn').addEventListener('click', () => {
    const p = new URLSearchParams();
    p.set('s', R.cur);
    if (R.camera) {
      const pos = R.camera.position;
      p.set('cx', pos.x.toFixed(2)); p.set('cy', pos.y.toFixed(2)); p.set('cz', pos.z.toFixed(2));
    }
    if (R.controls) {
      const tgt = R.controls.target;
      p.set('tx', tgt.x.toFixed(2)); p.set('ty', tgt.y.toFixed(2)); p.set('tz', tgt.z.toFixed(2));
    }
    if (R.cur === 7) {
      for (const key of ['rbase','rgrow','hstep','bamp','bfreq','spin']) {
        const el = document.getElementById(`p8_${key}`); if (el) p.set(key, el.value);
      }
      for (const id of ['inv','shade','comp']) {
        const btn = document.getElementById(`p8${id}`);
        if (btn) p.set(id, btn.classList.contains('lit') ? '1' : '0');
      }
    }
    const url = `${location.origin}${location.pathname}?${p}`;
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById('shareBtn');
      const orig = btn.textContent; btn.textContent = 'COPIED!';
      setTimeout(() => { btn.textContent = orig; }, 1400);
    });
  });

  const stopRain = startRain();
  rafId = requestAnimationFrame(loop);
  addEventListener('resize', resize);
  addEventListener('keydown', onKey);
  document.addEventListener('fullscreenchange', resize);
  return () => {
    stopRain();
    cancelAnimationFrame(rafId);
    removeEventListener('resize', resize);
    removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', resize);
    disposeScene();
    renderer.dispose();
    labelRenderer.domElement.remove();
  };
});

// react to scene switches
$: if (renderer && active !== R.cur) show(active);

function hlCode(raw) {
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const w = (s, c) => `<span class="${c}">${esc(s)}</span>`;
  const KW = new Set(['const','let','var','function','return','class','import','from','new',
                      'if','else','while','for','of','in','not','and','or',
                      'def','True','False','None','pass']);
  const FN = new Set(['Math','parseInt','parseFloat','Array','set','range','reversed',
                      'append','join','sorted','len','print','Date','THREE','document']);
  let r = '', i = 0;
  while (i < raw.length) {
    // line comments
    if (raw[i] === '#' || (raw[i] === '/' && raw[i+1] === '/')) {
      const end = raw.indexOf('\n', i);
      const seg = end < 0 ? raw.slice(i) : raw.slice(i, end);
      r += w(seg, 'c-cm'); i += seg.length; continue;
    }
    // strings
    if (raw[i] === "'" || raw[i] === '"') {
      const q = raw[i]; let j = i + 1;
      while (j < raw.length && raw[j] !== q) { if (raw[j] === '\\') j++; j++; }
      if (j < raw.length) j++;
      r += w(raw.slice(i, j), 'c-st'); i = j; continue;
    }
    // numbers
    if (/\d/.test(raw[i]) && (i === 0 || !/[a-zA-Z0-9_]/.test(raw[i-1]))) {
      let j = i;
      while (j < raw.length && /\d/.test(raw[j])) j++;
      if (j < raw.length && raw[j] === '.' && j+1 < raw.length && /\d/.test(raw[j+1])) {
        j++; while (j < raw.length && /\d/.test(raw[j])) j++;
      }
      r += w(raw.slice(i, j), 'c-nu'); i = j; continue;
    }
    // identifiers
    if (/[a-zA-Z_]/.test(raw[i])) {
      let j = i; while (j < raw.length && /\w/.test(raw[j])) j++;
      const word = raw.slice(i, j);
      r += KW.has(word) ? w(word, 'c-kw') : FN.has(word) ? w(word, 'c-fn') : esc(word);
      i = j; continue;
    }
    r += esc(raw[i]); i++;
  }
  return r;
}

afterUpdate(() => {
  document.querySelectorAll('.writeup pre code:not([data-hl])').forEach(el => {
    el.innerHTML = hlCode(el.textContent);
    el.setAttribute('data-hl', '1');
  });
});
</script>

<canvas id="rain" bind:this={rain}></canvas>

<div class="hdr">
  <h1>JENNIE 21</h1>
  <div class="sub">2<sup>7</sup> &times; 7 &nbsp;&middot;&nbsp; Lucas<sub>4</sub>=7 &nbsp;&middot;&nbsp; &tau;(896)=16 active experts &nbsp;&middot;&nbsp; Kimi K3 MoE &nbsp;&middot;&nbsp; 1/89=&Sigma;F(n)/10<sup>n+1</sup> &nbsp;&middot;&nbsp; dr(896)=5, dr(897)=6</div>
  <div class="gleg">
    <span style="color:#00ff88">&#9679; Fibonacci</span>
    <span style="color:#00e5ff">&#9679; Lucas</span>
    <span style="color:#ffe600">&#9679; Fib &cap; Lucas</span>
    <span style="color:#ff9800">&#9679; 896</span>
    <span style="color:#2a3a2a">&#9679; Neither</span>
  </div>
</div>

<div class="nav">
  <button class="nav-arr" disabled={active === 0} on:click={() => goTo(active - 1)}>&larr; PREV</button>
  <div class="slide-dots">
    {#each scenes as s, i}
      <div class="dot" class:on={i === active} on:click={() => goTo(i)}></div>
    {/each}
  </div>
  <div class="slide-info">{active + 1} / {scenes.length}</div>
  <button class="nav-arr" disabled={active === scenes.length - 1} on:click={() => goTo(active + 1)}>NEXT &rarr;</button>
  <button class="nav-arr" id="shareBtn">&#x2398; SHARE</button>
</div>

<div class="tabs">
  {#each scenes as s, i}
    <div class="tab" class:on={i === active} on:click={() => goTo(i)}><span class="n">{s.num}</span>{s.label}</div>
  {/each}
</div>

<div class="pw" id="panelwrap" bind:this={panelwrap}>
  <div id="tt" bind:this={tt}></div>
  <div class="canvaswrap" bind:this={labelHost}>
    <canvas id="glc" bind:this={glc}></canvas>
    <div id="camCoords" bind:this={camCoords}></div>
    <div class="ov" bind:this={ov}></div>
    <div id="clkDisplay" bind:this={clkDisplay}></div>
    <button id="fsBtn2" on:click={fullscreen}>&#x26F6; FULL</button>
  </div>
  <div class="ctrls">
    <div class="cset" class:on={active === 0}><span class="stat">drag to rotate &nbsp;&middot;&nbsp; hover a node</span><span class="stat" id="p1stat"></span></div>
    <div class="cset" class:on={active === 1}>
      <button class="btn" id="p2pp">PAUSE</button>
      <button class="btn" id="p2rst">RESET</button>
      <span class="clbl">speed</span>
      <select id="p2spd"><option value="0.4">0.4x</option><option value="1" selected>1x</option><option value="2">2x</option><option value="5">5x</option></select>
      <span class="stat" id="p2stat"></span>
    </div>
    <div class="cset" class:on={active === 2}>
      <button class="btn lit" id="p3rot">AUTO-ROTATE</button>
      <button class="btn" id="p3fib">FIB+LUCAS ONLY</button>
      <span class="stat">drag &middot; scroll to zoom</span>
    </div>
    <div class="cset" class:on={active === 3}>
      <button class="btn pu" id="p4rt">ROUTE TOKEN</button>
      <span class="badge" id="p4cnt">tokens: 0</span>
      <span class="stat" id="p4stat">hover an expert</span>
    </div>
    <div class="cset" class:on={active === 4}><span class="stat">drag to rotate &nbsp;&middot;&nbsp; hover a letter</span></div>
    <div class="cset" class:on={active === 5}><span class="stat">scroll to zoom &nbsp;&middot;&nbsp; hover a seed</span></div>
    <div class="cset" class:on={active === 6}>
      <span class="clbl">layers</span>
      <button class="btn" id="s6n_dn">−</button>
      <button class="btn" id="s6n_up">+</button>
      <input id="s6input" type="number" placeholder="decimal">
      <button class="btn" id="s6set">SET</button>
      <button class="btn" id="s6reset">RESET 896</button>
      <button class="btn" id="s6rand">RANDOM</button>
      <button class="btn" id="s6play">▶ PLAY</button>
      <select id="s6speed">
        <option value="100">fast</option>
        <option value="250">med</option>
        <option value="500" selected>slow</option>
        <option value="1000">v.slow</option>
      </select>
      <span class="stat">click cell to cycle trit &nbsp;&middot;&nbsp; drag to rotate</span>
    </div>
    <div class="cset" class:on={active === 7}>
      <button class="btn lit" id="p8rot">AUTO-ROTATE</button>
      <button class="btn" id="p8comp">COMPLEMENT</button>
      <button class="btn" id="p8inv">INVERSION</button>
      <button class="btn" id="p8shade">SHADING</button>
      <span class="clbl">A</span>
      <button class="btn" id="p8a_cw">CW</button>
      <button class="btn" id="p8a_ccw">CCW</button>
      <span class="clbl">B</span>
      <button class="btn" id="p8b_cw">CW</button>
      <button class="btn" id="p8b_ccw">CCW</button>
      <button class="btn" id="p8v_side">SIDE</button>
      <button class="btn" id="p8v_top">TOP</button>
      <button class="btn" id="p8v_hero">HERO</button>
      <span class="stat" id="p8stat"></span>
      <div class="srow">
        <span class="clbl">base-r</span><input type="range" id="p8_rbase" min="0.05" max="0.80" step="0.01" value="0.28"><span class="sval" id="p8_rbase_v">0.28</span>
        <span class="clbl">flare</span><input type="range" id="p8_rgrow" min="0.00" max="0.40" step="0.01" value="0.13"><span class="sval" id="p8_rgrow_v">0.13</span>
        <span class="clbl">pitch</span><input type="range" id="p8_hstep" min="0.20" max="2.00" step="0.02" value="0.68"><span class="sval" id="p8_hstep_v">0.68</span>
        <span class="clbl">breath</span><input type="range" id="p8_bamp" min="0.00" max="0.30" step="0.01" value="0.10"><span class="sval" id="p8_bamp_v">0.10</span>
        <span class="clbl">rate</span><input type="range" id="p8_bfreq" min="0.05" max="2.00" step="0.05" value="0.50"><span class="sval" id="p8_bfreq_v">0.50</span>
        <span class="clbl">spin</span><input type="range" id="p8_spin" min="0.05" max="2.00" step="0.05" value="0.40"><span class="sval" id="p8_spin_v">0.40</span>
      </div>
    </div>
    <div class="cset" class:on={active === 8}>
      <button class="btn" id="p9rot">AUTO-ROTATE</button>
      <button class="btn" id="p9ring">RING SPIN</button>
      <span class="stat">drag to rotate &nbsp;&middot;&nbsp; hover a clock digit</span>
      <span class="stat" id="p9stat"></span>
    </div>
    <div class="cset" class:on={active === 9}>
      <button class="btn lit" id="p10rot">AUTO-ROTATE</button>
      <span class="stat">drag to rotate &nbsp;&middot;&nbsp; hover a period node</span>
      <span class="stat" id="p10stat"></span>
    </div>
  </div>
</div>

<div class="hint">&larr; &rarr; arrow keys &nbsp;&middot;&nbsp; tabs or dots &nbsp;&middot;&nbsp; keys 1&ndash;9</div>

{#if active === 7}
<div class="writeup">
  <div class="writeup-hdr">08 · JENNIE 21 — how it works</div>
  <article>
    <h1>The Number</h1>
    <p>896 equals 2<sup>7</sup> × 7. To get 896, double 1 seven times, then multiply by 7.</p>
    <p>896 has 16 divisors. Its digital root (dr) is 5. The digital root of 897 is 6.
    The number 6 is the nil element. Its position next to 896 is important.</p>

    <hr>

    <h2>The Orbit</h2>
    <p>Start at 1. Multiply by 2. Divide the result by 9 and keep the remainder. Repeat this step.</p>
    <pre><code>1 → 2 → 4 → 8 → 16 mod 9 = 7 → 14 mod 9 = 5 → 10 mod 9 = 1 → ...</code></pre>
    <p>This process gives 6 values: <em>1 → 2 → 4 → 8 → 7 → 5</em>. These 6 values repeat in the same order. This is the orbit.</p>
    <p>The values 3, 6, and 9 do not enter the orbit. They follow their own separate cycle. <strong>The value 9 does not appear in this visualization.</strong></p>
    <pre><code>orbit = []
n, seen = 1, set()
while n not in seen:
    seen.add(n); orbit.append(n); n = (n * 2) % 9
# result: [1, 2, 4, 8, 7, 5]</code></pre>

    <hr>

    <h2>Echo Pairs</h2>
    <p>Each orbit value has one echo value. Add an orbit value to its echo value to get 9.</p>
    <p>1↔8 &nbsp;·&nbsp; 2↔7 &nbsp;·&nbsp; 4↔5</p>
    <p>This visualization uses two helix strands. Strand A carries the orbit values. Strand B carries the echo values. Strand B is offset by π radians (180°) from Strand A.</p>
    <p>Each rung connects a node on Strand A to its echo node on Strand B.</p>
    <p>The orbit values form two groups: {2, 4, 7} with sum 13, and {5, 8} with sum 13. Both groups have the same sum.</p>

    <hr>

    <h2>Balanced Ternary</h2>
    <p>Balanced ternary (BT) is a number system that uses 3 digits: −1, 0, and +1.</p>
    <p>This visualization maps those digits to the values 5, 6, and 7:</p>
    <ul>
      <li>5 = −1</li>
      <li>6 = 0 (nil)</li>
      <li>7 = +1</li>
    </ul>
    <p>The zero digit is 6. The value 6 is the nil element — it does not appear in the orbit. The BT system uses 6 as its center because 6 is the absent value.</p>
    <pre><code>def to_bt(n):
    if n == 0: return '6'
    digits = []
    while n != 0:
        r = n % 3
        if r == 0:   digits.append('6'); n //= 3
        elif r == 1: digits.append('7'); n = (n - 1) // 3
        else:        digits.append('5'); n = (n + 1) // 3
    return ''.join(reversed(digits))

# 1→'7'  2→'75'  4→'77'  5→'755'  7→'757'  8→'765'</code></pre>
    <p>The value 7 gives the BT string <code>757</code>. This string reads the same forwards and backwards (palindrome). This means 7 is symmetric in this number system.</p>

    <hr>

    <h2>The Shape: Golden Angle Cone</h2>
    <p>The golden angle (GA) is 137.508°. It equals 2π × (2 − φ), where φ = (1 + √5) / 2.</p>
    <p>Each new node rotates exactly 137.508° from the previous node. Because this angle is irrational, no two nodes share the same angular position.</p>
    <p>Each node also moves outward (larger radius) and upward as the step number increases. This produces a cone shape — a tornado.</p>
    <p>From above, the nodes show the Fibonacci sunflower pattern. From the side, they show a double helix that expands as it rises.</p>
    <pre><code>const PHI = (1 + Math.sqrt(5)) / 2;
const GA  = 2 * Math.PI * (2 - PHI);   // golden angle ≈ 137.508°

const nodePos = (step, offset = 0) => (&lbrace;
  x: (0.28 + step * 0.13) * Math.cos(step * GA + offset),
  y:  step * 0.68,
  z: (0.28 + step * 0.13) * Math.sin(step * GA + offset),
&rbrace;);
// Strand A: offset = 0
// Strand B: offset = Math.PI  (180° apart)</code></pre>

    <hr>

    <h2>The 21 Arc</h2>
    <p>After 21 steps, the total rotation is 21 × 137.508° = 2887.7°.</p>
    <p>This equals 8 full rotations plus 7.7°. The spiral has almost returned to its starting direction.</p>
    <p>21 is the 8th Fibonacci number (F₈). The current visualization runs all 21 steps. At step 21 the helix has completed 8 full turns plus 7.7° — almost but not exactly closed, which is what makes the near-return visible as a distinct structural event.</p>

    <hr>

    <h2>The Breath Animation</h2>
    <p>All nodes, lines, and labels use one shared scale value called <em>breath</em>.</p>
    <p>The breath value oscillates between 0.90 and 1.10. One full cycle takes approximately 12.6 seconds.</p>
    <pre><code>const breath = 1 + 0.10 * Math.sin(t * 0.50);
// range: 0.90 to 1.10  |  cycle: ~12.6 seconds

node.y  = baseY(step) * breath;
label.y = baseY(step) * breath;
line.y  = baseY(step) * breath;  // applied to both line endpoints</code></pre>
    <p>All parts of the structure use the same breath value. The structure expands and contracts as one unit.</p>
    <p>Doubling (×2) is the exhale — expansion, the orbit's forward pass. Halving (÷2) is the inhale — contraction, the return current. The accordion breathes both ways.</p>

    <hr>

    <h2>The Pulsating Inversion (F₈ = 21)</h2>
    <p>The helix runs 21 steps — F₈, the 8th Fibonacci number. After 21 steps the total rotation is 21 × 137.508° ≈ 8 full turns plus 7.7°, nearly closing.</p>
    <p>Press <strong>INVERSION</strong> to reveal a counter-phase ghost layer anchored at step 20 (count 21). The ghost nodes occupy the same orbital positions as Strand A but breathe in opposition:</p>
    <pre><code>const breathInv = 1 - 0.10 * Math.sin(t * 0.50); // counter-phase

ghost.y = baseY(step) * breathInv;
// when breath = 1.10, breathInv = 0.90 — inversion contracts as main expands</code></pre>
    <p>Phase-tension lines connect each primary node to its ghost counterpart, stretching and collapsing twice per cycle. The golden ring at step 20 is the anchor: the boundary inside which the inversion lives.</p>
    <p>The structure has a 3×7 interpretation: 3 full orbit cycles of 7 values (6 active + the nil 6) = 21. It is also the triangular number T₆ = 21. Both readings converge on the same boundary.</p>

    <hr>

    <h2>757 = ∞</h2>
    <p>757 is a prime number. Its balanced ternary representation is <code>1001001</code> — powers of 3 at positions 0, 3, and 6, evenly spaced, a lattice.</p>
    <pre><code>757 = 3⁶ + 3³ + 3⁰ = 729 + 27 + 1
    = (3⁹ − 1) / (3³ − 1)         # base-27 repunit
BT(7)   = "757"   — palindrome in display
BT(757) = 1001001 — palindrome in balanced ternary
757 in binary: 1011110101 — contains exactly 7 ones</code></pre>
    <p>In the orbit system, 7 encodes to the display string "757." The number 757 itself encodes to the balanced ternary palindrome "1001001." Palindrome on palindrome. 757 is prime — indivisible by any operation in the system. It is the internal infinity: not the wall at 896, not the threshold at 897, but the unreachable fixed point inside the structure. The thing that reflects without distortion.</p>
  </article>
</div>
{/if}
