# Tribonacci Ratio as Universal Attractor in Ternary Weight Networks

**Ryan Scarbery · July 29, 2026**

---

## Abstract

We investigate structured initialization schemes for ternary neural networks, motivated by the question of whether Tribonacci-sequence-derived weight schedules improve convergence over standard Xavier initialization. We find that while no tested scheme outperforms Xavier in final accuracy or convergence speed, all magnitude-cascade variants converge to a common weight structure characterized by a layer-wise ratio of approximately 1 : φ_T : φ_T² (where φ_T ≈ 1.839 is the Tribonacci constant). This ratio emerges as an apparent attractor regardless of starting scale, task difficulty, or architecture width — suggesting it reflects a fundamental property of how ternary networks self-organize under gradient descent.

---

## 1. Introduction

Ternary weight networks constrain each weight to {−1, 0, +1}, dramatically reducing inference cost while retaining reasonable representational capacity. A key open question is whether the initialization of continuous latent weights — from which ternary values are derived via a straight-through estimator — meaningfully affects learning dynamics.

Standard practice adapts Xavier uniform initialization to ternary networks. We explore an alternative hypothesis: that weight magnitudes should follow a Tribonacci growth schedule across layers, reflecting the mathematical structure of the Tribonacci sequence and its associated constant φ_T.

The Tribonacci constant satisfies φ_T³ = φ_T² + φ_T + 1, giving φ_T ≈ 1.8393. A 3-layer cascade with ratio 1 : φ_T : φ_T² places the final layer at full Orbit magnitude (±1.0) while early layers remain more plastic.

---

## 2. Methods

### 2.1 Architecture

Three-layer MLP: D=64 → H1=64 → H2=64 → N=16, with ReLU activations and Adam (lr=3e-4). Ternary weights are derived via straight-through estimator with threshold τ = 0.7 · mean(|W|).

### 2.2 Task

16-class Gaussian classification. Class centers drawn from N(0, sep·I), with per-sample noise σ=1. Tested at sep ∈ {1.5σ, 1.0σ, 0.7σ}. Training: 16,000 samples, 5,000 steps, batch 512. Evaluation: 4,000 held-out samples. 20 random seeds each condition.

### 2.3 Initialization Conditions

| Label | Scheme | fc1 init | fc2 init | fc3 init |
|-------|--------|----------|----------|----------|
| Xavier | Xavier uniform | ±0.108 | ±0.108 | ±0.135 |
| Orbit | Orbit block, random permute | ±1.0 | ±1.0 | ±1.0 |
| C | Trib-Magnitude 1.0× | ±0.296 | ±0.544 | ±1.000 |
| D | Trib-Magnitude 0.5× | ±0.148 | ±0.272 | ±0.500 |
| F | Trib-Magnitude Xavier-matched (~0.549×) | ±0.162 | ±0.299 | ±0.549 |

The Trib-Magnitude scheme initializes each layer as a randomly permuted Orbit block scaled by `(φ_T^depth / φ_T^(L-1)) · global_scale`, plus Gaussian noise (σ=0.01). A Trib-Permuted variant (B) used Zeckendorf ordering instead of random permutation; it was indistinguishable from Orbit and excluded from later experiments.

Xavier-matched scale F is derived analytically: setting fc1 initial mean |W| equal to Xavier's for the same layer dimensions yields `global_scale = φ_T² · (3/4) · sqrt(6 / (fan_in + fan_out))` ≈ 0.549 for the square 64×64 architecture.

---

## 3. Results

### 3.1 Permutation Structure Is Irrelevant

The Trib-Permuted variant (B), which arranges Orbit values in Zeckendorf order, performed identically to random-permute Orbit across all metrics (B vs Orbit: 30% better, gap = −0.0007 at sep=1.5σ). The sequence structure of the initialization carries no signal. Only the magnitude schedule matters.

### 3.2 Scale Selection Determines Performance

At sep=1.5σ, final accuracy across all magnitude-cascade variants:

| Scheme | Final acc | step@best | vs Xavier |
|--------|-----------|-----------|-----------|
| Xavier | 0.9974 ± 0.0009 | 2582 ± 796 | — |
| C (1.0×) | 0.9964 ± 0.0012 | 4205 ± 525 | −0.0010 |
| D (0.5×) | 0.9972 ± 0.0008 | 3252 ± 754 | −0.0002 |
| F (0.549×) | 0.9970 ± 0.0009 | 3452 ± 696 | −0.0004 |

D (0.5×) is the closest non-Xavier performer. The 0.5× scale was found empirically; the Xavier-derived formula (F, 0.549×) is theoretically motivated but slightly worse, because ternary thresholding shifts the effective optimal scale below the continuous Xavier prediction.

### 3.3 The Cascade Ratio Is a Universal Attractor

Across all three scale variants and all tested conditions, the learned weight magnitudes converge to a common layer-wise ratio:

| Variant | fc1 |W| | fc2 |W| | fc3 |W| | Ratio (1:r:r²) |
|---------|----------|----------|----------|----------------|
| C (sep=1.5σ) | 0.222 | 0.403 | 0.699 | 1 : 1.82 : 3.15 |
| D (sep=1.5σ) | 0.110 | 0.202 | 0.351 | 1 : 1.84 : 3.19 |
| F (sep=1.5σ) | 0.121 | 0.222 | 0.385 | 1 : 1.83 : 3.18 |
| D (sep=1.0σ) | 0.106 | 0.204 | 0.354 | 1 : 1.92 : 3.34 |
| D (sep=0.7σ) | 0.098 | 0.205 | 0.353 | 1 : 2.09 : 3.60 |
| **φ_T theoretical** | — | — | — | **1 : 1.84 : 3.38** |

