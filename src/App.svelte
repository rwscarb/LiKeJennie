<script>
import { onMount } from 'svelte';
import { get } from 'svelte/store';
import { scenes } from './scenes/index.js';
import { cur, goTo } from './lib/state.js';
import {
  THREE, CSS2DRenderer,
  R, disposeScene, resetTip,
} from './scenes/shared.js';

let glc, ov, tt, rain, labelHost, panelwrap;
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
  scenes[idx].build();
  resize();
}

function loop(t) {
  rafId = requestAnimationFrame(loop);
  if (R.controls) R.controls.update();
  if (R.animFn) R.animFn(t);
  if (R.scene && R.camera) {
    renderer.render(R.scene, R.camera);
    labelRenderer.render(R.scene, R.camera);
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
  R.canvas = glc; R.ov = ov; R.tt = tt;
  renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  labelHost.appendChild(labelRenderer.domElement);
  R.renderer = renderer; R.labelRenderer = labelRenderer;

  show(7);
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
    <div class="ov" bind:this={ov}></div>
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
      <button class="btn" id="p8v_side">SIDE</button>
      <button class="btn" id="p8v_top">TOP</button>
      <button class="btn" id="p8v_hero">HERO</button>
      <span class="stat" id="p8stat"></span>
    </div>
    <div class="cset" class:on={active === 8}>
      <button class="btn lit" id="p9rot">AUTO-ROTATE</button>
      <span class="stat">drag to rotate &nbsp;&middot;&nbsp; hover a clock digit</span>
      <span class="stat" id="p9stat"></span>
    </div>
  </div>
</div>

<div class="hint">&larr; &rarr; arrow keys &nbsp;&middot;&nbsp; tabs or dots &nbsp;&middot;&nbsp; keys 1&ndash;9</div>

{#if active === 7}
<div class="writeup">
  <div class="writeup-hdr">08 · JENNIE 21 — how it works</div>
  <article>
    <h1>The Number</h1>
    <p><strong>896 = 2<sup>7</sup> × 7.</strong> Seven doublings of 1, then multiplied by 7.
    The divisor count τ(896) = 16. Digital root 5. Its neighbor: dr(897) = 6 — the nil element.
    That adjacency matters.</p>

    <hr>

    <h2>The Orbit</h2>
    <p>Start at 1. Double it. Take the result mod 9. Repeat.</p>
    <pre><code>1 → 2 → 4 → 8 → 16 mod 9 = 7 → 14 mod 9 = 5 → 10 mod 9 = 1 → ...</code></pre>
    <p>Six values cycling forever: <em>1 → 2 → 4 → 8 → 7 → 5</em>.
    Missing: 3, 6, and 9. They form their own closed system under ×2 mod 9 and never enter this orbit.
    <strong>9 does not appear.</strong> It is structurally excluded, not suppressed.</p>
    <pre><code>orbit = []
n, seen = 1, set()
while n not in seen:
    seen.add(n); orbit.append(n); n = (n * 2) % 9
# [1, 2, 4, 8, 7, 5]</code></pre>

    <hr>

    <h2>The Echo Pairs</h2>
    <p>Every orbit value has a complement: the number you add to it to reach 9.</p>
    <p>1↔8 &nbsp;·&nbsp; 2↔7 &nbsp;·&nbsp; 4↔5</p>
    <p>The visualization runs two helix strands π radians apart — Strand A carries the orbit,
    Strand B carries the echoes. Every rung connects a node to its echo across the axis.
    The structure is a self-complementing double helix.</p>
    <p>Note: 2+4+7 = 13 &nbsp;·&nbsp; 5+8 = 13. Two groups, same sum, different form.</p>

    <hr>

    <h2>Balanced Ternary, Centered on 6</h2>
    <p>Standard balanced ternary uses digits &lbrace;−1, 0, +1&rbrace;. Here they map to
    <em>&lbrace;5, 6, 7&rbrace;</em> — a contiguous digit run with <strong>6 as zero</strong>.</p>
    <p>Why 6? It is the nil element of the mod-9 system — dr(897), excluded from the orbit,
    the number that isn't there. Centering the trit notation on the absent element is the point.</p>
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
    <p><code>757</code> — a palindrome. The orbit's fourth value, in a system balanced on absence.</p>

    <hr>

    <h2>The Geometry: Golden Angle Tornado</h2>
    <p>Each node is placed using the <em>golden angle</em>: 137.508° ≈ 2π(2−φ) per step.
    This is irrational, so no two nodes ever share an angular position.
    Combined with an expanding radius and a constant height step, the result is a cone —
    a tornado — showing the Fibonacci sunflower from above and the expanding helix from the side.</p>
    <pre><code>const PHI = (1 + Math.sqrt(5)) / 2;
const GA  = 2 * Math.PI * (2 - PHI);   // golden angle ≈ 137.508°

const nodePos = (step, offset = 0) => (&lbrace;
  x: (0.28 + step * 0.13) * Math.cos(step * GA + offset),
  y:  step * 0.68,
  z: (0.28 + step * 0.13) * Math.sin(step * GA + offset),
&rbrace;);
// Strand B: offset = Math.PI  (echo strand, opposite side)</code></pre>

    <hr>

    <h2>The 21 Arc</h2>
    <p>After 21 golden-angle steps: 21 × 137.508° = 2887.7° — exactly 7.7° past 8 full rotations.
    The spiral has nearly closed on itself. This near-return at F₈ = 21 is where the visible
    Fibonacci arm folds back. The helix currently runs 18 steps (3 cycles). <em>Step 21 is the next thing to build.</em></p>

    <hr>

    <h2>The Breath</h2>
    <p>Every node, line, and label shares one oscillating scalar:</p>
    <pre><code>const breath = 1 + 0.10 * Math.sin(t * 0.50);
// ±10% at 0.5 rad/s — one full breath every ≈12.6 seconds

node.y  = baseY(step) * breath;
label.y = baseY(step) * breath;
line.y  = baseY(step) * breath;  // both endpoints</code></pre>
    <p>One number. Everything moves together. The accordion expands and contracts as a single structure.</p>
  </article>
</div>
{/if}
