#!/usr/bin/env python3
"""
Horizon Sweep Experiment.

How early can the orbit buffer fire with useful precision?

Four models trained at four detection horizons:
  horizon-0: classify at index 0 (t=-1s),   no warmup
  horizon-1: classify at index 1 (t=-0.5s), 1 warmup step at index 0
  horizon-2: classify at index 2 (t=0s),    2 warmup steps at indices 0,1
  horizon-3: classify at index 3 (t=+0.5s), 3 warmup steps at indices 0,1,2

Eval is matched to training: horizon-N model evaluated with N warmup steps,
classifying at its trained index.

Uses random fixed perm + champion config (BUF_DECAY=0.876, BUF_STRENGTH=1.429,
LR=2.78e-3, THRESHOLD=0.480, K=128, CYCLES=3).
"""
import time, warnings
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F, torch.optim as optim
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
warnings.filterwarnings('ignore')

DEVICE        = 'cuda' if torch.cuda.is_available() else 'cpu'
K             = 128
CYCLES        = 3
WIN_SAMPLES   = 100
MAX_EVENTS    = 8000
PER_BIN       = 2666
BATCH         = 64
EPOCHS        = 30
SEEDS         = 3
SIGMA         = 0.3

BUF_DECAY    = 0.876
BUF_STRENGTH = 1.429
LR           = 2.78e-3
THRESHOLD    = 0.480

# Window offsets: -1s, -0.5s, 0s, +0.5s at 100Hz
STREAM_OFFSETS = [-100, -50, 0, 50]
N_HORIZONS     = 4

# Horizon labels for printing
HORIZON_LABELS = ['t=-1.0s (index 0)', 't=-0.5s (index 1)', 't=0.0s  (index 2)', 't=+0.5s (index 3)']

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

class StreamingNet(nn.Module):
    """TribarNet with random fixed perm for stability."""
    def __init__(self, perm_seed=0):
        super().__init__()
        self.enc = nn.Sequential(ConvBlock(3,32),ConvBlock(32,64),ConvBlock(64,K),nn.AdaptiveAvgPool1d(1))
        rng = np.random.RandomState(perm_seed)
        perm = torch.tensor(rng.permutation(K), dtype=torch.long)
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

# ── Training ──────────────────────────────────────────────────────────────────
def train_horizon(model, tr_dl, dev, horizon_idx):
    """
    Train to classify at stream index `horizon_idx`.
    Steps 0..(horizon_idx-1) are warmup (no_grad).
    Step horizon_idx is the classification step (with grad).
    """
    model.to(dev).train()
    opt = optim.Adam(model.parameters(), lr=LR)
    ce  = nn.CrossEntropyLoss()
    for _ in range(EPOCHS):
        for xb, yb in tr_dl:
            xb, yb = xb.to(dev), yb.to(dev)
            model.reset_stream()
            opt.zero_grad()
            # Warmup steps (no grad)
            if horizon_idx > 0:
                with torch.no_grad():
                    for wi in range(horizon_idx):
                        model(xb[:, wi], sigma=SIGMA, streaming=True)
            # Classify step (with grad)
            logits = model(xb[:, horizon_idx], sigma=SIGMA, streaming=True)
            ce(logits, yb).backward()
            opt.step()

# ── Eval ──────────────────────────────────────────────────────────────────────
def pr_at_threshold(confs, y, thresh):
    preds = (confs >= thresh).astype(int)
    tp = ((preds==1)&(y==1)).sum(); fp = ((preds==1)&(y==0)).sum()
    fn = ((preds==0)&(y==1)).sum()
    return float(tp/(tp+fp+1e-9)), float(tp/(tp+fn+1e-9))

def mag_pr(confs, y, mags, thresh):
    preds = (confs >= thresh).astype(int)
    out = {}
    for lbl, lo, hi in [('M<3',-np.inf,3.0),('M3-5',3.0,5.0),('M5+',5.0,np.inf)]:
        mask = (y==1)&(np.nan_to_num(mags,nan=0.)>=lo)&(np.nan_to_num(mags,nan=0.)<hi)
        if mask.sum()==0: out[lbl]=float('nan'); continue
        tp = ((preds==1)&mask).sum(); fp = ((preds==1)&(y==0)).sum()
        out[lbl] = float(tp/(tp+fp+1e-9))
    return out

def eval_at_horizon(model, X_val, y_val, mags_val, dev, horizon_idx):
    """Evaluate model at its trained horizon (matched eval)."""
    model.eval()
    model.reset_stream()
    with torch.no_grad():
        # Warmup steps
        if horizon_idx > 0:
            for wi in range(horizon_idx):
                Xt = torch.tensor(X_val[:, wi], dtype=torch.float32).to(dev)
                model(Xt, streaming=True)
        # Classify step
        Xt = torch.tensor(X_val[:, horizon_idx], dtype=torch.float32).to(dev)
        logits = model(Xt, streaming=True)
    confs = F.softmax(logits, dim=1)[:, 1].cpu().numpy()
    p, r = pr_at_threshold(confs, y_val, THRESHOLD)
    mp = mag_pr(confs, y_val, mags_val, THRESHOLD)
    return {'prec': p, 'rec': r, 'mag': mp}

