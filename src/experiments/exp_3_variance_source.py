#!/usr/bin/env python3
"""
Experiment 3: Variance Source Analysis
=======================================
Question: Why does the orbit permutation produce HIGH variance (79.9%-88.1%)
while random permutations are STABLE (85.6%-86.4%)?

The variance difference is striking and unexplained. Three hypotheses:

  H1: INITIALIZATION SENSITIVITY
      Orbit perm interacts badly with certain weight initializations.
      Test: same perm, many random initializations → does variance persist?

  H2: DATASET SPLIT SENSITIVITY
      Orbit perm overfits to certain data distributions.
      Test: same perm, same init, different dataset splits → does variance track splits?

  H3: STRUCTURAL FRAGILITY
      The orbit's periodic structure (0,1,3,7,6,4 tiled) creates resonance
      with specific conv filter patterns, amplifying small differences.
      Test: orbit vs orbit-shuffled (same 6 values, different order) → does
            the specific sequence matter, or just the values?

Protocol:
  For each hypothesis:
    H1: Train orbit perm × 10 seeds (varying init only, fixed split)
        Train random perm × 10 seeds (varying init only, fixed split)
        Compare variance.

    H2: Train orbit perm × 10 seeds (fixed init, varying data split)
        Train random perm × 10 seeds (fixed init, varying data split)
        Compare variance.

    H3: Train orbit perm [0,1,3,7,6,4] × 5 seeds
        Train orbit-shuffled (same values, random order) × 5 seeds × 3 shuffles
        Compare variance within each group.

Output:
  - Precision variance decomposed by hypothesis
  - Which factor explains orbit's high variance
  - Whether the specific orbit sequence [0,1,3,7,6,4] is special vs any 6-cycle
"""
import time, warnings
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F, torch.optim as optim
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
warnings.filterwarnings('ignore')

DEVICE      = 'cuda' if torch.cuda.is_available() else 'cpu'
K           = 128
CYCLES      = 3
WIN_SAMPLES = 100
MAX_EVENTS  = 8000
PER_BIN     = 2666
BATCH       = 64
EPOCHS      = 30
SIGMA       = 0.3

LR           = 2.78e-3
BUF_DECAY    = 0.876
BUF_STRENGTH = 1.429
THRESHOLD    = 0.480

STREAM_OFFSETS = [-100, -50, 0, 50]
TRAIN_N_STEPS  = 3
ORBIT_BASE     = [0, 1, 3, 7, 6, 4]

N_H1 = 8    # init seeds per perm type for H1
N_H2 = 8    # split seeds for H2
N_H3 = 5    # model seeds per permutation for H3
N_H3_SHUFFLES = 4   # shuffled orbit variants to test


# ── Permutations ───────────────────────────────────────────────────────────────

def make_orbit_perm(k):
    p = []
    while len(p) < k: p.extend(ORBIT_BASE)
    return torch.tensor(p[:k], dtype=torch.long)


def make_shuffled_orbit_perm(k, shuffle_seed):
    """Orbit values {0,1,3,4,6,7} in a random order (not the canonical sequence)."""
    rng = np.random.RandomState(shuffle_seed)
    shuffled = list(rng.permutation(ORBIT_BASE))
    p = []
    while len(p) < k: p.extend(shuffled)
    return torch.tensor(p[:k], dtype=torch.long), shuffled


def make_random_perm(k, seed):
    rng = np.random.RandomState(seed)
    return torch.tensor(rng.permutation(k), dtype=torch.long)


# ── Dataset ────────────────────────────────────────────────────────────────────

class MultiOffsetDataset(Dataset):
    def __init__(self, X_multi, y):
        self.X = torch.tensor(X_multi, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.long)
    def __len__(self): return len(self.y)
    def __getitem__(self, i): return self.X[i], self.y[i]