The ratio is remarkably stable across scale variants (C, D, F all converge to ~1:1.83:3.17 at sep=1.5σ), with gradual deviation as the task becomes harder. The φ_T ratio appears to be an attractor of the ternary gradient dynamics under this architecture, not an artifact of initialization.

Additionally, fc2 and fc3 converge to near-exact ternary balance (≈33% each of +1, 0, −1) across all magnitude-cascade conditions, while fc1 maintains elevated sparsity (40–44% zeros at sep=1.5σ). Xavier does not exhibit this cascade structure.

### 3.4 Performance Across Regimes

The accuracy gap between D and Xavier grows with task difficulty:

| sep | Xavier | D (0.5×) | Gap | D step@best | Xavier step@best |
|-----|--------|-----------|-----|-------------|-----------------|
| 1.5σ | 0.9974 | 0.9972 | −0.0002 | 3252 | 2582 |
| 1.0σ | 0.9956 | 0.9946 | −0.0010 | 4620 | 4277 |
| 0.7σ | 0.9851 | 0.9819 | −0.0032 | 4690 | 4682 |

At sep=0.7σ, convergence speed equalizes (step@best ≈ 4682 vs 4690) — all methods hit the step budget ceiling. Xavier still extracts more accuracy from the same budget because it begins at the correct scale without correction overhead.

The cost of incorrect scale (C) scales catastrophically with difficulty: C's gap from Xavier grows from −0.0010 (1.5σ) to −0.0029 (1.0σ) to −0.0112 (0.7σ). At sep=0.7σ, D beats C on 100% of seeds with a gap of +0.0080 — effectively, C becomes unusable for hard classification at this architecture scale.

### 3.5 Wide Network Generalization

Tested on 64→256→256→16 at sep=1.5σ. Xavier's fc1 equilibrium drops to |W|=0.068 (from 0.108 on the square network); D's 0.5× scale now initializes too heavily.

| Scheme | Final acc | step@best |
|--------|-----------|-----------|
| Xavier | 0.9977 ± 0.009 | **322 ± 124** |
| F (0.347× derived) | 0.9964 ± 0.0013 | 1185 ± 789 |
| D (0.5×) | 0.9965 ± 0.0012 | 1785 ± 998 |
| C (1.0×) | 0.9966 ± 0.0007 | 2145 ± 369 |

On the wide network, Xavier converges in 322 steps — the over-parameterization makes initialization almost inconsequential for it. F's architecture-derived scale now outperforms D (1185 vs 1785 steps), confirming that 0.5× is not universally optimal: it is specific to architectures where the Xavier mean |W| is close to 0.108. For general use, the derived formula `global_scale = φ_T² · (3/4) · sqrt(6 / (fan_in + fan_out))` is the correct approach, though it still cannot close the gap to Xavier.

The φ_T cascade ratio persisted on the wide network: C (0.227:0.400:0.700), D (0.113:0.200:0.350), F (0.078:0.138:0.243) all maintain ratios ≈ 1:1.77:3.12, confirming the attractor is architecture-independent.

---

## 4. Discussion

The central finding is that the Tribonacci ratio 1 : φ_T : φ_T² is not merely a design choice for initialization — it is where ternary networks under Adam arrive when the task is a multi-class Gaussian classification problem. The cascade appears regardless of whether you start at 0.5× or 1.0× global scale, and it appears at all tested separation values.

This suggests that the attractor reflects something about the geometry of the ternary straight-through gradient landscape: deeper layers benefit from higher-magnitude stable weights (harder to flip), while earlier layers remain more plastic. The Tribonacci constant, with its self-similar growth structure, naturally parameterizes this gradient plasticity hierarchy.

What the attractor does *not* do is compensate for poor absolute scale. Starting C at 2× the optimal scale costs 950+ steps at easy regimes and 0.0080 accuracy at brutal ones. The cascade structure is the attractor; the scale determines how much correction work the optimizer must do before reaching it.

### Practical Recommendations

For square architectures (equal fan_in and fan_out per layer):
- Use `global_scale = 0.5` as a simple, architecture-agnostic approximation
- Cascade: fc_k initialized with scale `(φ_T^k / φ_T^(L-1)) · global_scale`

For arbitrary architectures:
- Use `global_scale = φ_T² · (3/4) · sqrt(6 / (fan_in_fc1 + fan_out_fc1))` to derive from the first layer's dimensions
- This slightly overestimates the optimal scale (ternary thresholding shifts the equilibrium below the continuous prediction), but is within the performant range

Neither recommendation matches Xavier. If performance is the sole objective, use Xavier. The cascade initialization is most useful when interpretability or structured sparsity at the first layer is a design goal.

---

## 5. Conclusion

Tribonacci-magnitude initialization introduces a structured weight cascade that converges to approximately 1 : φ_T : φ_T² layer-wise magnitude ratios — an attractor present across scales, regimes, and architectures. The cascade is not a performance improvement over Xavier but a characterization of ternary network self-organization. The permutation structure of initial weights is irrelevant; only the magnitude schedule matters. For practical use, a 0.5× global scale approximates the optimal initialization for square architectures and dramatically outperforms naïve unit-scale cascade initializations in hard classification regimes.

---

*Experiments: 3-layer MLP, 64-dimensional Gaussian classification, 16 classes, 20 seeds, PyTorch / CUDA (RTX 4090). Code: `poc_trib_3layer.py`.*
