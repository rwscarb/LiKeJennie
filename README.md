# LiKeJennie

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
| 10 | ORBIT CYCLE | Full period-6 cycle animated |
| 11 | OLIVER 42 | oliver42 framework: orbit × complement |
| 12 | EXPERIMENTS | Penrose Tribar experiment results |
| 13 | GNN MIRROR | Orbit GNN skip-connection topology |
| 14 | BUCKMINSTER | C₆₀ — nil coordinate container |
| 15 | ORBIT MUSIC | Heptagon WebAudio orbit arpeggio |
| 16 | MUSIC | Extended orbit music sequencer |
| 17 | TIME-TREE | Project timeline — four streams from origin |

---

## Controls (Scene 08 — HELIX)

| Control | Action |
|---------|--------|
| Drag | Rotate |
| Scroll | Zoom |
| AUTO-ROTATE | Toggle rotation |
| COMPLEMENT | Toggle trit labels ↔ decimal values |
| TRIBAR | Toggle Penrose tribar inter-cycle fold overlay |
| SIDE | Camera: tornado/DNA silhouette |
| TOP | Camera: Fibonacci sunflower from above — reveals hexagram |
| HERO | Camera: low heroic angle, large nodes |
| Hover a node | Tooltip with trit, echo, group membership |

---

## Penrose Tribar — Inter-Cycle Fold Structure

The HELIX runs 3 complete orbit cycles (CYCLES=3, 18 nodes per strand + apex). Each cycle
covers one full period of [1,2,4,8,7,5]. Nodes at the same orbit position across cycles
form natural triangles — the same value recurring at p, p+M, and p+2M (M=6).

The edges of these triangles define three arm groups, each connecting adjacent cycles:

| Arm | Color | Pairs | Reading |
|-----|-------|-------|---------|
| A | gold | cycle 0 → cycle 1 | the first fold |
| B | cyan | cycle 1 → cycle 2 | the second fold |
| C | orange | cycle 2 → cycle 0 | the impossible return |

Arm C is impossible: the helix ascends continuously, so the return edge would have to close
a triangle whose third vertex is below the starting point — a contradiction in 3D that is
visible only in projection. The Penrose tribar is the classical diagram of exactly this
impossibility. Arm C is drawn as lines only (no fill) to preserve that contradiction.

Arms A and B are filled with translucent face shading (centroid-split into two sub-triangles
per orbit position). This produces 12 filled sub-triangles per cycle pair — 12 faces total
across the two filled arms.

**TOP view:** From directly above, the 6 tribar triangles (one per orbit position, A+B filled)
radiate from the helix center as a hexagram — a 6-pointed star. The impossible Arm C lines
complete the outer silhouette of each triangle without filling it.

**What it shows:** The tribar makes visible the mod-3 structure inside the mod-6 orbit.
Three cycles is not arbitrary — it is the natural folding depth where the orbit closes on
itself modulo 3. The impossible arm encodes the fact that closure is periodic, not spatial.
This is the same structure that appears in GNN skip connections: Arm A and Arm B are
long-range edges that carry information across cycle boundaries; Arm C is the ghost edge that
would make the graph cyclic at the wrong scale.

```
orbit position p:   node[p]    node[p+M]    node[p+2M]
                        ●────────────●────────────●
                        │  Arm A     │  Arm B     │
                        └────────────┴────────────┘
                               Arm C (impossible)
```

---

## Experiments

All experiments are in `src/experiments/`. They progress from early proofs-of-concept
through the Penrose Tribar architecture and into seismology applications.

### Penrose Tribar (main line)

| File | Description |
|------|-------------|
| `poc_penrose_tribar.py` | Original PoC — orbit permutation × gated skip × LayerNorm on Fashion-MNIST |
| `poc_tribar_fashion_k4.py` | K=4 ablation |
| `poc_tribar_fashion_k32.py` | K=32 benchmark (tri 80.9% vs base 74.8%, +6.1%) |
| `poc_tribar_seismo_ethz.py` | ETHZ seismology dataset |
| `poc_tribar_seismo_stead.py` | STEAD dataset — 7373 eq + 7373 noise, +2.61% at σ=0.3 |
| `poc_tribar_early_detection.py` | P-wave early detection — >8s warning before S-wave |
| `poc_tribar_seismic_system.py` | Full streaming seismic detection system |
| `poc_tribar_optuna.py` | Optuna HPO for Tribar hyperparameters |

### Echo MoE (mixture-of-experts with orbit routing)