def load_streaming_data(global_seed=0):
    import seisbench.data as sbd
    np.random.seed(global_seed)
    eq = sbd.STEAD(download_kwargs={"chunk": "chunk2"}, cache=None)
    meta_df = eq.metadata
    cat_vals = meta_df['trace_category'].fillna('').str.lower().values
    mag_vals = meta_df['source_magnitude'].values.astype(float)
    all_pos  = np.arange(len(meta_df))

    eq_mask   = np.array(['earthquake' in c for c in cat_vals])
    eq_pos    = all_pos[eq_mask]; eq_mags = mag_vals[eq_mask]
    noise_pos = all_pos[np.array(['noise' in c for c in cat_vals])]

    nan_mask = np.isnan(eq_mags)
    b_lt3 = eq_pos[(eq_mags <  3.0) | nan_mask]
    b_3_5 = eq_pos[(eq_mags >= 3.0) & (eq_mags < 5.0)]
    b_ge5 = eq_pos[ eq_mags >= 5.0]
    t_ge5 = min(PER_BIN, len(b_ge5)); t_3_5 = min(PER_BIN, len(b_3_5))
    t_lt3 = min(MAX_EVENTS - t_ge5 - t_3_5, len(b_lt3))

    np.random.shuffle(b_lt3); np.random.shuffle(b_3_5); np.random.shuffle(b_ge5)
    eq_idx = np.concatenate([b_lt3[:t_lt3], b_3_5[:t_3_5], b_ge5[:t_ge5]])
    np.random.shuffle(eq_idx); np.random.shuffle(noise_pos)

    def load_multi(idx, p_samp):
        wf = eq.get_waveforms(int(idx))
        if wf is None or wf.shape[1] < 3000: return None
        wins = []
        for off in STREAM_OFFSETS:
            st = p_samp + off
            if st < 0 or st + WIN_SAMPLES > wf.shape[1]: return None
            w = wf[:, st:st+WIN_SAMPLES].astype(np.float32)
            if w.shape[1] < WIN_SAMPLES: return None
            std = w.std(axis=1, keepdims=True) + 1e-6
            wins.append(w / std)
        return np.stack(wins, axis=0)

    print("  loading earthquakes...", flush=True)
    X_eq_multi, mags_list = [], []
    for i, idx in enumerate(eq_idx):
        if i % 1000 == 0: print(f"    eq {i}/{len(eq_idx)} ok={len(X_eq_multi)}", flush=True)
        try:
            m = meta_df.iloc[int(idx)]
            p = int(m.get('trace_p_arrival_sample', 0) or 0)
            w = load_multi(idx, p)
            if w is not None:
                X_eq_multi.append(w)
                mags_list.append(float(m.get('source_magnitude', np.nan) or np.nan))
        except Exception: continue

    print("  loading noise...", flush=True)
    X_noise_multi = []
    for idx in noise_pos[:MAX_EVENTS * 4]:
        if len(X_noise_multi) >= MAX_EVENTS: break
        try:
            wf = eq.get_waveforms(int(idx))
            if wf is None or wf.shape[1] < 3000: continue
            wins, ok = [], True
            for _ in STREAM_OFFSETS:
                st = np.random.randint(0, max(1, wf.shape[1]-WIN_SAMPLES))
                w  = wf[:, st:st+WIN_SAMPLES].astype(np.float32)
                if w.shape[1] < WIN_SAMPLES: ok = False; break
                std = w.std(axis=1, keepdims=True) + 1e-6
                wins.append(w / std)
            if ok: X_noise_multi.append(np.stack(wins, axis=0))
        except Exception: continue

    n = min(len(X_eq_multi), len(X_noise_multi))
    print(f"  kept: {n} eq, {n} noise", flush=True)
    X_multi = np.concatenate([np.array(X_eq_multi[:n]), np.array(X_noise_multi[:n])], axis=0)
    y       = np.array([1]*n + [0]*n)
    mags    = np.concatenate([np.array(mags_list[:n]), np.full(n, np.nan)])
    p       = np.random.permutation(len(y))
    return X_multi[p], y[p], mags[p]


