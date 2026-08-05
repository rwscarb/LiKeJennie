#!/usr/bin/env python3
"""
Production Random-Permutation Seismic P-Wave Detector.

Ablation results:
  Orbit perm [0,1,3,7,6,4]: mean 84.2% prec, HIGH variance (79.9%-88.1%)
  Random fixed perm:         mean 86.1% prec, STABLE    (85.6%-86.4%)  ← winner
  Identity perm:             85.0% prec

Architecture: StreamingTribarNet, Conv1d(3→32→64→K=128) + AdaptiveAvgPool1d
Buffer: CYCLES=3, exponential decay with permutation mixing
Perm: torch.randperm(K) called once in __init__, registered as buffer (fixed per seed)
Champion HPO config: BUF_DECAY=0.876, BUF_STRENGTH=1.429, LR=2.78e-3, THRESHOLD=0.480
Training: streaming-aware (warm up [-1s,-0.5s] with no_grad, classify at 0s)
Eval: stream-3 strategy at champion threshold 0.480
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
SEEDS        = 5

# Champion HPO config
LR           = 2.78e-3
BUF_DECAY    = 0.876
BUF_STRENGTH = 1.429
THRESHOLD    = 0.480

# Streaming windows: train on [-1s, -0.5s, 0s]; classify at 0s
STREAM_OFFSETS = [-100, -50, 0, 50]
TRAIN_N_STEPS  = 3


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


def make_loaders(X_multi, y, mags, val_frac=0.15):
    n = len(y); split = int(n*(1-val_frac))
    tr = MultiOffsetDataset(X_multi[:split], y[:split])
    va = MultiOffsetDataset(X_multi[split:], y[split:])
    tr_mags = mags[:split]; tr_y = y[:split]
    weights = np.ones(split, dtype=np.float32)
    for label, lo, hi in [(1,-np.inf,3.0),(1,3.0,5.0),(1,5.0,np.inf),(0,-np.inf,np.inf)]:
        mask = (tr_y==1)&(np.nan_to_num(tr_mags,nan=0.)>=lo)&(np.nan_to_num(tr_mags,nan=0.)<hi) \
               if label==1 else (tr_y==0)
        n_b = mask.sum()
        if n_b > 0: weights[mask] = 1.0/n_b
    sampler = WeightedRandomSampler(weights=weights, num_samples=split, replacement=True)
    return (DataLoader(tr, batch_size=BATCH, sampler=sampler, num_workers=0),
            DataLoader(va, batch_size=BATCH, shuffle=False, num_workers=0), split)


# ── Model ──────────────────────────────────────────────────────────────────────
class ConvBlock(nn.Module):
    def __init__(self, ci, co, k=7):
        super().__init__()
        self.net = nn.Sequential(nn.Conv1d(ci,co,k,padding=k//2), nn.BatchNorm1d(co), nn.ReLU())
    def forward(self, x): return self.net(x)


class RandomPermTribarNet(nn.Module):
    """StreamingTribarNet with a random fixed permutation instead of the orbit perm.

    The permutation is drawn once at init from the current RNG state (so it varies
    by seed) and stored as a non-trainable buffer — reproducible and seed-specific.
    """
    def __init__(self):
        super().__init__()
        self.enc = nn.Sequential(
            ConvBlock(3, 32), ConvBlock(32, 64), ConvBlock(64, K),
            nn.AdaptiveAvgPool1d(1)
        )
        # Random fixed perm seeded by caller's RNG state; registered as buffer so it
        # travels with state_dict and is device-aware.
        self.register_buffer('perm', torch.randperm(K))
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
def train_streaming(model, tr_dl, dev):
    """Stream-aware: warm-up buffer on [-1s,-0.5s] with no_grad; loss at 0s."""
    model.to(dev).train()
    opt = optim.Adam(model.parameters(), lr=LR)
    ce  = nn.CrossEntropyLoss()
    for ep in range(EPOCHS):
        for xb, yb in tr_dl:
            xb, yb = xb.to(dev), yb.to(dev)
            model.reset_stream()
            opt.zero_grad()
            with torch.no_grad():
                for t in range(TRAIN_N_STEPS - 1):
                    model(xb[:, t], sigma=SIGMA, streaming=True)
            logits = model(xb[:, TRAIN_N_STEPS-1], sigma=SIGMA, streaming=True)
            ce(logits, yb).backward()
            opt.step()


# ── Evaluation ─────────────────────────────────────────────────────────────────
def prec_recall(preds, y):
    tp = ((preds==1)&(y==1)).sum(); fp = ((preds==1)&(y==0)).sum()
    fn = ((preds==0)&(y==1)).sum()
    return float(tp/(tp+fp+1e-9)), float(tp/(tp+fn+1e-9))


def mag_prec(preds, y, mags):
    out = {}
    for lbl, lo, hi in [('M<3',-np.inf,3.0),('M3-5',3.0,5.0),('M5+',5.0,np.inf)]:
        mask = (y==1)&(np.nan_to_num(mags,nan=0.)>=lo)&(np.nan_to_num(mags,nan=0.)<hi)
        if mask.sum()==0: out[lbl]=float('nan'); continue
        tp = ((preds==1)&mask).sum(); fp = ((preds==1)&(y==0)).sum()
        out[lbl] = float(tp/(tp+fp+1e-9))
    return out


def eval_stream3_threshold(model, X_val, y_val, mags_val, dev, threshold=THRESHOLD):
    """Champion eval strategy: stream-3 with confidence threshold."""
    model.to(dev).eval()
    model.reset_stream()
    with torch.no_grad():
        for t in range(3):   # feed -1s, -0.5s, 0s
            Xt     = torch.tensor(X_val[:, t], dtype=torch.float32).to(dev)
            logits = model(Xt, streaming=True)
        conf  = F.softmax(logits, dim=1)[:, 1].cpu().numpy()
    preds = (conf >= threshold).astype(int)
    p, r  = prec_recall(preds, y_val)
    m     = mag_prec(preds, y_val, mags_val)
    return p, r, m, conf


# ── Main ───────────────────────────────────────────────────────────────────────
print(f"{'='*70}")
print(f"RANDOM-PERM PRODUCTION RUN")
print(f"{'='*70}")
print(f"device={DEVICE}  K={K}  CYCLES={CYCLES}  EPOCHS={EPOCHS}  SEEDS={SEEDS}")
print(f"BUF_DECAY={BUF_DECAY}  BUF_STRENGTH={BUF_STRENGTH}  LR={LR}  THRESHOLD={THRESHOLD}")
print(f"perm: torch.randperm({K}) seeded per model init (random fixed)")
print(f"train: stream-3 aware  eval: stream-3 @ threshold={THRESHOLD}")
print()

t0 = time.time()
print("Loading multi-offset dataset...", flush=True)
X_multi, y, mags = load_streaming_data()
n = len(y); SPLIT = int(n * 0.85)
X_val, y_val, mags_val = X_multi[SPLIT:], y[SPLIT:], mags[SPLIT:]
print(f"Dataset: {n} total  ({y.sum()} eq, {(y==0).sum()} noise)")
print(f"Val set: {len(y_val)} samples\n")

seed_precs, seed_recs = [], []

for seed in range(SEEDS):
    torch.manual_seed(seed)
    np.random.seed(seed)
    t_seed = time.time()
    print(f"{'─'*70}")
    print(f"SEED {seed}", flush=True)

    tr_dl, va_dl, _ = make_loaders(X_multi, y, mags)

    model = RandomPermTribarNet()
    # Log which permutation this seed got (first 8 elements for brevity)
    perm_preview = model.perm[:8].tolist()
    print(f"  perm[0:8]={perm_preview}", flush=True)

    train_streaming(model, tr_dl, DEVICE)

    p, r, m, conf = eval_stream3_threshold(model, X_val, y_val, mags_val, DEVICE)
    seed_precs.append(p); seed_recs.append(r)

    elapsed_seed = int(time.time() - t_seed)
    print(f"  stream-3 @ thr={THRESHOLD}  prec={p*100:.1f}%  rec={r*100:.1f}%  "
          f"M<3={m.get('M<3',float('nan'))*100:.1f}%/"
          f"M3-5={m.get('M3-5',float('nan'))*100:.1f}%/"
          f"M5+={m.get('M5+',float('nan'))*100:.1f}%  "
          f"({elapsed_seed}s)", flush=True)

total_elapsed = int(time.time() - t0)

# ── Summary ────────────────────────────────────────────────────────────────────
prec_arr = np.array(seed_precs); rec_arr = np.array(seed_recs)
p_mean, p_std = prec_arr.mean(), prec_arr.std()
r_mean, r_std = rec_arr.mean(), rec_arr.std()
p_min,  p_max = prec_arr.min(), prec_arr.max()

print(f"\n{'='*70}")
print(f"RANDOM-PERM PRODUCTION SUMMARY  ({SEEDS} seeds, stream-3 @ thr={THRESHOLD})")
print(f"{'='*70}")
print(f"{'Seed':<6} {'Prec%':>7} {'Rec%':>7}")
print(f"{'-'*25}")
for i, (p, r) in enumerate(zip(seed_precs, seed_recs)):
    print(f"{i:<6} {p*100:>7.1f} {r*100:>7.1f}")
print(f"{'-'*25}")
print(f"{'mean':<6} {p_mean*100:>7.1f} {r_mean*100:>7.1f}")
print(f"{'std':<6} {p_std*100:>7.2f} {r_std*100:>7.2f}")
print(f"{'range':<6} {p_min*100:.1f}%–{p_max*100:.1f}%")
print(f"\nTotal wall time: {total_elapsed}s  ({total_elapsed//60}m {total_elapsed%60}s)")
print()
print(f"Ablation context (from prior runs):")
print(f"  Orbit perm [0,1,3,7,6,4]: 84.2% ± 3.3%  (range 79.9%-88.1%)")
print(f"  Identity perm:             85.0%")
print(f"  Random fixed perm (this):  {p_mean*100:.1f}% ± {p_std*100:.2f}%  (range {p_min*100:.1f}%-{p_max*100:.1f}%)")
