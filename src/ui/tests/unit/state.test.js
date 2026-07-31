import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { cur, goTo } from '../../lib/state.js';

beforeEach(() => {
  cur.set(7); // reset to default
});

describe('goTo', () => {
  it('navigates to a valid index', () => {
    goTo(3);
    expect(get(cur)).toBe(3);
  });

  it('clamps: rejects negative index', () => {
    goTo(-1);
    expect(get(cur)).toBe(7);
  });

  it('clamps: rejects index > 9', () => {
    goTo(10);
    expect(get(cur)).toBe(7);
  });

  it('ignores same index (no-op)', () => {
    goTo(7);
    expect(get(cur)).toBe(7);
  });

  it('navigates to boundary 0', () => {
    goTo(0);
    expect(get(cur)).toBe(0);
  });

  it('navigates to boundary 9', () => {
    goTo(9);
    expect(get(cur)).toBe(9);
  });
});
