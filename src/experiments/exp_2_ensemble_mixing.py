#!/usr/bin/env python3
"""
Experiment 2: Ensemble Mixing — Does Orbit Add Value?
======================================================
Question: Does mixing orbit-perm models into an ensemble outperform
a pure random-perm ensemble of the same total size?

If orbit is a genuinely different "view," mixing it in should reduce
ensemble error even if individual orbit models have lower mean precision.
If orbit is just noisier-random, mixing it in should hurt or be neutral.

Protocol:
  1. Train N_ORBIT orbit models + N_RANDOM random models
  2. Evaluate ensembles by majority vote + soft voting (mean confidence):
       a. All-random:       N_RANDOM random models
       b. All-orbit:        N_ORBIT orbit models
       c. Mixed 50/50:      N_ORBIT orbit + N_ORBIT random (same total size)
       d. Mixed 1-orbit:    1 orbit + (N_RANDOM-1) random
       e. Mixed best-orbit: best individual orbit + N_RANDOM-1 randoms
  3. Compare ensemble precision, recall, F1 across strategies
  4. Test at multiple thresholds (soft vote) to build PR curve per strategy

Verdict criterion:
  If mixed_50_50 beats all_random by >1pp F1 → orbit adds ensemble value
  If mixed_50_50 matches or beats all_random → orbit is neutral/useful
  If mixed_50_50 underperforms all_random → orbit hurts ensemble quality

Based on ablation:
  Orbit perm: mean 84.2% prec, high variance
  Random perm: mean 86.1% prec, stable
"""
import time, warnings
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F, torch.optim as optim
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
warnings.filterwarnings('ignore')

DEVICE    = 'cuda' if torch.cuda.is_available() else 'cpu'
K         = 128
CYCLES    = 3
WIN_SAMPLES = 100
MAX_EVENTS  = 8000
PER_BIN     = 2666
BATCH       = 64
EPOCHS      = 30
SIGMA       = 0.3
N_ORBIT     = 3
N_RANDOM    = 3

LR           = 2.78e-3
BUF_DECAY    = 0.876
BUF_STRENGTH = 1.429
THRESHOLD    = 0.480

STREAM_OFFSETS = [-100, -50, 0, 50]
TRAIN_N_STEPS  = 3
ORBIT_BASE     = [0, 1, 3, 7, 6, 4]

PR_THRESHOLDS = np.linspace(0.2, 0.9, 29)   # for PR curve


# ── Permutations ───────────────────────────────────────────────────────────────

def make_orbit_perm(k):
    p = []
    while len(p) < k: p.extend(ORBIT_BASE)
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
    perm    = np.random.permutation(len(y))
    return X_multi[perm], y[perm], mags[perm]


def make_loaders(X_multi, y, mags, val_frac=0.15, seed=42):
    n = len(y); split = int(n * (1 - val_frac))
    tr = MultiOffsetDataset(X_multi[:split], y[:split])
    tr_mags = mags[:split]; tr_y = y[:split]
    weights = np.ones(split, dtype=np.float32)
    for label, lo, hi in [(1,-np.inf,3.0),(1,3.0,5.0),(1,5.0,np.inf),(0,-np.inf,np.inf)]:
        mask = (tr_y==1)&(np.nan_to_num(tr_mags,nan=0.)>=lo)&(np.nan_to_num(tr_mags,nan=0.)<hi) \
               if label==1 else (tr_y==0)
        n_b = mask.sum()
        if n_b > 0: weights[mask] = 1.0/n_b
    g = torch.Generator(); g.manual_seed(seed)
    sampler = WeightedRandomSampler(weights=weights, num_samples=split, replacement=True, generator=g)
    return DataLoader(tr, batch_size=BATCH, sampler=sampler, num_workers=0), split


# ── Model ──────────────────────────────────────────────────────────────────────

