# JENNIE 21

**Live:** [fib896.com](https://fib896.com)

A WebGL visualization of the ×2 mod 9 doubling orbit — six numbers
wound around a Fibonacci phyllotaxis cone, breathing.

---

## What It Shows

Start at 1. Double it. Take the result mod 9. Repeat:

```
1 → 2 → 4 → 8 → 7 → 5 → 1 → ...
```

Six values. Period 6. The numbers 3, 6, and 9 are structurally excluded —
they form their own closed system under ×2 mod 9 and never enter this orbit.
**9 does not appear.**

Each value has an echo: its complement summing to 9 (1↔8, 2↔7, 4↔5). The
visualization runs two helix strands π radians apart — Strand A carries the
orbit, Strand B carries the echoes. Every rung connects a node to its echo
across the axis.

Labels are written in **balanced ternary centered on 6**: digits 5=−1, 6=0, 7=+1.
The zero of the trit system is 6 — the nil element, the number that isn't
there. The arc at step 21 (Fibonacci F₈) is where the golden-angle spiral
nearly closes on itself: the next structure to build.

---

## Scenes

| Tab | Panel | Description |
|-----|-------|-------------|
| 01 | DIVISOR LATTICE | 896 = 2⁷×7 divisor structure |
| 02 | 1/89 CONVERGENCE | 1/89 = ΣF(n)/10ⁿ⁺¹ convergence |
| 03 | φ SPHERE | Fibonacci/Lucas nodes on a unit sphere |
| 04 | MoE ROUTING | Kimi K3 mixture-of-experts token routing |
| 05 | GREEK LETTERS | π, φ, τ, ω — connections to 896 |
| 06 | SUNFLOWER | Golden angle phyllotaxis disc |
| 07 | TRIT MATRIX | Balanced ternary digit matrix |
| **08** | **HELIX** | **JENNIE 21 — the main event** |
| 09 | TERNARY VS CLOCK | Balanced ternary vs clock arithmetic |

---

## Controls (Scene 08)

| Control | Action |
|---------|--------|
| Drag | Rotate |
| Scroll | Zoom |
| AUTO-ROTATE | Toggle rotation |
| COMPLEMENT | Toggle trit labels ↔ decimal values |
| SIDE | Camera: tornado/DNA silhouette |
| TOP | Camera: Fibonacci sunflower from above |
| HERO | Camera: low heroic angle, large nodes |
| Hover a node | Tooltip with trit, echo, group membership |

---

## Math Reference

**The orbit** (×2 mod 9, period 6):
```python
n, seen, orbit = 1, set(), []
while n not in seen:
    seen.add(n); orbit.append(n); n = (n * 2) % 9
# [1, 2, 4, 8, 7, 5]
```

**Balanced ternary** (centered on 6):
```python
def to_bt(n):
    if n == 0: return '6'
    digits = []
    while n != 0:
        r = n % 3
        if r == 0:   digits.append('6'); n //= 3
        elif r == 1: digits.append('7'); n = (n - 1) // 3
        else:        digits.append('5'); n = (n + 1) // 3
    return ''.join(reversed(digits))
# 1→'7'  2→'75'  4→'77'  5→'755'  7→'757'  8→'765'
```

**Node positions** (golden angle phyllotaxis cone):
```javascript
const GA = 2 * Math.PI * (2 - (1 + Math.sqrt(5)) / 2); // ≈ 137.508°

const nodePos = (step, phiOffset = 0) => ({
  x: (0.28 + step * 0.13) * Math.cos(step * GA + phiOffset),
  y:  step * 0.68,
  z: (0.28 + step * 0.13) * Math.sin(step * GA + phiOffset),
});
// Strand A: phiOffset = 0
// Strand B: phiOffset = Math.PI  (echo strand, opposite side)
```

**Accordion breath** (all geometry shares one scalar):
```javascript
const breath = 1 + 0.10 * Math.sin(t * 0.50); // ±10%, ~12.6 s cycle
node.position.y = baseY(step) * breath;
```

---

## Development

```bash
npm install
npm run dev      # dev server at localhost:5173
npm run build    # production build → dist/
```

**Stack:** [Svelte](https://svelte.dev) · [Vite](https://vitejs.dev) · [Three.js](https://threejs.org) (WebGL + CSS2DRenderer)

---

## Structure

```
src/
  App.svelte          # shell: canvas, tabs, nav, controls
  app.css             # global styles + responsive breakpoints
  lib/
    state.js          # active scene store (writable, starts at scene 8)
  scenes/
    index.js          # scene registry (9 panels)
    shared.js         # Three.js setup, R singleton, tooltip helpers
    s7.js             # JENNIE 21 helix — main scene
    s0–s6, s8.js      # other panels
```

---

## Background

896 = 2⁷ × 7. Seven doublings of 1, multiplied by 7. τ(896) = 16. dr(896) = 5.
dr(897) = 6 — the nil neighbor.

The ×2 mod 9 orbit of 1 has period 6: {1,2,4,8,7,5}. At step 21 (F₈), the
golden-angle spiral has accumulated 21 × 137.508° ≈ 7.7° past 8 full rotations
— the Fibonacci near-return where the sunflower arm pattern folds back.

The inversion at the 21-arc is the next thing to build.
