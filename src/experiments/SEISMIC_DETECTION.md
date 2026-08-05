# Orbit Buffer for Seismic P-Wave Detection

**Ryan Scarbery · August 2026**

---

## Abstract

We investigate the Tribar architecture — a 1D convolutional network with an orbit-permuted Hebbian buffer — as a seismic P-wave detector. Starting from a magnitude-stratified baseline, we run five experiments probing the buffer's adaptive capacity, per-cycle structure, streaming behavior, and hyperparameter sensitivity. The key finding: the orbit buffer functions as a recall amplifier and signal accumulator, not a discriminator. Streaming-aware training combined with threshold tuning yields the best result: **88.0% precision / 95.7% recall** on the STEAD dataset, a +4.3pp precision gain over the fixed-parameter baseline while holding recall above 95%.

---

## 1. Architecture

**StreamingTribarNet** is a 3-channel seismic waveform classifier:

```
Input: (B, 3, WIN_SAMPLES)  — 3-component seismogram, 100 samples
→ Conv1d(3→32, k=7) + BN + ReLU
→ Conv1d(32→64, k=7) + BN + ReLU
→ Conv1d(64→K, k=7) + BN + ReLU   K=128
→ AdaptiveAvgPool1d(1)              → (B, K)
```

The orbit buffer runs after the encoder for CYCLES=3 iterations:
```python
for _ in range(CYCLES):
    h   = relu(h[:, perm])          # orbit permutation [0,1,3,7,6,4] repeated to K
    buf = DECAY * buf + (1-DECAY) * h.detach()
    h   = h + STRENGTH * buf
→ Linear(K, 2)                      → logits
```

The buffer is an exponential moving average of past hidden states, injected back as a residual. With `streaming=True`, `buf` persists across sequential forward passes (carrying state between time windows).

**Dataset:** STEAD (chunk2). Magnitude-stratified sampling: per_bin=2666, yielding M<3=3299, M3-5=2666, M5+=2035 events balanced against equal noise. WeightedRandomSampler with inverse-frequency per-bin weights.

**Baseline:** single 0s window, fixed DECAY=0.83, STRENGTH=1.4, LR=1e-3, EPOCHS=30, noise augmentation σ=0.3.

---

## 2. Experiment Series

### 2.1 Adaptive Buffer Parameters (`poc_adaptive_buf.py`)

**Question:** Does the network learn optimal DECAY and STRENGTH values if we make them differentiable?

**Method:** Replace fixed scalars with learnable parameters:
```python
_decay_logit   = nn.Parameter(torch.tensor(logit(0.85)))  # → sigmoid
_strength_log  = nn.Parameter(torch.tensor(softplus_inv(1.4)))  # → softplus
```

**Results (3 seeds):**

| Model | prec | rec |
|---|---|---|
| Fixed (DECAY=0.85, STR=1.4) | 83.5% | 95.2% |
| Adaptive | 82.8% | 95.4% |

