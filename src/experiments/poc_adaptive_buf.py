#!/usr/bin/env python3
"""
Adaptive Buffer Experiment — learnable BUF_DECAY and BUF_STRENGTH.

Hypothesis: the optimal decay and strength are data-dependent.
Let the gradient find them instead of sweeping by hand.

Fixed baseline:  BUF_DECAY=0.85  BUF_STRENGTH=1.4
Adaptive:        both are nn.Parameter, initialized at (0.85, 1.4),
                 constrained via sigmoid / softplus during forward pass.

Uses best config from buckets sweep:
  per_bin=2666, mag-weighted sampler, offset sweep [-1s, 0s, +0.5s]

Logs learned (decay, strength) per offset after training.
"""
import time, warnings
import numpy as np
import torch, torch.nn as nn, torch.optim as optim
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
warnings.filterwarnings('ignore')

# ── Constants ─────────────────────────────────────────────────────────────────
DEVICE       = 'cuda' if torch.cuda.is_available() else 'cpu'
K            = 128
CYCLES       = 3
WIN_SAMPLES  = 100
MAX_EVENTS   = 8000
PER_BIN      = 2666    # winner from buckets sweep
BATCH        = 64
EPOCHS       = 30
LR           = 1e-3
SIGMA        = 0.3
SEEDS        = 3
OFFSETS      = [-100, 0, 50]   # samples: -1s, 0s, +0.5s

# Fixed reference values
FIXED_DECAY    = 0.85
FIXED_STRENGTH = 1.4

ORBIT_BASE = [0, 1, 3, 7, 6, 4]   # 0-indexed orbit permutation

def make_orbit_perm(k):
    p = []
    while len(p) < k:
        p.extend(ORBIT_BASE)
    return torch.tensor(p[:k], dtype=torch.long)

# ── Dataset ───────────────────────────────────────────────────────────────────
class WaveformDataset(Dataset):
    def __init__(self, X, y):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.long)
    def __len__(self): return len(self.y)
    def __getitem__(self, i): return self.X[i], self.y[i]

# ── Data loader ───────────────────────────────────────────────────────────────
def load_data(offset_samples=0, per_bin=PER_BIN):
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

    t_ge5 = min(per_bin, len(b_ge5))
    t_3_5 = min(per_bin, len(b_3_5))
    t_lt3 = min(MAX_EVENTS - t_ge5 - t_3_5, len(b_lt3))
    print(f"    bins: M<3={t_lt3} M3-5={t_3_5} M5+={t_ge5}", flush=True)

    np.random.shuffle(b_lt3); np.random.shuffle(b_3_5); np.random.shuffle(b_ge5)
    eq_idx = np.concatenate([b_lt3[:t_lt3], b_3_5[:t_3_5], b_ge5[:t_ge5]])
    np.random.shuffle(eq_idx); np.random.shuffle(noise_pos)

    X_eq, mags_list = [], []
    for idx in eq_idx:
        try:
            m   = meta_df.iloc[int(idx)]
            wf  = eq.get_waveforms(int(idx))
            if wf is None or wf.shape[1] < 3000: continue
            p   = int(m.get('trace_p_arrival_sample', 0) or 0)
            st  = p + offset_samples
            if st < 0 or st + WIN_SAMPLES > wf.shape[1]: continue
            w   = wf[:, st:st+WIN_SAMPLES].astype(np.float32)
            if w.shape[1] < WIN_SAMPLES: continue
            std = w.std(axis=1, keepdims=True) + 1e-6
            X_eq.append(w / std)
            mags_list.append(float(m.get('source_magnitude', np.nan) or np.nan))
        except Exception: continue

    X_noise = []
    for idx in noise_pos[:MAX_EVENTS * 4]:
        if len(X_noise) >= MAX_EVENTS: break
        try:
            wf = eq.get_waveforms(int(idx))
            if wf is None or wf.shape[1] < 3000: continue
            st = np.random.randint(0, max(1, wf.shape[1]-WIN_SAMPLES))
            w  = wf[:, st:st+WIN_SAMPLES].astype(np.float32)
            if w.shape[1] < WIN_SAMPLES: continue
            std = w.std(axis=1, keepdims=True) + 1e-6
            X_noise.append(w / std)
        except Exception: continue

    n = min(len(X_eq), len(X_noise))
    mags_arr   = np.array(mags_list[:n])
    noise_mags = np.full(n, np.nan)
    X = np.concatenate([np.array(X_eq[:n]), np.array(X_noise[:n])], axis=0)
    y = np.array([1]*n + [0]*n)
    m = np.concatenate([mags_arr, noise_mags])
    perm = np.random.permutation(len(y))
    return X[perm], y[perm], m[perm]

