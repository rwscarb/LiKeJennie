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
