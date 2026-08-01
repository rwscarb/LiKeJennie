import { writable } from 'svelte/store';
import { scenes } from '../scenes/index.js';

export const cur = writable(7);

export function goTo(idx) {
  cur.update(c => {
    if (idx < 0 || idx >= scenes.length || idx === c) return c;
    history.pushState({ scene: idx }, '', `?s=${idx}`);
    return idx;
  });
}