def split_loaders(X, y, mags, val_frac=0.15):
    n = len(y); split = int(n*(1-val_frac))
    tr = WaveformDataset(X[:split], y[:split])
    va = WaveformDataset(X[split:], y[split:])
    tr_mags = mags[:split]; tr_y = y[:split]
    weights = np.ones(split, dtype=np.float32)
    for label, lo, hi in [(1,-np.inf,3.0),(1,3.0,5.0),(1,5.0,np.inf),(0,-np.inf,np.inf)]:
        mask = (tr_y==1)&(np.nan_to_num(tr_mags,nan=0.)>=lo)&(np.nan_to_num(tr_mags,nan=0.)<hi) \
               if label==1 else (tr_y==0)
        n_b = mask.sum()
        if n_b > 0: weights[mask] = 1.0/n_b
    sampler = WeightedRandomSampler(weights=weights, num_samples=split, replacement=True)
    return (DataLoader(tr, batch_size=BATCH, sampler=sampler, num_workers=0),
            DataLoader(va, batch_size=BATCH, shuffle=False, num_workers=0))

# ── Models ────────────────────────────────────────────────────────────────────
class ConvBlock(nn.Module):
    def __init__(self, ci, co, k=7):
        super().__init__()
        self.net = nn.Sequential(nn.Conv1d(ci,co,k,padding=k//2),nn.BatchNorm1d(co),nn.ReLU())
    def forward(self, x): return self.net(x)

class FixedTribarNet(nn.Module):
    """Reference: fixed BUF_DECAY=0.85, BUF_STRENGTH=1.4"""
    def __init__(self):
        super().__init__()
        self.enc = nn.Sequential(ConvBlock(3,32),ConvBlock(32,64),ConvBlock(64,K),nn.AdaptiveAvgPool1d(1))
        self.register_buffer('perm', make_orbit_perm(K))
        self.cls = nn.Linear(K, 2)
        self._buf = None
        self.decay    = FIXED_DECAY
        self.strength = FIXED_STRENGTH
    def forward(self, x, sigma=0.0):
        if sigma > 0: x = x + sigma * torch.randn_like(x)
        h = self.enc(x).squeeze(-1)
        buf = torch.zeros_like(h)
        for _ in range(CYCLES):
            h   = torch.relu(h[:, self.perm])
            buf = self.decay * buf + (1 - self.decay) * h.detach()
            h   = h + self.strength * buf
        return self.cls(h)

class AdaptiveTribarNet(nn.Module):
    """Learnable BUF_DECAY and BUF_STRENGTH, initialized at (0.85, 1.4)."""
    def __init__(self):
        super().__init__()
        self.enc = nn.Sequential(ConvBlock(3,32),ConvBlock(32,64),ConvBlock(64,K),nn.AdaptiveAvgPool1d(1))
        self.register_buffer('perm', make_orbit_perm(K))
        self.cls = nn.Linear(K, 2)
        # Parameterize in logit / log space so gradients are unconstrained.
        # decay ∈ (0,1) via sigmoid; strength ∈ (0,∞) via softplus.
        self._decay_logit    = nn.Parameter(torch.tensor(np.log(FIXED_DECAY / (1-FIXED_DECAY))))
        self._strength_log   = nn.Parameter(torch.tensor(np.log(np.expm1(FIXED_STRENGTH))))
    @property
    def decay(self):    return torch.sigmoid(self._decay_logit)
    @property
    def strength(self): return torch.nn.functional.softplus(self._strength_log)
    def forward(self, x, sigma=0.0):
        if sigma > 0: x = x + sigma * torch.randn_like(x)
        h = self.enc(x).squeeze(-1)
        buf = torch.zeros_like(h)
        d = self.decay; s = self.strength
        for _ in range(CYCLES):
            h   = torch.relu(h[:, self.perm])
            buf = d * buf + (1 - d) * h.detach()
            h   = h + s * buf
        return self.cls(h)
    def buf_params(self):
        return self.decay.item(), self.strength.item()

# ── Train / eval ──────────────────────────────────────────────────────────────
def train(model, tr_dl, dev):
    model.to(dev).train()
    opt = optim.Adam(model.parameters(), lr=LR)
    ce  = nn.CrossEntropyLoss()
    for _ in range(EPOCHS):
        for xb, yb in tr_dl:
            xb, yb = xb.to(dev), yb.to(dev)
            opt.zero_grad()
            ce(model(xb, sigma=SIGMA), yb).backward()
            opt.step()

def eval_prec(model, va_dl, dev):
    model.eval()
    tp = fp = 0
    with torch.no_grad():
        for xb, yb in va_dl:
            p = model(xb.to(dev)).argmax(1).cpu()
            tp += ((p==1)&(yb==1)).sum().item()
            fp += ((p==1)&(yb==0)).sum().item()
    return tp / (tp + fp + 1e-9)

def eval_mag_prec(model, X_val, y_val, mags_val, dev):
    ds = WaveformDataset(X_val, y_val)
    dl = DataLoader(ds, batch_size=BATCH, shuffle=False, num_workers=0)
    model.eval()
    preds = []
    with torch.no_grad():
        for xb, _ in dl: preds.append(model(xb.to(dev)).argmax(1).cpu())
    preds = torch.cat(preds).numpy()
    out = {}
    for lbl, lo, hi in [('M<3',-np.inf,3.0),('M3-5',3.0,5.0),('M5+',5.0,np.inf)]:
        mask = (y_val==1)&(np.nan_to_num(mags_val,nan=0.)>=lo)&(np.nan_to_num(mags_val,nan=0.)<hi)
        if mask.sum()==0: out[lbl]=float('nan'); continue
        tp     = ((preds==1) & mask).sum()
        fp_all = ((preds==1) & (y_val==0)).sum()
        out[lbl] = tp / (tp + fp_all + 1e-9)
    return out

# ── Main ──────────────────────────────────────────────────────────────────────
print(f"device={DEVICE}  K={K}  epochs={EPOCHS}  seeds={SEEDS}")
print(f"offsets={OFFSETS} samples  per_bin={PER_BIN}  mag-weighted")
print(f"init: decay={FIXED_DECAY}  strength={FIXED_STRENGTH}")
print()

t0 = time.time()
summary = []

for off in OFFSETS:
    off_s = off / 100.0
    print(f"\n{'='*65}")
    print(f"OFFSET {off:+d} samples ({off_s:+.2f}s)", flush=True)
    X, y, mags = load_data(offset_samples=off)
    split = int(len(y)*0.85)
    X_val, y_val, mags_val = X[split:], y[split:], mags[split:]
    tr_dl, va_dl = split_loaders(X, y, mags)

    fixed_precs, adapt_precs = [], []
    learned = []

    for seed in range(SEEDS):
        torch.manual_seed(seed); np.random.seed(seed)

        # Fixed reference
        m_fix = FixedTribarNet()
        train(m_fix, tr_dl, DEVICE)
        p_fix = eval_prec(m_fix, va_dl, DEVICE)
        fixed_precs.append(p_fix)

        # Adaptive
        m_adp = AdaptiveTribarNet()
        train(m_adp, tr_dl, DEVICE)
        p_adp = eval_prec(m_adp, va_dl, DEVICE)
        adapt_precs.append(p_adp)
        d, s = m_adp.buf_params()
        learned.append((d, s))
        print(f"  seed={seed}  fixed={p_fix*100:.1f}%  adapt={p_adp*100:.1f}%  "
              f"→ decay={d:.4f}  strength={s:.4f}", flush=True)

    # Mag breakdown from last adaptive model
    mag_b = eval_mag_prec(m_adp, X_val, y_val, mags_val, DEVICE)
    mean_d, mean_s = np.mean([l[0] for l in learned]), np.mean([l[1] for l in learned])

    summary.append({
        'offset': off, 'off_s': off_s,
        'fixed_avg': np.mean(fixed_precs),
        'adapt_avg': np.mean(adapt_precs),
        'delta': np.mean(adapt_precs) - np.mean(fixed_precs),
        'mean_decay': mean_d, 'mean_strength': mean_s,
        'mag': mag_b,
    })
    print(f"  mean learned: decay={mean_d:.4f}  strength={mean_s:.4f}", flush=True)
    print(f"  M<3={mag_b.get('M<3',float('nan'))*100:.1f}%  "
          f"M3-5={mag_b.get('M3-5',float('nan'))*100:.1f}%  "
          f"M5+={mag_b.get('M5+',float('nan'))*100:.1f}%", flush=True)

# ── Summary ───────────────────────────────────────────────────────────────────
elapsed = int(time.time() - t0)
print(f"\nTotal wall time: {elapsed}s  ({elapsed//60}m {elapsed%60}s)")
print(f"\n{'='*75}")
print(f"ADAPTIVE BUFFER SUMMARY")
print(f"{'='*75}")
print(f"{'offset':>10} {'fixed%':>8} {'adapt%':>8} {'Δ':>6} {'decay':>8} {'strength':>10}  mag M<3/M3-5/M5+")
print(f"{'-'*75}")
for r in summary:
    m = r['mag']
    lt3 = m.get('M<3', float('nan'))*100
    m35 = m.get('M3-5',float('nan'))*100
    ge5 = m.get('M5+', float('nan'))*100
    delta_sign = '+' if r['delta'] >= 0 else ''
    print(f"{r['off_s']:>+10.2f}s {r['fixed_avg']*100:>8.1f}% {r['adapt_avg']*100:>8.1f}% "
          f"{delta_sign}{r['delta']*100:>5.1f}% "
          f"{r['mean_decay']:>8.4f} {r['mean_strength']:>10.4f}  "
          f"{lt3:.1f}%/{m35:.1f}%/{ge5:.1f}%")

print()
print("Learned decay vs fixed 0.8500:", end='')
for r in summary:
    print(f"  [{r['off_s']:+.2f}s]→{r['mean_decay']:.4f}", end='')
print()
print("Learned strength vs fixed 1.4000:", end='')
for r in summary:
    print(f"  [{r['off_s']:+.2f}s]→{r['mean_strength']:.4f}", end='')
print()