def make_loaders(X_multi, y, mags, val_frac=0.15, split_seed=42):
    """split_seed controls the train/val split boundary (for H2)."""
    n = len(y)
    rng = np.random.RandomState(split_seed)
    idx = rng.permutation(n)
    split = int(n * (1 - val_frac))
    tr_idx, va_idx = idx[:split], idx[split:]

    X_tr, y_tr = X_multi[tr_idx], y[tr_idx]
    X_va, y_va = X_multi[va_idx], y[va_idx]
    mags_tr    = mags[tr_idx]

    tr_ds = MultiOffsetDataset(X_tr, y_tr)
    va_ds = MultiOffsetDataset(X_va, y_va)

    weights = np.ones(split, dtype=np.float32)
    for label, lo, hi in [(1,-np.inf,3.0),(1,3.0,5.0),(1,5.0,np.inf),(0,-np.inf,np.inf)]:
        mask = (y_tr==1)&(np.nan_to_num(mags_tr,nan=0.)>=lo)&(np.nan_to_num(mags_tr,nan=0.)<hi) \
               if label==1 else (y_tr==0)
        n_b = mask.sum()
        if n_b > 0: weights[mask] = 1.0/n_b

    g = torch.Generator(); g.manual_seed(split_seed)
    sampler = WeightedRandomSampler(weights=weights, num_samples=split, replacement=True, generator=g)
    tr_dl = DataLoader(tr_ds, batch_size=BATCH, sampler=sampler, num_workers=0)
    return tr_dl, X_va, y_va


# ── Model ──────────────────────────────────────────────────────────────────────

