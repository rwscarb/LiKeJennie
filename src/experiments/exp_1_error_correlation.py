#!/usr/bin/env python3
"""
Experiment 1: Error Correlation Analysis
=========================================
Question: Do orbit-perm and random-perm models make errors on the SAME examples,
or on systematically DIFFERENT examples?

If same → permutation is irrelevant, both learn identical features.
If different → orbit structure is a genuinely different "view," valuable in ensemble
               even if individually weaker on mean precision.

Protocol:
  1. Train SEEDS orbit-perm models + SEEDS random-perm models (same dataset splits)
  2. For each pair (orbit_i, random_j), compute per-example agreement/disagreement
  3. Measure error correlation: Jaccard similarity of error sets, Cohen's kappa
  4. Compare: orbit-vs-orbit vs orbit-vs-random vs random-vs-random correlation
  5. If orbit errors are uncorrelated with random errors → ensemble diversity exists

Output:
  - Per-seed precision/recall for both perm types
  - Error set sizes + Jaccard similarities (3x3 matrix)
  - Cohen's kappa between all pairs
  - Verdict: is orbit a genuinely diverse view or just a noisier random?

Based on ablation results:
  Orbit perm [0,1,3,7,6,4]: mean 84.2% prec, HIGH variance (79.9%-88.1%)
  Random fixed perm:         mean 86.1% prec, STABLE    (85.6%-86.4%)
"""
import time, warnings
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F, torch.optim as optim
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
warnings.filterwarnings('ignore')

DEVICE       = 'cuda' if torch.cuda.is_available() else 'cpu'
K            = 128
CYCLES       = 3
WIN_SAMPLES  = 100
MAX_EVENTS   = 8000
PER_BIN      = 2666
BATCH        = 64
EPOCHS       = 30
SIGMA        = 0.3
SEEDS        = 3          # seeds per perm type; 3 orbit + 3 random = 6 models total

# Champion HPO config
LR           = 2.78e-3
BUF_DECAY    = 0.876
BUF_STRENGTH = 1.429
THRESHOLD    = 0.480

STREAM_OFFSETS = [-100, -50, 0, 50]
TRAIN_N_STEPS  = 3

ORBIT_BASE = [0, 1, 3, 7, 6, 4]


# ── Permutations ───────────────────────────────────────────────────────────────

def make_orbit_perm(k):
    p = []
    while len(p) < k:
        p.extend(ORBIT_BASE)
    return torch.tensor(p[:k], dtype=torch.long)


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


def load_streaming_data():
    import seisbench.data as sbd
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
    print(f"  bins: M<3={t_lt3} M3-5={t_3_5} M5+={t_ge5}", flush=True)

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
                st = np.random.randint(0, max(1, wf.shape[1] - WIN_SAMPLES))
                w  = wf[:, st:st + WIN_SAMPLES].astype(np.float32)
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
    perm    = np.random.permutation(len(y))
    return X_multi[perm], y[perm], mags[perm]


def make_loaders(X_multi, y, mags, val_frac=0.15, seed=42):
    n = len(y); split = int(n * (1 - val_frac))
    tr = MultiOffsetDataset(X_multi[:split], y[:split])
    va = MultiOffsetDataset(X_multi[split:], y[split:])
    tr_mags = mags[:split]; tr_y = y[:split]
    weights = np.ones(split, dtype=np.float32)
    for label, lo, hi in [(1,-np.inf,3.0),(1,3.0,5.0),(1,5.0,np.inf),(0,-np.inf,np.inf)]:
        mask = (tr_y==1)&(np.nan_to_num(tr_mags,nan=0.)>=lo)&(np.nan_to_num(tr_mags,nan=0.)<hi) \
               if label==1 else (tr_y==0)
        n_b = mask.sum()
        if n_b > 0: weights[mask] = 1.0 / n_b
    g = torch.Generator(); g.manual_seed(seed)
    sampler = WeightedRandomSampler(weights=weights, num_samples=split, replacement=True,
                                    generator=g)
    return (DataLoader(tr, batch_size=BATCH, sampler=sampler, num_workers=0),
            DataLoader(va, batch_size=BATCH, shuffle=False, num_workers=0), split)


# ── Model ──────────────────────────────────────────────────────────────────────

