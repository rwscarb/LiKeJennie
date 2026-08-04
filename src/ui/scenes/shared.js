// Shared runtime: Three.js imports, Fibonacci/Lucas math, color palette,
// mutable scene state (R), disposal, and tooltip helpers.
// Ported from fib896.html — logic kept verbatim, module globals moved into R.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
export { THREE, OrbitControls, CSS2DRenderer, CSS2DObject };

// ── Fibonacci/Lucas math ──────────────────────────────
export const PHI = (1 + Math.sqrt(5)) / 2;
function mkFib(m) { const f = []; let a = 1, b = 1; while (a <= m) { f.push(a); [a, b] = [b, a + b]; } return f; }
function mkLuc(m) { const l = [2, 1]; while (l[l.length - 1] < m) { const n = l.length; l.push(l[n - 1] + l[n - 2]); } return l; }
export const FIBS = mkFib(5000), LUCAS = mkLuc(5000);
export const FS = new Set(FIBS), LS = new Set(LUCAS);
export const FI = new Map(FIBS.map((v, i) => [v, i + 1]));
export const LI = new Map(LUCAS.map((v, i) => [v, i + 1]));
export const CG = 0x00ff88, CC = 0x00e5ff, CY = 0xffe600, CO = 0xff9800, CDim = 0x0a1a0a;
export const CGS = '#00ff88', CCS = '#00e5ff', CYS = '#ffe600', COS = '#ff9800';
export function nodeHex(n) { if (n === 896) return CO; const f = FS.has(n), l = LS.has(n); if (f && l) return CY; if (f) return CG; if (l) return CC; return CDim; }
export function nodeCls(n) { if (n === 896) return { c: COS, lbl: '896 ★' }; const f = FS.has(n), l = LS.has(n); if (f && l) return { c: CYS, lbl: 'Fib ∩ Lucas' }; if (f) return { c: CGS, lbl: 'Fibonacci' }; if (l) return { c: CCS, lbl: 'Lucas' }; return { c: '#0a1a0a', lbl: '—' }; }

// ── Mutable runtime state (was module-level globals) ──
export const R = {
  canvas: null,          // #glc
  ov: null,              // overlay element
  tt: null,              // tooltip element
  renderer: null,
  labelRenderer: null,
  scene: null,
  camera: null,
  controls: null,
  animFn: null,
  teardown: null,        // optional per-scene cleanup fn
  cur: 0,
  disposables: [],
  css2dObjects: [],
};

export function mkCamera() { return new THREE.PerspectiveCamera(55, R.canvas.width / R.canvas.height, 0.1, 200); }
export function mkControls(cam) { const c = new OrbitControls(cam, R.canvas); c.enableDamping = true; c.dampingFactor = 0.08; return c; }
export function disposeScene() {
  if (!R.scene) return;
  if (R.teardown) { try { R.teardown(); } catch(_) {} R.teardown = null; }
  R.css2dObjects.forEach(o => { if (o.parent) o.parent.remove(o); o.element?.remove(); });
  R.css2dObjects = [];
  R.disposables.forEach(d => { if (d.geometry) d.geometry.dispose(); if (d.material) { if (Array.isArray(d.material)) d.material.forEach(m => m.dispose()); else d.material.dispose(); } });
  R.disposables = []; R.scene = null; R.camera = null;
  if (R.controls) { R.controls.dispose(); R.controls = null; }
}

// ── Tooltip ───────────────────────────────────────────
let tipPinned = false;
export function tip(e, html) { if (tipPinned) return; R.tt.innerHTML = html; R.tt.classList.add('show'); tmv(e); }
export function tmv(e) { if (tipPinned) return; let x = e.clientX + 14, y = e.clientY - 12; if (x + 235 > innerWidth) x = e.clientX - 245; if (y + 180 > innerHeight) y = e.clientY - 180; R.tt.style.left = x + 'px'; R.tt.style.top = y + 'px'; }
export function htip() { if (tipPinned) return; R.tt.classList.remove('show'); }
export function pinTip(e, html) {
  if (tipPinned) { tipPinned = false; R.tt.classList.remove('show', 'pinned'); return; }
  if (html) R.tt.innerHTML = html;
  if (!R.tt.classList.contains('show')) return;
  tipPinned = true; R.tt.classList.add('pinned');
  let x = e.clientX + 14, y = e.clientY - 12; if (x + 235 > innerWidth) x = e.clientX - 245; if (y + 180 > innerHeight) y = e.clientY - 180;
  R.tt.style.left = x + 'px'; R.tt.style.top = y + 'px';
}
export function resetTip() { tipPinned = false; R.tt.classList.remove('pinned'); htip(); }
export function ntip(n, extra = '') { const cl = nodeCls(n), fi = FI.get(n), li = LI.get(n); let h = `<div class="th">${n}</div>`; h += `<p class="tr">class: <b style="color:${cl.c}">${cl.lbl}</b></p>`; if (fi) h += `<p class="tr">F<sub>${fi}</sub> = ${n}</p>`; if (li) h += `<p class="tr">L<sub>${li}</sub> = ${n}</p>`; h += `<p class="tr">896 ÷ ${n} = <b>${896 / n}</b></p>`; if (extra) h += `<p class="tr">${extra}</p>`; return h; }
