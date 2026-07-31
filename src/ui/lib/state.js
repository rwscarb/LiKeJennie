import { writable } from 'svelte/store';
import { scenes } from '../scenes/index.js';

export const cur = writable(7);

export function goTo(idx) {
  cur.update(c => (idx < 0 || idx >= scenes.length || idx === c) ? c : idx);
}