The gradient consistently moves DECAY toward **0.82–0.84** regardless of initialization, confirming this range as the structural attractor (the orbit buffer's natural operating point, consistent with the Tribonacci attractor finding). STRENGTH drifts slightly at pre-P windows but the adaptive model performs marginally worse due to a noisier loss landscape.

**Conclusion:** The attractor is real; adaptive params don't help because the fixed value is already near the optimum.

---

### 2.2 Per-Cycle Buffer Parameters (`poc_percycle_buf.py`)

**Question:** Can independent buffer params per orbit cycle capture temporal structure in the seismogram?

**Method:** `_decay_logits = nn.Parameter(torch.full((CYCLES,), logit(0.83)))` — each cycle has its own decay and strength.

**Results:** Per-cycle params show opposite trajectories by window offset: at 0s (P-wave present), decay decreases c1→c3; at pre-P windows, decay increases c1→c3. The model learns that later cycles should be more conservative when signal is absent. However, gains over fixed params are marginal (+0.2–0.6% precision) and don't justify the additional complexity.

**Conclusion:** Don't use per-cycle params in production. The fixed scalar is adequate; the complexity cost is not recovered.

---

### 2.3 Streaming Inference (`poc_streaming.py`)

**Question:** If we feed sequential windows [-1s, -0.5s, 0s, +0.5s] at inference, does the buffer accumulate useful pre-P context?

**Method:** Train on single 0s window (standard). At inference, feed STREAM_OFFSETS=[-100,-50,0,50] samples sequentially with `streaming=True`. Evaluate 5 strategies: single-0s, stream-3 (first 3 windows), stream-4 (all), stream-max (max confidence across windows), stream-vote.

**Results:**

| strategy | prec | rec | vs baseline |
|---|---|---|---|
| single-0s | 84.2% | 94.9% | — |
| stream-3 | 80.6% | 96.0% | −3.6% |
| stream-4 | 79.2% | 95.1% | −5.0% |
| stream-max | 74.7% | 96.9% | −9.5% |
| stream-vote | 79.4% | 95.8% | −4.8% |

**Analysis:** Precision drops because the model was trained on 0s only. Pre-P windows are out-of-distribution — the buffer accumulates noise-shaped activations from the pre-P encoder, which then contaminate the 0s pass. The buffer is an amplifier: it amplifies the signal when the signal is there and amplifies noise when it isn't. Recall rises because the stream-max strategy can catch events where the buffer peaks before 0s.

**Conclusion:** Streaming inference with single-0s training degrades precision. The buffer needs to *learn* what pre-P buffer states look like.

---

### 2.4 Streaming-Aware Training (`poc_streaming_trained.py`)

**Question:** If we train with the full [-1s, -0.5s, 0s] sequence, does the model learn to use pre-P context correctly?

**Method:** During each training step:
1. Feed t=-1s window with `streaming=True`, inside `torch.no_grad()` (buffer warms up, no gradient)
2. Feed t=-0.5s window with `streaming=True`, inside `torch.no_grad()` (buffer warms up)
3. Feed t=0s window with `streaming=True`, gradient flows — compute loss here

The model learns that a legitimate earthquake produces a specific buffer state by 0s; noise produces a different buffer state. The pre-P encoder learns what "pre-P" looks like.

**Results (3 seeds, averaged):**

| training | strategy | prec | rec | vs baseline |
|---|---|---|---|---|
| single-trained | single-0s | 83.7% | 95.5% | — |
| single-trained | stream-3 | 80.8% | 95.3% | −2.9% |
| stream-trained | single-0s | 81.0% | 94.1% | −2.7% |
| stream-trained | stream-3 | 81.1% | **97.5%** | −2.6% |
| stream-trained | stream-4 | 80.5% | 97.4% | −3.2% |

**Analysis:** Streaming training fixes the precision collapse from streaming inference: single-trained stream-3 drops to 80.8%; stream-trained stream-3 holds at 81.1%. The recall gain is the real win: +2% recall over baseline (97.5% vs 95.5%) at only −2.6% precision. The cost of streaming training is a small degradation on the single-0s path (81.0% vs 83.7%) because the training task is harder.

The orbit buffer is a recall amplifier and signal accumulator, not a discriminator. Pre-P context helps recall significantly; precision is fundamentally a 0s classification problem.

**Conclusion:** Streaming-aware training is the correct approach for streaming deployment. Use stream-trained model with stream-3 strategy.

---

### 2.5 Optuna HPO (`poc_optuna.py`)

**Question:** Can joint optimization of threshold, DECAY, STRENGTH, and LR further improve the stream-trained model?

**Method:** 50 Optuna trials (TPE sampler), objective = maximize precision subject to recall ≥ 95% (recall floor). Stream-3 strategy evaluated at each trial's threshold. Search space:
- threshold: [0.30, 0.70]
- buf_decay: [0.75, 0.92]
- buf_strength: [0.80, 2.50]
- lr: [1e-4, 5e-3] log-uniform

**Best trial (#22):**

| param | value |
|---|---|
| threshold | 0.480 |
| buf_decay | 0.876 |
| buf_strength | 1.429 |
| lr | 2.78e-3 |
| **prec** | **88.0%** |
| **rec** | **95.7%** |

**Full eval at best config (re-trained, seed=99):**

| strategy | prec | rec | M<3/M3-5/M5+ |
|---|---|---|---|
| single-0s | 64.6% | 97.8% | 44.6%/37.2%/29.9% |
| **stream-3** | **88.8%** | **93.8%** | **77.2%/72.4%/66.1%** |
| stream-4 | 92.8% | 83.8% | 82.9%/81.9%/77.8% |
| stream-max | 63.6% | 97.4% | 43.4%/36.1%/29.2% |

Note: single-0s and stream-max collapse at threshold=0.48 because the threshold was optimized for stream-3; they over-fire at a sub-0.5 cutoff.

**Top-10 trial consensus:** buf_decay clusters at 0.84–0.90 (above the adaptive experiment's 0.82–0.84 attractor — the stream-3 strategy benefits from slightly higher momentum). Threshold clusters at 0.36–0.51. buf_strength varies widely (0.82–1.86), suggesting it's less critical than decay and threshold.

**Conclusion:** The default threshold=0.5 was suboptimal. Threshold=0.48 + decay=0.876 yield 88.0% precision at 95.7% recall — a **+4.3pp precision gain** over the fixed-parameter baseline.

---

## 3. Summary and Best Configuration

| experiment | prec | rec | key insight |
|---|---|---|---|
| Baseline (fixed, single-0s) | 83.7% | 95.5% | reference |
| Adaptive buffer | 82.8% | 95.4% | attractor confirmed at 0.82–0.84 |
| Per-cycle params | +0.4% | ≈same | marginal; don't use |
| Streaming inference only | 80.6% | 96.0% | precision degrades OOD |
| Streaming-aware training | 81.1% | 97.5% | fixes precision collapse; +2% recall |
| **Optuna HPO (champion)** | **88.0%** | **95.7%** | **threshold + decay tuning** |

**Champion configuration:**
```python
BUF_DECAY    = 0.876
BUF_STRENGTH = 1.429
THRESHOLD    = 0.480
LR           = 2.78e-3
TRAIN_MODE   = "streaming"    # feed [-1s, -0.5s] as warmup, classify at 0s
EVAL_STRAT   = "stream-3"     # feed -1s, -0.5s, then classify at 0s
```

---

## 4. Interpretation

The orbit buffer's role is now clear: **it is a signal accumulator and recall amplifier, not a discriminator**. Its job is to make the model more sensitive to the presence of a P-wave by giving the hidden state memory of recent waveform structure. This is exactly what the Hebbian formulation says: the buffer is an EMA of past activations, available to the next forward pass as a persistent context.

The orbit permutation `[0,1,3,7,6,4]` (the mod-9 powers-of-2 orbit, repeated to K=128) routes activations through the six orbit positions before the buffer update. This structured permutation, rather than random shuffling, is the distinguishing feature of the Tribar architecture — it imposes a geometric constraint on how information flows through the buffer.

Whether this permutation structure accounts for the performance gains (vs. a random buffer) remains an open question. The ablation, perm sweep, and ceiling experiments that followed address this directly.

---

### 2.6 Orbit Ablation (`poc_orbit_ablation.py`)

**Question:** Does the [0,1,3,7,6,4] orbit permutation outperform a random or identity permutation?

**Method:** Three variants at champion config (decay=0.876, strength=1.429, threshold=0.480), 3 seeds each, streaming-aware training, stream-3 eval.

**Results:**

| variant | mean prec | mean rec | range |
|---|---|---|---|
| orbit | 84.2% | 96.5% | 79.9%–88.1% |
| random | 86.1% | 96.7% | 85.6%–86.4% |
| identity | 85.0% | 95.7% | 84.1%–86.5% |

**Per-seed breakdown:**

| | seed 0 | seed 1 | seed 2 |
|---|---|---|---|
| orbit | 84.8% | 79.9% | 88.1% |
| random | 86.4% | 86.1% | 85.6% |
| identity | 84.3% | 86.5% | 84.1% |

**Analysis:** Orbit is high-variance (range 8.2pp); random is highly stable (range 0.8pp). Orbit's worst seed (79.9%) is significantly below random's worst (85.6%). The orbit permutation creates a structured rotation in hidden space — when the gradient aligns with it, you get the ceiling (88.1%); when it fights the orbit, you get the floor (79.9%). Random permutations break this structured symmetry, preventing gradient trapping. Identity (no permutation) is intermediate.

**Conclusion:** Orbit perm ≠ universal optimizer. It is a specific attractor: occasionally better than random (seed 2: +1.7pp), occasionally much worse (seed 1: -6.2pp). Random perm wins on reliability; orbit wins on ceiling.

---

### 2.7 Production Random Perm (`poc_random_perm_prod.py`)

**Question:** Does random perm deliver reliable 86%+ precision across 5 seeds?

**Method:** Champion config, streaming-aware training, stream-3 eval, SEEDS=5. Each seed draws a fresh `torch.randperm(K)` — no orbit structure.

**Results (5 seeds):**

| seed | prec | rec |
|---|---|---|
| 0 | 84.5% | 98.2% |
| 1 | 84.2% | 98.3% |
| 2 | **90.0%** | 96.7% |
| 3 | 83.5% | 98.6% |
| 4 | 89.7% | 97.5% |
| **mean** | **86.4%** | **97.9%** |
| std | ±2.85% | ±0.68% |

The distribution is bimodal: seeds 2 and 4 hit 90% while seeds 0, 1, 3 cluster at 83–85%. The specific permutation drawn matters — some random draws have better spectral mixing properties for the orbit buffer. Variance is higher than the 3-seed ablation suggested (6.5pp range).

---

### 2.8 Orbit Ceiling (`poc_orbit_ceiling.py`)

**Question:** What is the orbit perm's ceiling across 10 seeds?

**Method:** Champion config, SEEDS=10, orbit perm fixed, best model saved to `orbit_best.pt`.

**Results:**

```
Seed  Prec%   Rec%
  0   85.50   90.28
  1   85.67   96.13
  2   79.02   95.87
  3   89.22   94.67
  4   91.58   93.55
  5   83.01   96.22
  6   83.67   96.47
  7   92.00   89.94  ← BEST
  8   88.68   96.30
  9   89.60   94.84

Mean: 86.80% ±3.93%   Best: seed 7 → 92.00% / 89.94%
```

Orbit ceiling (92.0%) beats random best (90.0%) by 2pp, but at a recall cost (89.9% vs 96.7%). If recall ≥ 95% is required, the orbit ceiling is effectively the same as random's best — seed 7 doesn't meet the recall floor. Best orbit result meeting recall ≥ 95%: seed 8 at 88.7%.

---

### 2.9 Permutation Selection Sweep (`poc_perm_sweep.py`)

**Question:** Can a short warmup (3 or 10 epochs) reliably identify which perm will perform best at full training?

**Method:** 20 candidates (1 orbit + 19 random), warmup N epochs each, select winner by warmup precision, train winner to 30 epochs.

**Results:**

| warmup | selected | warmup prec | final prec | regression | orbit rank |
|---|---|---|---|---|---|
| 3 epochs | rand_04 | 90.6% | 86.3% | −4.4pp | 2/20 |
| 10 epochs | rand_02 | 92.4% | 85.9% | −6.4pp | 19/20 |

**Analysis:** Warmup selection is anti-predictive. High warmup precision = fast convergence to a *sharp local minimum*; high full-training precision = finding a *flat, generalizable minimum*. These are anti-correlated: the perms that look best at 3-10 epochs are converging to the wrong place. The regression grows with warmup length.

Orbit perm's rank reversal (2/20 at 3 epochs → 19/20 at 10 epochs) reveals its optimization character: the orbit's rugged loss landscape shows fast early progress but a harder mid-training phase, which is exactly why it sometimes reaches 92% — it keeps searching longer before settling.

**Conclusion:** Warmup-based perm selection does not work for this architecture. No shortcut to finding the best perm; the seed variance is unavoidable.

---

## 3. Summary and Best Configuration

| experiment | prec | rec | key insight |
|---|---|---|---|
| Baseline (fixed, single-0s) | 83.7% | 95.5% | reference |
| Adaptive buffer | 82.8% | 95.4% | attractor confirmed at 0.82–0.84 |
| Per-cycle params | +0.4% | ≈same | marginal; don't use |
| Streaming inference only | 80.6% | 96.0% | precision degrades OOD |
| Streaming-aware training | 81.1% | 97.5% | fixes precision collapse; +2% recall |
| Optuna HPO (champion) | 88.0% | 95.7% | threshold + decay tuning |
| Orbit ablation | 84.2%±3.3% | 96.5% | high-variance; random is stabler |
| Random perm (5 seeds) | 86.4%±2.85% | 97.9% | reliable; bimodal (83–90%) |
| **Orbit ceiling (10 seeds)** | **86.8%±3.93%** | **94.4%** | **best single: 92.0% / 89.9%** |
| Perm sweep (3e/10e warmup) | anti-predictive | — | warmup ranking ≠ final ranking |

**Production choice (reliability):** Random perm, CYCLES=1, dual-horizon and-gate, 5 seeds. Expected 92.3% prec / 95.0% rec ±1.79%. Floor: 89.6%. Train once, land in 90%+ regime reliably.

**Research ceiling (max precision):** Orbit perm, CYCLES=6, 10 seeds, take the best. Expected ceiling ~93-94% prec; recall may drop. Not recommended for production — high variance.

**Champion configuration (2026-08-05):**
```python
K            = 128
CYCLES       = 1       # ← not 3; CYCLES=1 outperforms by 3.9pp
BUF_DECAY    = 0.876
BUF_STRENGTH = 1.429
LR           = 2.78e-3
THRESHOLD    = 0.480
PERM         = torch.randperm(K)  # random fixed, seeded per run
TRAIN_MODE   = "dual-horizon"     # warm -1s → loss=0.5*CE(early@-0.5s)+0.5*CE(late@0s)
EVAL_STRAT   = "and-gate"         # both heads must agree at threshold
```

---

## 4. Interpretation

The orbit buffer's role is now clear: **it is a signal accumulator and recall amplifier, not a discriminator**. Its job is to make the model more sensitive to the presence of a P-wave by giving the hidden state memory of recent waveform structure.

The orbit permutation `[0,1,3,7,6,4]` (the mod-9 powers-of-2 orbit, repeated to K=128) is a **specific attractor**, not a universal optimizer. It creates a structured constraint in the optimization landscape that is occasionally exactly right (ceiling 92%) and occasionally a trap (floor 79.9%). The permutation determines the gradient's path through the loss landscape, not just the model's inductive bias.

Random permutations are safer because they don't impose a specific attractor — the loss landscape is smoother and the gradient finds a consistent solution. The orbit is worth using only when you have the compute budget to run multiple seeds and select the best.

---

## 5. Experiment Files

| file | description |
|---|---|
| `poc_tribar_seismo_stead.py` | Original baseline with magnitude-stratified sampling |
| `poc_adaptive_buf.py` | Learnable DECAY/STRENGTH via sigmoid/softplus |
| `poc_percycle_buf.py` | Independent params per orbit cycle |
| `poc_streaming.py` | Streaming inference (single-0s training) |
| `poc_streaming_trained.py` | Streaming-aware training on [-1s,-0.5s]→0s sequences |
| `poc_optuna.py` | Optuna HPO: 50 trials, TPE, recall-floor objective |
| `poc_orbit_ablation.py` | Orbit vs random vs identity perm (3 seeds each) |
| `poc_random_perm_prod.py` | Production random perm (5 seeds, champion config) |
| `poc_orbit_ceiling.py` | Orbit ceiling finder (10 seeds, saves best checkpoint) |
| `poc_perm_sweep.py` | Warmup-based perm selection (3-epoch and 10-epoch variants) |
| `poc_early_detection.py` | Early detection: classify at -0.5s vs 0s; 84.4%/98.5% vs 87.7%/96.1% |
| `poc_horizon_sweep.py` | Full horizon sweep: -1s cliff, -0.5s sweet spot, linear 3.2pp/0.5s |
| `poc_dual_horizon.py` | Dual-head (early+late); and-gate = 89.8%/97.5% with CYCLES=3 |
| `poc_cycles_ablation.py` | CYCLES ∈ {1-6}; CYCLES=1 best mean (85.0%), CYCLES=6 best ceiling |
| `poc_c1_dual.py` | **Champion:** CYCLES=1 + dual and-gate → 92.3%/95.0% ±1.79% (5 seeds) |

*Experiments: StreamingTribarNet (K=128, CYCLES=3), STEAD chunk2, magnitude-stratified sampling, WeightedRandomSampler. Hardware: CUDA (RunPod). Baseline established 2026-08-03; perm series completed 2026-08-05.*
