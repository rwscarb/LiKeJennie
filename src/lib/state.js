import { writable } from 'svelte/store';

export const cur = writable(7);

export function goTo(idx) {
  cur.update(c => (idx < 0 || idx > 8 || idx === c) ? c : idx);
}
