import { describe, it, expect } from 'vitest';
import {
  PHI, FIBS, LUCAS, FS, LS,
  nodeHex, nodeCls,
  CG, CC, CY, CO,
} from '../../scenes/shared.js';

describe('PHI', () => {
  it('is the golden ratio', () => {
    expect(PHI).toBeCloseTo((1 + Math.sqrt(5)) / 2, 10);
  });
});

describe('FIBS', () => {
  it('starts with 1, 1, 2, 3, 5, 8', () => {
    expect(FIBS.slice(0, 6)).toEqual([1, 1, 2, 3, 5, 8]);
  });

  it('each term equals sum of two before it', () => {
    for (let i = 2; i < FIBS.length; i++) {
      expect(FIBS[i]).toBe(FIBS[i - 1] + FIBS[i - 2]);
    }
  });

  it('includes 89, 144, 233', () => {
    expect(FS.has(89)).toBe(true);
    expect(FS.has(144)).toBe(true);
    expect(FS.has(233)).toBe(true);
  });
});

describe('LUCAS', () => {
  it('starts with 2, 1, 3, 4, 7', () => {
    expect(LUCAS.slice(0, 5)).toEqual([2, 1, 3, 4, 7]);
  });

  it('each term equals sum of two before it', () => {
    for (let i = 2; i < LUCAS.length; i++) {
      expect(LUCAS[i]).toBe(LUCAS[i - 1] + LUCAS[i - 2]);
    }
  });
});

describe('nodeHex', () => {
  it('896 returns orange (special)', () => {
    expect(nodeHex(896)).toBe(CO);
  });

  it('Fibonacci-only number returns green', () => {
    // 8 is Fib but not Lucas
    expect(LS.has(8)).toBe(false);
    expect(FS.has(8)).toBe(true);
    expect(nodeHex(8)).toBe(CG);
  });

  it('Lucas-only number returns cyan', () => {
    // 4 is Lucas but not Fib
    expect(LS.has(4)).toBe(true);
    expect(FS.has(4)).toBe(false);
    expect(nodeHex(4)).toBe(CC);
  });

  it('Fib ∩ Lucas returns yellow', () => {
    // 1 is both
    expect(FS.has(1)).toBe(true);
    expect(LS.has(1)).toBe(true);
    expect(nodeHex(1)).toBe(CY);
  });

  it('non-special number returns dim', () => {
    expect(nodeHex(100)).toBe(0x0a1a0a);
  });
});

describe('nodeCls', () => {
  it('896 returns orange with star label', () => {
    const r = nodeCls(896);
    expect(r.lbl).toContain('896');
  });

  it('Fib-only returns Fibonacci label', () => {
    expect(nodeCls(8).lbl).toBe('Fibonacci');
  });

  it('Lucas-only returns Lucas label', () => {
    expect(nodeCls(4).lbl).toBe('Lucas');
  });

  it('Fib ∩ Lucas returns intersection label', () => {
    expect(nodeCls(1).lbl).toContain('Fib');
    expect(nodeCls(1).lbl).toContain('Lucas');
  });
});
