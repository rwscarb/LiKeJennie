#!/usr/bin/env python3
"""
Orbit Permutation Ceiling Finder.

Runs 10 seeds with the champion HPO config using orbit perm [0,1,3,7,6,4].
Goal: find the ceiling of orbit-perm precision using stream-3 eval at
threshold=0.480 (softmax confidence, not argmax).

Champion config: BUF_DECAY=0.876, BUF_STRENGTH=1.429, LR=2.78e-3, THRESHOLD=0.480
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
SEEDS        = 10

# Champion HPO config
LR           = 2.78e-3
BUF_DECAY    = 0.876
BUF_STRENGTH = 1.429
THRESHOLD    = 0.480

# Streaming windows
STREAM_OFFSETS = [-100, -50, 0, 50]   # -1s, -0.5s, 0s, +0.5s
TRAIN_N_STEPS  = 3                     # feed -1s, -0.5s, 0s; classify at 0s

ORBIT_BASE = [0, 1, 3, 7, 6, 4]
def make_orbit_perm(k):
    p = []
    while len(p) < k: p.extend(ORBIT_BASE)
    return torch.tensor(p[:k], dtype=torch.long)

# ── Dataset ───────────────────────────────────────────────────────────────────
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

# ── Model ─────────────────────────────────────────────────────────────────────
class ConvBlock(nn.Module):
    def __init__(self, ci, co, k=7):
        super().__init__()
        self.net = nn.Sequential(nn.Conv1d(ci,co,k,padding=k//2),nn.BatchNorm1d(co),nn.ReLU())
    def forward(self, x): return self.net(x)

class StreamingTribarNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.enc = nn.Sequential(ConvBlock(3,32),ConvBlock(32,64),ConvBlock(64,K),nn.AdaptiveAvgPool1d(1))
        self.register_buffer('perm', make_orbit_perm(K))
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

# ── Training ──────────────────────────────────────────────────────────────────
def train_streaming(model, tr_dl, dev):
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

# ── Eval: stream-3 at threshold ───────────────────────────────────────────────
def prec_recall(preds, y):
    tp = ((preds==1)&(y==1)).sum(); fp = ((preds==1)&(y==0)).sum()
    fn = ((preds==0)&(y==1)).sum()
    return float(tp/(tp+fp+1e-9)), float(tp/(tp+fn+1e-9))

def eval_stream3_threshold(model, X_val, y_val, dev, threshold):
    model.to(dev).eval()
    model.reset_stream()
    with torch.no_grad():
        for t in range(3):
            Xt = torch.tensor(X_val[:, t], dtype=torch.float32).to(dev)
            logits = model(Xt, streaming=True)
    conf = F.softmax(logits, dim=1)[:, 1].cpu().numpy()
    preds = (conf >= threshold).astype(int)
    return prec_recall(preds, y_val), conf

# ── Main ──────────────────────────────────────────────────────────────────────
print(f"device={DEVICE}  K={K}  epochs={EPOCHS}  seeds={SEEDS}")
print(f"orbit_base={ORBIT_BASE}  repeated to K={K}")
print(f"champion config: LR={LR}  BUF_DECAY={BUF_DECAY}  BUF_STRENGTH={BUF_STRENGTH}  THRESHOLD={THRESHOLD}")
print()

t0 = time.time()
print("Loading multi-offset dataset...")
X_multi, y, mags = load_streaming_data()
n = len(y); SPLIT = int(n*0.85)
X_val, y_val = X_multi[SPLIT:], y[SPLIT:]
print(f"Dataset: {n} total  ({y.sum()} eq, {(y==0).sum()} noise)")
print(f"Val set: {len(y_val)} samples\n")

seed_results = []  # list of (seed, prec, rec)
best_prec = -1.0
best_seed = -1
best_model_state = None

for seed in range(SEEDS):
    torch.manual_seed(seed); np.random.seed(seed)
    print(f"{'─'*60}")
    print(f"SEED {seed}", flush=True)
    t_seed = time.time()

    tr_dl, va_dl, _ = make_loaders(X_multi, y, mags)
    model = StreamingTribarNet()
    train_streaming(model, tr_dl, DEVICE)

    (prec, rec), conf = eval_stream3_threshold(model, X_val, y_val, DEVICE, THRESHOLD)
    elapsed_s = int(time.time() - t_seed)
    print(f"  stream-3 @ thr={THRESHOLD}:  prec={prec*100:.2f}%  rec={rec*100:.2f}%  ({elapsed_s}s)", flush=True)

    seed_results.append((seed, prec, rec))

    if prec > best_prec:
        best_prec = prec
        best_seed = seed
        best_model_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
        print(f"  *** New best! seed={seed}  prec={prec*100:.2f}% ***", flush=True)

# Save best model
torch.save(best_model_state, 'orbit_best.pt')
print(f"\nBest model saved to orbit_best.pt  (seed={best_seed})", flush=True)

total_elapsed = int(time.time() - t0)
print(f"\nTotal wall time: {total_elapsed}s  ({total_elapsed//60}m {total_elapsed%60}s)")

# ── Summary ───────────────────────────────────────────────────────────────────
precs = [r[1] for r in seed_results]
recs  = [r[2] for r in seed_results]
mean_p = np.mean(precs); std_p = np.std(precs)
mean_r = np.mean(recs);  std_r = np.std(recs)

print(f"\n{'='*70}")
print(f"ORBIT PERM CEILING REPORT  ({SEEDS} seeds, stream-3 @ thr={THRESHOLD})")
print(f"Orbit base: {ORBIT_BASE}  (repeated to K={K})")
print(f"Champion config: LR={LR}  DECAY={BUF_DECAY}  STRENGTH={BUF_STRENGTH}")
print(f"{'='*70}")
print(f"\nPer-seed results:")
print(f"  {'Seed':>5}  {'Prec%':>8}  {'Rec%':>8}")
print(f"  {'-'*28}")
for seed, prec, rec in seed_results:
    marker = ' <-- BEST' if seed == best_seed else ''
    print(f"  {seed:>5}  {prec*100:>8.2f}%  {rec*100:>8.2f}%{marker}")

print(f"\nSummary:")
print(f"  Mean prec : {mean_p*100:.2f}%  ±{std_p*100:.2f}%")
print(f"  Mean rec  : {mean_r*100:.2f}%  ±{std_r*100:.2f}%")
print(f"  Best seed : {best_seed}  prec={best_prec*100:.2f}%  rec={recs[best_seed]*100:.2f}%")
print(f"  Worst prec: {min(precs)*100:.2f}%  (seed {precs.index(min(precs))})")
print(f"  Range     : {(max(precs)-min(precs))*100:.2f}pp spread across {SEEDS} seeds")

RANDOM_PERM_BASELINE = 86.1
print(f"\nVs random-perm baseline ({RANDOM_PERM_BASELINE}%):")
print(f"  Best orbit  : {best_prec*100:.2f}%  ({'+' if best_prec*100 > RANDOM_PERM_BASELINE else ''}{best_prec*100-RANDOM_PERM_BASELINE:.2f}pp)")
print(f"  Mean orbit  : {mean_p*100:.2f}%  ({'+' if mean_p*100 > RANDOM_PERM_BASELINE else ''}{mean_p*100-RANDOM_PERM_BASELINE:.2f}pp)")
print(f"{'='*70}")