| File | Description |
|------|-------------|
| `poc_echo_moe_final.py` | Final Echo MoE with orbit-gated expert selection |
| `poc_echo_moe_gaussian.py` | Gaussian noise robustness sweep |
| `poc_echo_moe_top2.py` | Top-2 expert routing variant |
| `poc_echo_moe_training.py` | Training loop diagnostics |
| `poc_echo_moe_warmup.py` | Warmup schedule exploration |
| `poc_echo_moe_temp.py` | Temperature scaling for routing |
| `poc_echo_init_stats.py` | Expert initialization statistics |

### Early work

| File | Description |
|------|-------------|
| `poc_orbit_gnn.py` | Graph neural network with orbit skip topology |
| `poc_sgd_orbit.py` | SGD learning rate mapped to orbit sequence |
| `poc_ternary_sweep.py` | Ternary activation sweep |
| `poc_ternary_orbit.py` | Orbit-structured ternary quantization |
| `poc_ternary_hard.py` | Hard ternary (no straight-through) |
| `poc_trib_3layer.py` | 3-layer Tribonacci balance (33/33/33 result at fc3) |
| `poc_trib_improved.py` | Tribonacci attractor improved |
| `poc_trib_hard.py` | Hard Tribonacci constraints |
| `poc_tribonacci.py` | Tribonacci sequence baseline |
| `poc_jennie22.py` | jennie22 hypothesis test |

### Data

| Path | Contents |
|------|----------|
| `data/MNIST/` | Fashion-MNIST raw files (auto-downloaded by torchvision) |
| `data/silk_research.md` | Silk / compass thread research — orbit permutation as signal conduit |

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
make              # show all available targets
make sync         # install python deps (uv) + npm deps
make dev          # vite dev server at localhost:5173
make build        # production build → src/ui/dist/
make deploy       # build + sync to s3://hak4 + CloudFront invalidation
make test         # run all tests (python + js)
```

**Stack:** [Svelte](https://svelte.dev) · [Vite](https://vitejs.dev) · [Three.js](https://threejs.org) (WebGL + CSS2DRenderer)

---

## Structure

```
src/
  ui/                         # WebGL visualization (Svelte + Vite)
    index.html
    main.js
    App.svelte                # shell: canvas, tabs, nav, controls
    app.css                   # global styles + responsive breakpoints
    lib/
      state.js                # active scene store
    scenes/
      index.js                # scene registry (17 panels)
      shared.js               # Three.js setup, R singleton, tooltip helpers
      s0.js – s16.js          # individual scene modules
    tests/
      unit/                   # vitest unit tests
      e2e/                    # playwright e2e tests

  experiments/
    poc_penrose_tribar.py     # Penrose Tribar architecture (main)
    poc_tribar_*.py           # Tribar variants: Fashion-MNIST, seismology, HPO
    poc_echo_moe_*.py         # Echo MoE with orbit-gated routing
    poc_orbit_gnn.py          # Orbit GNN topology
    poc_sgd_orbit.py          # SGD with orbit learning rate schedule
    poc_ternary_*.py          # Ternary activation experiments
    poc_trib_*.py             # Tribonacci attractor experiments
    poc_jennie22.py           # jennie22 hypothesis
    TRIBONACCI_ATTRACTOR.md   # Tribonacci attractor writeup
    data/
      MNIST/                  # Fashion-MNIST raw files
      silk_research.md        # Silk / compass thread — orbit as signal conduit
```

---

## Background

896 = 2⁷ × 7. Seven doublings of 1, multiplied by 7. τ(896) = 16. dr(896) = 5.
dr(897) = 6 — the nil neighbor.

The ×2 mod 9 orbit of 1 has period 6: {1,2,4,8,7,5}. At step 21 (F₈), the
golden-angle spiral has accumulated 21 × 137.508° ≈ 7.7° past 8 full rotations
— the Fibonacci near-return where the sunflower arm pattern folds back.

The Penrose Tribar overlay makes visible the mod-3 folding structure inside
the orbit. Three cycles of period-6 produce 6 triangles whose edges are the tribar arms.
From TOP: a hexagram. Arm C is the impossible return — periodic closure drawn as a ghost edge.
This connects to the oliver42 topology: arm A is complement, arm B is bridge, arm C is collapse.

The Penrose Tribar architecture (gated skip + orbit permutation + LayerNorm) outperforms
baseline MLP at every tested noise level on Fashion-MNIST and STEAD seismology datasets.
Peak advantage at ambient noise (σ=0.3) — the operating regime of real seismic detection.
Wall time: 61 seconds for the full seismology benchmark.