class ConvBlock(nn.Module):
    def __init__(self, ci, co, k=7):
        super().__init__()
        self.net = nn.Sequential(nn.Conv1d(ci,co,k,padding=k//2), nn.BatchNorm1d(co), nn.ReLU())
    def forward(self, x): return self.net(x)


class PermNet(nn.Module):
    def __init__(self, perm: torch.Tensor):
        super().__init__()
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


# ── Training ───────────────────────────────────────────────────────────────────

def train_model(model, tr_dl):
    model.to(DEVICE).train()
    opt = optim.Adam(model.parameters(), lr=LR)
    ce  = nn.CrossEntropyLoss()
    for ep in range(EPOCHS):
        for xb, yb in tr_dl:
            xb, yb = xb.to(DEVICE), yb.to(DEVICE)
            model.reset_stream()
            opt.zero_grad()
            with torch.no_grad():
                for t in range(TRAIN_N_STEPS - 1):
                    model(xb[:, t], sigma=SIGMA, streaming=True)
            logits = model(xb[:, TRAIN_N_STEPS-1], sigma=SIGMA, streaming=True)
            ce(logits, yb).backward()
            opt.step()


def get_predictions(model, X_val, threshold=THRESHOLD):
    """Returns per-example binary predictions and confidences."""
    model.to(DEVICE).eval()
    model.reset_stream()
    with torch.no_grad():
        for t in range(3):
            Xt     = torch.tensor(X_val[:, t], dtype=torch.float32).to(DEVICE)
            logits = model(Xt, streaming=True)
        conf = F.softmax(logits, dim=1)[:, 1].cpu().numpy()
    return (conf >= threshold).astype(int), conf


# ── Error correlation metrics ──────────────────────────────────────────────────

def jaccard(err_a, err_b):
    """Jaccard similarity of two boolean error arrays."""
    intersection = (err_a & err_b).sum()
    union        = (err_a | err_b).sum()
    return float(intersection) / float(union + 1e-9)


def cohen_kappa(pred_a, pred_b):
    """Cohen's kappa between two prediction arrays."""
    n   = len(pred_a)
    p_o = (pred_a == pred_b).mean()          # observed agreement
    # Expected agreement
    p_a1 = pred_a.mean(); p_b1 = pred_b.mean()
    p_e = p_a1 * p_b1 + (1 - p_a1) * (1 - p_b1)
    return (p_o - p_e) / (1 - p_e + 1e-9)


def error_mask(preds, y_true):
    """Boolean mask: True where model made a wrong prediction."""
    return preds != y_true


# ── Main ───────────────────────────────────────────────────────────────────────

print(f"{'='*70}")
print(f"EXPERIMENT 1: ERROR CORRELATION ANALYSIS")
print(f"{'='*70}")
print(f"device={DEVICE}  K={K}  EPOCHS={EPOCHS}  SEEDS={SEEDS} per perm type")
print(f"Orbit perm: {ORBIT_BASE} (tiled to K={K})")
print(f"Random perm: torch.randperm({K}) seeded per model")
print()

torch.manual_seed(0); np.random.seed(0)
print("Loading dataset...", flush=True)
X_multi, y, mags = load_streaming_data()
SPLIT    = int(len(y) * 0.85)
X_val    = X_multi[SPLIT:]
y_val    = y[SPLIT:]
print(f"Val set: {len(y_val)} examples  ({y_val.sum()} eq, {(y_val==0).sum()} noise)\n")

# ── Train all models ──────────────────────────────────────────────────────────
orbit_preds   = []   # list of (preds_array, conf_array, prec, rec)
random_preds  = []

for seed in range(SEEDS):
    torch.manual_seed(seed); np.random.seed(seed)
    tr_dl, _, _ = make_loaders(X_multi, y, mags, seed=seed)

    # --- Orbit model ---
    print(f"Training orbit seed {seed}...", flush=True)
    m_orbit = PermNet(make_orbit_perm(K))
    t0 = time.time()
    train_model(m_orbit, tr_dl)
    preds_o, conf_o = get_predictions(m_orbit, X_val)
    tp = ((preds_o==1)&(y_val==1)).sum(); fp = ((preds_o==1)&(y_val==0)).sum()
    fn = ((preds_o==0)&(y_val==1)).sum()
    prec_o = tp/(tp+fp+1e-9); rec_o = tp/(tp+fn+1e-9)
    orbit_preds.append({'preds': preds_o, 'conf': conf_o, 'prec': prec_o, 'rec': rec_o,
                        'name': f'orbit_{seed}'})
    print(f"  orbit_{seed}: prec={prec_o*100:.1f}%  rec={rec_o*100:.1f}%  "
          f"({int(time.time()-t0)}s)", flush=True)

    # --- Random model (same seed → different perm) ---
    print(f"Training random seed {seed}...", flush=True)
    torch.manual_seed(seed + 100); np.random.seed(seed + 100)
    tr_dl2, _, _ = make_loaders(X_multi, y, mags, seed=seed)
    m_rand = PermNet(make_random_perm(K, seed=seed + 100))
    t0 = time.time()
    train_model(m_rand, tr_dl2)
    preds_r, conf_r = get_predictions(m_rand, X_val)
    tp = ((preds_r==1)&(y_val==1)).sum(); fp = ((preds_r==1)&(y_val==0)).sum()
    fn = ((preds_r==0)&(y_val==1)).sum()
    prec_r = tp/(tp+fp+1e-9); rec_r = tp/(tp+fn+1e-9)
    random_preds.append({'preds': preds_r, 'conf': conf_r, 'prec': prec_r, 'rec': rec_r,
                         'name': f'rand_{seed}'})
    print(f"  rand_{seed}:  prec={prec_r*100:.1f}%  rec={rec_r*100:.1f}%  "
          f"({int(time.time()-t0)}s)", flush=True)
    print()

all_models = orbit_preds + random_preds
n_models   = len(all_models)

# ── Per-example error analysis ─────────────────────────────────────────────────
print(f"\n{'='*70}")
print(f"ERROR CORRELATION MATRIX (Jaccard similarity of error sets)")
print(f"{'='*70}")
print(f"{'':>12}", end='')
for m in all_models: print(f"  {m['name']:>10}", end='')
print()

jaccard_matrix = np.zeros((n_models, n_models))
for i, mi in enumerate(all_models):
    errs_i = error_mask(mi['preds'], y_val)
    print(f"  {mi['name']:>10}", end='')
    for j, mj in enumerate(all_models):
        errs_j = error_mask(mj['preds'], y_val)
        jac = jaccard(errs_i, errs_j)
        jaccard_matrix[i, j] = jac
        print(f"  {jac:>10.3f}", end='')
    print()

print(f"\n{'='*70}")
print(f"COHEN'S KAPPA MATRIX (prediction agreement)")
print(f"{'='*70}")
print(f"{'':>12}", end='')
for m in all_models: print(f"  {m['name']:>10}", end='')
print()

kappa_matrix = np.zeros((n_models, n_models))
for i, mi in enumerate(all_models):
    print(f"  {mi['name']:>10}", end='')
    for j, mj in enumerate(all_models):
        kappa = cohen_kappa(mi['preds'], mj['preds'])
        kappa_matrix[i, j] = kappa
        print(f"  {kappa:>10.3f}", end='')
    print()

# ── Aggregate statistics ───────────────────────────────────────────────────────
print(f"\n{'='*70}")
print(f"AGGREGATE CORRELATION STATISTICS")
print(f"{'='*70}")

n_o = SEEDS
# Orbit-vs-orbit (upper triangle, excluding diagonal)
oo_jac = [jaccard_matrix[i,j] for i in range(n_o) for j in range(i+1, n_o)]
# Random-vs-random
rr_jac = [jaccard_matrix[n_o+i, n_o+j] for i in range(SEEDS) for j in range(i+1, SEEDS)]
# Orbit-vs-random (all cross pairs)
or_jac = [jaccard_matrix[i, n_o+j] for i in range(n_o) for j in range(SEEDS)]

oo_kap = [kappa_matrix[i,j] for i in range(n_o) for j in range(i+1, n_o)]
rr_kap = [kappa_matrix[n_o+i, n_o+j] for i in range(SEEDS) for j in range(i+1, SEEDS)]
or_kap = [kappa_matrix[i, n_o+j] for i in range(n_o) for j in range(SEEDS)]

def _fmt(vals):
    if not vals: return "n/a"
    return f"{np.mean(vals):.3f} ± {np.std(vals):.3f}"

print(f"  Jaccard (error set overlap — lower = more diverse):")
print(f"    orbit-vs-orbit : {_fmt(oo_jac)}")
print(f"    rand-vs-rand   : {_fmt(rr_jac)}")
print(f"    orbit-vs-rand  : {_fmt(or_jac)}")
print()
print(f"  Cohen's kappa (prediction agreement — lower = more diverse):")
print(f"    orbit-vs-orbit : {_fmt(oo_kap)}")
print(f"    rand-vs-rand   : {_fmt(rr_kap)}")
print(f"    orbit-vs-rand  : {_fmt(or_kap)}")

print(f"\n{'='*70}")
print(f"VERDICT")
print(f"{'='*70}")
mean_or = np.mean(or_jac) if or_jac else 0
mean_rr = np.mean(rr_jac) if rr_jac else 0
mean_oo = np.mean(oo_jac) if oo_jac else 0

if mean_or < min(mean_rr, mean_oo) * 0.85:
    verdict = ("DIVERSE: Orbit errors are substantially uncorrelated with random errors. "
               "Orbit perm provides genuine ensemble diversity — worth including despite "
               "lower mean precision.")
elif mean_or > max(mean_rr, mean_oo) * 0.95:
    verdict = ("REDUNDANT: Orbit errors are highly correlated with random errors. "
               "Orbit perm is effectively interchangeable with any random perm. "
               "The mod-9 structure adds no independent signal.")
else:
    verdict = ("AMBIGUOUS: Orbit errors show moderate correlation with random errors. "
               "Some diversity exists but is not strongly distinctive. "
               "Run Exp 2 (ensemble mixing) to test practical ensemble value.")

print(f"\n  {verdict}")

print(f"\n  Orbit model precision:  {np.mean([m['prec'] for m in orbit_preds])*100:.1f}% "
      f"± {np.std([m['prec'] for m in orbit_preds])*100:.2f}%")
print(f"  Random model precision: {np.mean([m['prec'] for m in random_preds])*100:.1f}% "
      f"± {np.std([m['prec'] for m in random_preds])*100:.2f}%")
print(f"\nDone.")