class ConvBlock(nn.Module):
    def __init__(self, ci, co, k=7):
        super().__init__()
        self.net = nn.Sequential(nn.Conv1d(ci,co,k,padding=k//2), nn.BatchNorm1d(co), nn.ReLU())
    def forward(self, x): return self.net(x)


class PermNet(nn.Module):
    def __init__(self, perm):
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


# ── Train ──────────────────────────────────────────────────────────────────────

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


def get_confs(model, X_val):
    model.to(DEVICE).eval(); model.reset_stream()
    with torch.no_grad():
        for t in range(3):
            Xt     = torch.tensor(X_val[:, t], dtype=torch.float32).to(DEVICE)
            logits = model(Xt, streaming=True)
        return F.softmax(logits, dim=1)[:, 1].cpu().numpy()


# ── Ensemble evaluation ────────────────────────────────────────────────────────

def ensemble_metrics(conf_list, y_true, threshold=THRESHOLD):
    """Soft vote (mean confidence) ensemble."""
    mean_conf = np.mean(np.stack(conf_list, axis=0), axis=0)
    preds = (mean_conf >= threshold).astype(int)
    tp = ((preds==1)&(y_true==1)).sum()
    fp = ((preds==1)&(y_true==0)).sum()
    fn = ((preds==0)&(y_true==1)).sum()
    prec = tp/(tp+fp+1e-9); rec = tp/(tp+fn+1e-9)
    f1   = 2*prec*rec/(prec+rec+1e-9)
    return prec, rec, f1, mean_conf


def pr_curve(conf_list, y_true):
    """Precision-recall at multiple thresholds for a soft-vote ensemble."""
    mean_conf = np.mean(np.stack(conf_list, axis=0), axis=0)
    results = []
    for thr in PR_THRESHOLDS:
        preds = (mean_conf >= thr).astype(int)
        tp = ((preds==1)&(y_true==1)).sum()
        fp = ((preds==1)&(y_true==0)).sum()
        fn = ((preds==0)&(y_true==1)).sum()
        prec = tp/(tp+fp+1e-9); rec = tp/(tp+fn+1e-9)
        f1   = 2*prec*rec/(prec+rec+1e-9)
        results.append((thr, prec, rec, f1))
    return results


# ── Main ───────────────────────────────────────────────────────────────────────

print(f"{'='*70}")
print(f"EXPERIMENT 2: ENSEMBLE MIXING")
print(f"{'='*70}")
print(f"device={DEVICE}  K={K}  EPOCHS={EPOCHS}")
print(f"Training {N_ORBIT} orbit models + {N_RANDOM} random models")
print()

torch.manual_seed(0); np.random.seed(0)
print("Loading dataset...", flush=True)
X_multi, y, mags = load_streaming_data()
SPLIT = int(len(y) * 0.85)
X_val = X_multi[SPLIT:]; y_val = y[SPLIT:]
print(f"Val: {len(y_val)} examples\n")

orbit_confs  = []
random_confs = []
orbit_precs  = []
random_precs = []

for i in range(max(N_ORBIT, N_RANDOM)):
    if i < N_ORBIT:
        torch.manual_seed(i); np.random.seed(i)
        tr_dl, _ = make_loaders(X_multi, y, mags, seed=i)
        m = PermNet(make_orbit_perm(K))
        t0 = time.time()
        print(f"Training orbit_{i}...", flush=True)
        train_model(m, tr_dl)
        c = get_confs(m, X_val)
        p = ((c>=THRESHOLD)&(y_val==1)).sum() / ((c>=THRESHOLD).sum()+1e-9)
        orbit_confs.append(c); orbit_precs.append(float(p))
        print(f"  orbit_{i}: prec={p*100:.1f}%  ({int(time.time()-t0)}s)", flush=True)

    if i < N_RANDOM:
        torch.manual_seed(i+100); np.random.seed(i+100)
        tr_dl, _ = make_loaders(X_multi, y, mags, seed=i)
        m = PermNet(make_random_perm(K, seed=i+100))
        t0 = time.time()
        print(f"Training rand_{i}...", flush=True)
        train_model(m, tr_dl)
        c = get_confs(m, X_val)
        p = ((c>=THRESHOLD)&(y_val==1)).sum() / ((c>=THRESHOLD).sum()+1e-9)
        random_confs.append(c); random_precs.append(float(p))
        print(f"  rand_{i}:  prec={p*100:.1f}%  ({int(time.time()-t0)}s)", flush=True)
    print()

# ── Build ensemble strategies ──────────────────────────────────────────────────
best_orbit_idx = int(np.argmax(orbit_precs))

strategies = {
    'all_orbit':       orbit_confs[:N_ORBIT],
    'all_random':      random_confs[:N_RANDOM],
    'mixed_50_50':     orbit_confs[:N_ORBIT] + random_confs[:N_ORBIT],
    'mixed_1orbit':    [orbit_confs[0]] + random_confs[:N_RANDOM-1],
    'best_orbit+rand': [orbit_confs[best_orbit_idx]] + random_confs[:N_RANDOM-1],
}

print(f"\n{'='*70}")
print(f"ENSEMBLE RESULTS @ threshold={THRESHOLD}")
print(f"{'='*70}")
print(f"{'Strategy':<22}  {'Size':>5}  {'Prec%':>7}  {'Rec%':>7}  {'F1%':>7}")
print(f"{'-'*55}")

strategy_results = {}
for name, confs in strategies.items():
    prec, rec, f1, _ = ensemble_metrics(confs, y_val)
    strategy_results[name] = (prec, rec, f1)
    print(f"  {name:<20}  {len(confs):>5}  {prec*100:>7.2f}  {rec*100:>7.2f}  {f1*100:>7.2f}")

# ── PR curves ─────────────────────────────────────────────────────────────────
print(f"\n{'='*70}")
print(f"BEST F1 PER STRATEGY (over threshold sweep)")
print(f"{'='*70}")
print(f"{'Strategy':<22}  {'Best F1%':>9}  {'@ thr':>7}  {'Prec%':>7}  {'Rec%':>7}")
print(f"{'-'*60}")

for name, confs in strategies.items():
    curve = pr_curve(confs, y_val)
    best  = max(curve, key=lambda x: x[3])
    thr, prec, rec, f1 = best
    print(f"  {name:<20}  {f1*100:>9.2f}  {thr:>7.3f}  {prec*100:>7.2f}  {rec*100:>7.2f}")

# ── Verdict ───────────────────────────────────────────────────────────────────
print(f"\n{'='*70}")
print(f"VERDICT")
print(f"{'='*70}")
ar_f1  = strategy_results['all_random'][2]
m50_f1 = strategy_results['mixed_50_50'][2]
m1_f1  = strategy_results['mixed_1orbit'][2]

delta_50 = (m50_f1 - ar_f1) * 100
delta_1  = (m1_f1  - ar_f1) * 100

print(f"\n  mixed_50_50 vs all_random: {delta_50:+.2f}pp F1")
print(f"  mixed_1orbit vs all_random: {delta_1:+.2f}pp F1")

if delta_50 > 1.0:
    print("\n  ORBIT ADDS VALUE: 50/50 mixing beats all-random by >1pp. "
          "Orbit perm provides genuine complementary signal.")
elif delta_50 > 0:
    print("\n  ORBIT NEUTRAL: 50/50 mixing is marginally better but not significantly. "
          "Orbit perm doesn't hurt but doesn't clearly help.")
else:
    print("\n  ORBIT HURTS: 50/50 mixing underperforms all-random. "
          "Orbit perm introduces noise that degrades ensemble quality. "
          "The architecture should prefer pure random-perm ensembles.")

print(f"\nDone.")
