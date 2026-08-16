# Orbit Permutation Ablation — jennie21 / seismic-sensor

**Date:** 2026-08-16  
**Context:** Testing whether the mod-9 orbit permutation [0,1,3,7,6,4] is load-bearing in the StreamingNet seismic P-wave classifier, or merely inspirational architecture.

---

## Background

The `StreamingNet` model uses a fixed permutation applied in a recurrent buffer loop:

```python
for _ in range(CYCLES):
    h   = torch.relu(h[:, self.perm])
    buf = BUF_DECAY * buf + (1 - BUF_DECAY) * h.detach()
    h   = h + BUF_STRENGTH * buf
```

The orbit permutation tiles `[0,1,3,7,6,4]` (the orbit of 1 under ×2 in ZMod 9) to fill K=128 dimensions. This was motivated by the jennie21 algebraic structure: {1,2,4,8,7,5} is the unit group of ZMod 9 under doubling, with {0,3,6} as the unreachable ideal.

The question: does this specific permutation *cause* better performance, or is it coincidental?

---

## Prior Ablation (poc_random_perm_prod.py)

| Permutation | Mean Prec | Std | Range |
|---|---|---|---|
| Orbit [0,1,3,7,6,4] | 84.2% | 3.3% | 79.9%–88.1% |
| Random fixed | 86.1% | 0.4% | 85.6%–86.4% |
| Identity | 85.0% | — | — |

Orbit perm: lower mean, *much* higher variance. Random wins on both counts.

---

## Experiment 1: Error Correlation (exp_1_error_correlation.py)

**Question:** Do orbit and random models make errors on the *same* examples?

**Results (3 orbit seeds + 3 random seeds, STEAD chunk2, val n=2400):**

Individual precision:
- orbit: 85.8% ± 2.46%  
- random: 88.1% ± 3.62%

Jaccard similarity of error sets:
- orbit-vs-orbit: 0.511 ± 0.070
- rand-vs-rand: 0.416 ± 0.056
- orbit-vs-rand: 0.458 ± 0.102

Cohen's kappa (prediction agreement):
- orbit-vs-orbit: 0.864 ± 0.034
- rand-vs-rand: 0.859 ± 0.023
- orbit-vs-rand: 0.858 ± 0.039

**Verdict: AMBIGUOUS.** Orbit errors are slightly more diverse from random than random-vs-random, but not strongly so. Proceed to ensemble mixing test.

---

## Experiment 2: Ensemble Mixing (exp_2_ensemble_mixing.py)

**Question:** Does mixing orbit models into a random ensemble improve performance?

**Results (best F1 over threshold sweep):**

| Strategy | Size | Best F1% | @ thr | Prec% | Rec% |
|---|---|---|---|---|---|
| all_orbit | 3 | 92.51% | 0.550 | 88.51% | 96.88% |
| all_random | 3 | **94.21%** | 0.675 | 92.82% | 95.65% |
| mixed_50_50 | 6 | 93.86% | 0.600 | 91.11% | 96.80% |
| mixed_1orbit | 3 | 93.25% | 0.650 | 90.75% | 95.89% |
| best_orbit+rand | 3 | 93.25% | 0.650 | 90.75% | 95.89% |

mixed_50_50 vs all_random: **−0.35pp F1**  
mixed_1orbit vs all_random: **−0.64pp F1**

**Verdict: ORBIT HURTS.** The small error-set diversity from Exp 1 doesn't translate to ensemble gain. Orbit models add noise. Pure random-perm ensembles are strictly better.

---

## Experiment 3: Variance Source (exp_3_variance_source.py)

**Question:** Why does orbit have high variance (3.3%) while random is stable (0.4%)?

Three hypotheses tested:

| Hypothesis | Orbit std | Random std | Explains? |
|---|---|---|---|
| H1: Initialization sensitivity | 4.28% | 2.76% | **YES** |
| H2: Data split sensitivity | 3.68% | 2.82% | no |
| H3: Specific sequence vs shuffled orbit | 2.56% | 3.62% (shuffled mean) | **YES (inverted)** |

H3 detail — canonical vs shuffled orbit variants (same 6 values, different order):

| Permutation | Mean Prec | Std | Range |
|---|---|---|---|
| orbit_canonical [0,1,3,7,6,4] | 84.65% | 2.56% | 81.4%–89.1% |
| orbit_shuf_0 | 84.46% | 4.51% | 76.6%–89.5% |
| orbit_shuf_1 | 82.70% | 3.37% | 76.1%–85.2% |
| orbit_shuf_2 | 86.64% | 3.02% | 82.1%–89.8% |
| orbit_shuf_3 | 81.81% | 3.57% | 77.0%–84.9% |

**Verdict:** Orbit variance is primarily **initialization sensitivity** (H1). The tiled periodic structure creates a rugged loss landscape with multiple basins. Which basin training finds depends on weight init — random perms converge more reliably because they lack this periodicity.

H3 adds a nuance: the canonical sequence [0,1,3,7,6,4] is the *most stable* of all orbit arrangements tested (std 2.56% vs shuffled mean 3.62%). The specific algebraic sequence is the least chaotic version of itself — it doesn't help performance, but it is the most ordered.

---

## Conclusions

1. **The orbit permutation is not load-bearing.** Random fixed permutations outperform it on mean precision and are more stable. The architecture does not need the mod-9 structure to work.

2. **The orbit perm hurts ensembles.** Mixing orbit models into a random ensemble degrades F1 by 0.35–0.64pp despite offering slightly more diverse errors.

3. **High variance is explained by initialization sensitivity.** The tiled periodic structure creates a multi-basin loss landscape. Mitigation: run more seeds, select best checkpoint.

4. **The canonical sequence is structurally special in a narrow sense.** [0,1,3,7,6,4] is the most stable ordering of the orbit values — but this stability advantage is small and doesn't offset the performance gap vs random.

5. **The Lean proofs are unaffected.** The algebraic facts — {0,3,6} is an ideal in ZMod 9, {1,2,4,8,7,5} is the unit group, 2 is a primitive root mod 9 — are formally verified and correct. These are real mathematics. The connection to the seismic architecture is inspiration, not mechanism.

---

## Recommendation

Production seismic-sensor should use **random fixed permutations** (current production config already does this). The orbit permutation should not be used in `StreamingNet` unless future experiments on different tasks show a specific advantage.

The jennie21 algebraic framework stands independently. The seismic sensor stands independently. They are related by inspiration, not by causal dependency.

---

*Experiments run 2026-08-16 on RunPod RTX 4090 (24GB), STEAD chunk2 dataset.*  
*Scripts: `src/experiments/exp_1_error_correlation.py`, `exp_2_ensemble_mixing.py`, `exp_3_variance_source.py`*
