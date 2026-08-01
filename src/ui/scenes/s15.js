// ─────────────────────────────────────────────────────────────────────────────
//  SCENE 15 — ORBIT MUSIC
//  The sequencer UI lives in orbit_music_v2.html (public/), displayed as an
//  iframe overlay by App.svelte when active === 14.  This build function just
//  sets up an empty Three.js scene so the render loop has valid state.
// ─────────────────────────────────────────────────────────────────────────────
import { R, mkCamera, mkControls } from './shared.js';
import { THREE } from './shared.js';

export function buildS15() {
  const scene  = new THREE.Scene();
  R.scene      = scene;
  R.camera     = mkCamera();
  R.camera.position.set(0, 0, 5);
  R.controls   = mkControls(R.camera);
  R.animFn     = null;
}