# ── Main ──────────────────────────────────────────────────────────────────────
print(f"device={DEVICE}  K={K}  EPOCHS={EPOCHS}  SEEDS={SEEDS}")
print(f"champion config: decay={BUF_DECAY}  strength={BUF_STRENGTH}  lr={LR}  threshold={THRESHOLD}")
print(f"perm: random fixed (seeded per model seed)")
print(f"horizons: {N_HORIZONS} (index 0..3 → t=-1s, -0.5s, 0s, +0.5s)")
print(f"eval: matched to training horizon")
print()

t0 = time.time()
print("Loading multi-offset dataset...")
X_multi, y, mags = load_streaming_data()
n = len(y); SPLIT = int(n*0.85)
X_val, y_val, mags_val = X_multi[SPLIT:], y[SPLIT:], mags[SPLIT:]
print(f"Dataset: {n} total  ({y.sum()} eq, {(y==0).sum()} noise)")
print(f"Val set: {len(y_val)} ({y_val.sum()} eq, {(y_val==0).sum()} noise)\n")

# agg[horizon_idx] = {'precs': [], 'recs': [], 'mags': []}
agg = {h: {'precs': [], 'recs': [], 'mags': []} for h in range(N_HORIZONS)}

for seed in range(SEEDS):
    torch.manual_seed(seed); np.random.seed(seed)
    print(f"{'─'*70}")
    print(f"SEED {seed}", flush=True)
    tr_dl, _, _ = make_loaders(X_multi, y, mags)

    for h in range(N_HORIZONS):
        n_warmup = h
        label = HORIZON_LABELS[h]
        print(f"  [horizon-{h}: {label}, warmup={n_warmup}]", flush=True)
        model = StreamingNet(perm_seed=seed)
        train_horizon(model, tr_dl, DEVICE, h)
        res = eval_at_horizon(model, X_val, y_val, mags_val, DEVICE, h)
        agg[h]['precs'].append(res['prec'])
        agg[h]['recs'].append(res['rec'])
        agg[h]['mags'].append(res['mag'])
        mp = res['mag']
        print(f"    prec={res['prec']*100:.1f}%  rec={res['rec']*100:.1f}%  "
              f"M<3={mp.get('M<3',float('nan'))*100:.1f}%/"
              f"M3-5={mp.get('M3-5',float('nan'))*100:.1f}%/"
              f"M5+={mp.get('M5+',float('nan'))*100:.1f}%", flush=True)
    print()

elapsed = int(time.time() - t0)
print(f"Total wall time: {elapsed}s  ({elapsed//60}m {elapsed%60}s)")

# ── Summary ───────────────────────────────────────────────────────────────────
print(f"\n{'='*80}")
print(f"HORIZON SWEEP SUMMARY  ({SEEDS} seeds, threshold={THRESHOLD})")
print(f"{'='*80}")
print(f"{'Horizon':<12} {'Time offset':<14} {'Warmup':>7} {'Prec%':>7} {'Rec%':>7}  M<3/M3-5/M5+")
print(f"{'-'*80}")

precs_by_horizon = []
for h in range(N_HORIZONS):
    r      = agg[h]
    p      = np.mean(r['precs'])
    re     = np.mean(r['recs'])
    lt3    = np.nanmean([m.get('M<3',  float('nan')) for m in r['mags']]) * 100
    m35    = np.nanmean([m.get('M3-5', float('nan')) for m in r['mags']]) * 100
    ge5    = np.nanmean([m.get('M5+',  float('nan')) for m in r['mags']]) * 100
    t_off  = [-1.0, -0.5, 0.0, +0.5][h]
    precs_by_horizon.append(p)
    print(f"horizon-{h}    {t_off:>+.1f}s           {h:>7}  {p*100:>6.1f}%  {re*100:>6.1f}%  "
          f"{lt3:.1f}%/{m35:.1f}%/{ge5:.1f}%")

# Baseline is horizon-2 (standard, t=0s)
base_p = precs_by_horizon[2]
print(f"\n{'─'*80}")
print(f"Precision delta vs horizon-2 (t=0s baseline):")
for h in range(N_HORIZONS):
    delta = precs_by_horizon[h] - base_p
    t_off = [-1.0, -0.5, 0.0, +0.5][h]
    sign  = '+' if delta >= 0 else ''
    print(f"  horizon-{h} ({t_off:>+.1f}s): {sign}{delta*100:.1f}pp")

# Linear trend across time offsets
offsets_s = np.array([-1.0, -0.5, 0.0, 0.5])
precs_arr = np.array(precs_by_horizon) * 100
try:
    slope, intercept = np.polyfit(offsets_s, precs_arr, 1)
    print(f"\nLinear fit (prec% vs time offset):")
    print(f"  slope={slope:.2f} pp/s  (each 0.5s earlier costs ~{abs(slope*0.5):.1f}pp precision)")
    print(f"  intercept at t=0: {intercept:.1f}%  (expected prec at P arrival)")
except Exception as e:
    print(f"\nLinear fit failed: {e}")

print(f"\nKey result:")
h0_p = precs_by_horizon[0]; h0_r = np.mean(agg[0]['recs'])
h2_p = precs_by_horizon[2]; h2_r = np.mean(agg[2]['recs'])
print(f"  horizon-0 (t=-1.0s, before P):  {h0_p*100:.1f}% prec  {h0_r*100:.1f}% rec")
print(f"  horizon-2 (t= 0.0s, at P):      {h2_p*100:.1f}% prec  {h2_r*100:.1f}% rec")
print(f"  cost of 1s earlier detection:   {(h0_p-h2_p)*100:+.1f}pp prec  {(h0_r-h2_r)*100:+.1f}pp rec")
print()