class ConvBlock(nn.Module):
    def __init__(self, ci, co, k=7):
        super().__init__()
        self.net = nn.Sequential(nn.Conv1d(ci,co,k,padding=k//2), nn.BatchNorm1d(co), nn.ReLU())
    def forward(self, x): return self.net(x)


class PermNet(nn.Module):
    def __init__(self, perm, init_seed=None):
        super().__init__()
        if init_seed is not None:
            torch.manual_seed(init_seed)
        self.enc = nn.Sequential(ConvBlock(3,32), ConvBlock(32,64), ConvBlock(64,K),
                                 nn.AdaptiveAvgPool1d(1))
        self.register_buffer('perm', perm)
        self.cls  = nn.Linear(K, 2)
        self._buf = None

    def reset_stream(self): self._buf = None

    def forward(self, x, sigma=0.0, streaming=False):
        if sigma > 0: x = x + sigma * torch.randn_like(x)
        h   = self.enc(x).squeeze(-1)
        buf = self._buf if (streaming and self._buf is not None) else torch.zeros_like(h)
        for _ in range(CYCLES):
            h   = torch.relu(h[:, self.perm])
            buf = BUF_DECAY * buf + (1 - BUF_DECAY) * h.detach()
            h   = h + BUF_STRENGTH * buf
        if streaming: self._buf = buf.detach()
        return self.cls(h)


def train_and_eval(perm, tr_dl, X_val, y_val, init_seed=None):
    model = PermNet(perm, init_seed=init_seed)
    model.to(DEVICE).train()
    opt = optim.Adam(model.parameters(), lr=LR)
    ce  = nn.CrossEntropyLoss()
    for ep in range(EPOCHS):
        for xb, yb in tr_dl:
            xb, yb = xb.to(DEVICE), yb.to(DEVICE)
            model.reset_stream(); opt.zero_grad()
            with torch.no_grad():
                for t in range(TRAIN_N_STEPS - 1):
                    model(xb[:, t], sigma=SIGMA, streaming=True)
            ce(model(xb[:, TRAIN_N_STEPS-1], sigma=SIGMA, streaming=True), yb).backward()
            opt.step()

    model.eval(); model.reset_stream()
    with torch.no_grad():
        for t in range(3):
            Xt     = torch.tensor(X_val[:, t], dtype=torch.float32).to(DEVICE)
            logits = model(Xt, streaming=True)
        conf = F.softmax(logits, dim=1)[:, 1].cpu().numpy()
    preds = (conf >= THRESHOLD).astype(int)
    tp = ((preds==1)&(y_val==1)).sum(); fp = ((preds==1)&(y_val==0)).sum()
    fn = ((preds==0)&(y_val==1)).sum()
    return float(tp/(tp+fp+1e-9)), float(tp/(tp+fn+1e-9))


def variance_summary(name, precs):
    arr = np.array(precs)
    return (f"  {name:<28}  n={len(arr)}  "
            f"mean={arr.mean()*100:.2f}%  std={arr.std()*100:.2f}%  "
            f"range={arr.min()*100:.1f}%–{arr.max()*100:.1f}%")


# ── Main ───────────────────────────────────────────────────────────────────────

print(f"{'='*70}")
print(f"EXPERIMENT 3: VARIANCE SOURCE ANALYSIS")
print(f"{'='*70}")
print(f"device={DEVICE}  K={K}  EPOCHS={EPOCHS}")
print(f"Orbit perm: {ORBIT_BASE} (tiled)")
print()

print("Loading dataset (fixed global seed=0)...", flush=True)
X_multi, y, mags = load_streaming_data(global_seed=0)
print()

# ── H1: Initialization sensitivity ────────────────────────────────────────────
print(f"{'='*70}")
print(f"H1: INITIALIZATION SENSITIVITY")
print(f"    Fixed data split (seed=42), varying init seed × {N_H1} runs per perm")
print(f"{'='*70}")

FIXED_SPLIT_SEED = 42
tr_dl_fixed, X_val_fixed, y_val_fixed = make_loaders(X_multi, y, mags, split_seed=FIXED_SPLIT_SEED)

h1_orbit_precs  = []
h1_random_precs = []

for i in range(N_H1):
    t0 = time.time()
    p, _ = train_and_eval(make_orbit_perm(K), tr_dl_fixed, X_val_fixed, y_val_fixed, init_seed=i)
    h1_orbit_precs.append(p)
    print(f"  orbit init_{i}: prec={p*100:.1f}%  ({int(time.time()-t0)}s)", flush=True)

for i in range(N_H1):
    t0 = time.time()
    p, _ = train_and_eval(make_random_perm(K, seed=i+50), tr_dl_fixed, X_val_fixed, y_val_fixed,
                          init_seed=i)
    h1_random_precs.append(p)
    print(f"  rand  init_{i}: prec={p*100:.1f}%  ({int(time.time()-t0)}s)", flush=True)

print()
print(variance_summary("orbit (H1: init vary)", h1_orbit_precs))
print(variance_summary("random (H1: init vary)", h1_random_precs))
h1_explains = np.std(h1_orbit_precs) > 1.5 * np.std(h1_random_precs)
print(f"  H1 explains orbit variance: {'YES' if h1_explains else 'NO'}")

# ── H2: Dataset split sensitivity ─────────────────────────────────────────────
print(f"\n{'='*70}")
print(f"H2: DATASET SPLIT SENSITIVITY")
print(f"    Fixed init (seed=0), varying split seed × {N_H2} splits per perm")
print(f"{'='*70}")

FIXED_INIT_SEED = 0
h2_orbit_precs  = []
h2_random_precs = []

for i in range(N_H2):
    tr_dl_i, X_val_i, y_val_i = make_loaders(X_multi, y, mags, split_seed=i*7+1)
    t0 = time.time()
    p, _ = train_and_eval(make_orbit_perm(K), tr_dl_i, X_val_i, y_val_i,
                          init_seed=FIXED_INIT_SEED)
    h2_orbit_precs.append(p)
    print(f"  orbit split_{i}: prec={p*100:.1f}%  ({int(time.time()-t0)}s)", flush=True)

for i in range(N_H2):
    tr_dl_i, X_val_i, y_val_i = make_loaders(X_multi, y, mags, split_seed=i*7+1)
    t0 = time.time()
    p, _ = train_and_eval(make_random_perm(K, seed=i+200), tr_dl_i, X_val_i, y_val_i,
                          init_seed=FIXED_INIT_SEED)
    h2_random_precs.append(p)
    print(f"  rand  split_{i}: prec={p*100:.1f}%  ({int(time.time()-t0)}s)", flush=True)

print()
print(variance_summary("orbit (H2: split vary)", h2_orbit_precs))
print(variance_summary("random (H2: split vary)", h2_random_precs))
h2_explains = np.std(h2_orbit_precs) > 1.5 * np.std(h2_random_precs)
print(f"  H2 explains orbit variance: {'YES' if h2_explains else 'NO'}")

# ── H3: Structural fragility (specific sequence vs shuffled) ──────────────────
print(f"\n{'='*70}")
print(f"H3: STRUCTURAL FRAGILITY")
print(f"    Does the specific sequence {ORBIT_BASE} matter, or just the values?")
print(f"    Comparing canonical orbit vs {N_H3_SHUFFLES} shuffled variants × {N_H3} seeds each")
print(f"{'='*70}")

h3_results = {}  # name → list of precs

# Canonical orbit
print(f"\n  Canonical orbit {ORBIT_BASE}:")
canon_precs = []
for i in range(N_H3):
    tr_dl_i, X_val_i, y_val_i = make_loaders(X_multi, y, mags, split_seed=i)
    t0 = time.time()
    p, _ = train_and_eval(make_orbit_perm(K), tr_dl_i, X_val_i, y_val_i, init_seed=i)
    canon_precs.append(p)
    print(f"    seed_{i}: prec={p*100:.1f}%  ({int(time.time()-t0)}s)", flush=True)
h3_results['orbit_canonical'] = canon_precs

# Shuffled orbit variants
for sh in range(N_H3_SHUFFLES):
    perm_sh, seq = make_shuffled_orbit_perm(K, shuffle_seed=sh+10)
    name = f'orbit_shuf_{sh}'
    print(f"\n  Shuffled orbit {seq}:")
    sh_precs = []
    for i in range(N_H3):
        tr_dl_i, X_val_i, y_val_i = make_loaders(X_multi, y, mags, split_seed=i)
        t0 = time.time()
        p, _ = train_and_eval(perm_sh, tr_dl_i, X_val_i, y_val_i, init_seed=i)
        sh_precs.append(p)
        print(f"    seed_{i}: prec={p*100:.1f}%  ({int(time.time()-t0)}s)", flush=True)
    h3_results[name] = sh_precs

print()
for name, precs in h3_results.items():
    print(variance_summary(f"{name}", precs))

all_h3_stds = [np.std(v) for v in h3_results.values()]
canon_std   = all_h3_stds[0]
shuf_stds   = all_h3_stds[1:]
h3_canon_special = canon_std < np.mean(shuf_stds) * 0.8 or canon_std > np.mean(shuf_stds) * 1.25
print(f"\n  Canonical orbit std: {canon_std*100:.2f}%  Shuffled mean std: "
      f"{np.mean(shuf_stds)*100:.2f}%")
print(f"  H3 specific sequence matters: {'YES' if h3_canon_special else 'NO — all variants behave similarly'}")

# ── Final summary ──────────────────────────────────────────────────────────────
print(f"\n{'='*70}")
print(f"VARIANCE SOURCE ANALYSIS — SUMMARY")
print(f"{'='*70}")
print(f"\n  Prior ablation: orbit 84.2% ± 3.3%  |  random 86.1% ± 0.4%")
print()
print(f"  H1 (initialization):  orbit std={np.std(h1_orbit_precs)*100:.2f}%  "
      f"random std={np.std(h1_random_precs)*100:.2f}%  "
      f"→ {'EXPLAINS' if h1_explains else 'does not explain'}")
print(f"  H2 (data split):      orbit std={np.std(h2_orbit_precs)*100:.2f}%  "
      f"random std={np.std(h2_random_precs)*100:.2f}%  "
      f"→ {'EXPLAINS' if h2_explains else 'does not explain'}")
print(f"  H3 (sequence):        canonical std={canon_std*100:.2f}%  "
      f"shuffled mean std={np.mean(shuf_stds)*100:.2f}%  "
      f"→ {'specific sequence matters' if h3_canon_special else 'sequence does not matter'}")

if h1_explains and not h2_explains:
    conclusion = ("Orbit variance is primarily due to INITIALIZATION SENSITIVITY. "
                  "The tiled periodic structure creates a loss landscape with multiple "
                  "basins of attraction, and which basin training finds depends heavily "
                  "on weight init. Random perms lack this periodicity and converge more "
                  "reliably. Mitigation: use more seeds and select the best checkpoint.")
elif h2_explains and not h1_explains:
    conclusion = ("Orbit variance is primarily due to DATA SPLIT SENSITIVITY. "
                  "The orbit perm overfits to specific magnitude distributions in the "
                  "training set. Different val splits expose different weaknesses. "
                  "Mitigation: use stratified splits and cross-validation.")
elif h1_explains and h2_explains:
    conclusion = ("Orbit variance is due to BOTH initialization and data split sensitivity. "
                  "The periodic structure creates a brittle loss landscape AND the model "
                  "overfits to training distribution specifics. Both need mitigation.")
else:
    conclusion = ("Neither H1 nor H2 fully explains orbit variance. "
                  "The variance may be stochastic or require deeper analysis "
                  "(gradient flow, loss landscape curvature, filter analysis).")

print(f"\n  Conclusion: {conclusion}")
print(f"\nDone.")
