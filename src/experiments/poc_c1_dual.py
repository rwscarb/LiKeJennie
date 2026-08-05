#!/usr/bin/env python3
"""
CYCLES=1 + Dual-Horizon And-Gate.

Combining two findings:
  1. CYCLES=1 outperforms CYCLES=3 by 3.9pp (85.0% vs 81.1%)
  2. Dual-horizon and-gate hits 89.8% with CYCLES=3

Hypothesis: CYCLES=1 + and-gate should deliver higher stable precision
than either finding alone, because:
  - CYCLES=1 reduces over-smoothing → cleaner features at the classifier
  - And-gate requires consensus between -0.5s and 0s → precision gate

champion config: BUF_DECAY=0.876, BUF_STRENGTH=1.429, LR=2.78e-3, threshold=0.48
training: warm at -1s (no_grad) → loss = 0.5*CE(early@-0.5s) + 0.5*CE(late@0s)
eval: all 5 dual-horizon strategies at threshold=0.48
seeds: 5 (for stable mean estimate)
"""
import time, warnings
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F, torch.optim as optim
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
warnings.filterwarnings('ignore')

DEVICE       = 'cuda' if torch.cuda.is_available() else 'cpu'
K            = 128
CYCLES       = 1          # ← key change from prior experiments
WIN_SAMPLES  = 100
MAX_EVENTS   = 8000
PER_BIN      = 2666
BATCH        = 64
EPOCHS       = 30
SEEDS        = 5
SIGMA        = 0.3

BUF_DECAY    = 0.876
BUF_STRENGTH = 1.429
LR           = 2.78e-3
THRESHOLD    = 0.480

STREAM_OFFSETS = [-100, -50, 0, 50]
IDX_NEG1 = 0; IDX_HALF = 1; IDX_ZERO = 2

# ── Dataset ───────────────────────────────────────────────────────────────────
class MultiOffsetDataset(Dataset):
    def __init__(self, X, y):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.long)
    def __len__(self): return len(self.y)
    def __getitem__(self, i): return self.X[i], self.y[i]

def load_data():
    import seisbench.data as sbd
    eq = sbd.STEAD(download_kwargs={"chunk": "chunk2"}, cache=None)
    meta_df = eq.metadata
    cat_vals = meta_df['trace_category'].fillna('').str.lower().values
    mag_vals = meta_df['source_magnitude'].values.astype(float)
    all_pos  = np.arange(len(meta_df))
    eq_mask  = np.array(['earthquake' in c for c in cat_vals])
    eq_pos   = all_pos[eq_mask]; eq_mags = mag_vals[eq_mask]
    noise_pos= all_pos[np.array(['noise' in c for c in cat_vals])]
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

    def load_multi(idx, p):
        wf = eq.get_waveforms(int(idx))
        if wf is None or wf.shape[1] < 3000: return None
        wins = []
        for off in STREAM_OFFSETS:
            st = p + off
            if st < 0 or st + WIN_SAMPLES > wf.shape[1]: return None
            w = wf[:, st:st+WIN_SAMPLES].astype(np.float32)
            if w.shape[1] < WIN_SAMPLES: return None
            std = w.std(axis=1, keepdims=True) + 1e-6
            wins.append(w / std)
        return np.stack(wins, axis=0)

    print("  loading earthquakes...", flush=True)
    X_eq, mags = [], []
    for i, idx in enumerate(eq_idx):
        if i % 1000 == 0: print(f"    eq {i}/{len(eq_idx)} ok={len(X_eq)}", flush=True)
        try:
            m = meta_df.iloc[int(idx)]
            p = int(m.get('trace_p_arrival_sample', 0) or 0)
            w = load_multi(idx, p)
            if w is not None:
                X_eq.append(w)
                mags.append(float(m.get('source_magnitude', np.nan) or np.nan))
        except Exception: continue

    print("  loading noise...", flush=True)
    X_noise = []
    for idx in noise_pos[:MAX_EVENTS * 4]:
        if len(X_noise) >= MAX_EVENTS: break
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
            if ok: X_noise.append(np.stack(wins, axis=0))
        except Exception: continue

    n = min(len(X_eq), len(X_noise))
    print(f"  kept: {n} eq, {n} noise", flush=True)
    X = np.concatenate([np.array(X_eq[:n]), np.array(X_noise[:n])], axis=0)
    y = np.array([1]*n + [0]*n)
    mg = np.concatenate([np.array(mags[:n]), np.full(n, np.nan)])
    p  = np.random.permutation(len(y))
    return X[p], y[p], mg[p]

def make_loaders(X, y, mags, val_frac=0.15):
    n = len(y); split = int(n*(1-val_frac))
    tr = MultiOffsetDataset(X[:split], y[:split])
    tr_mags = mags[:split]; tr_y = y[:split]
    weights = np.ones(split, dtype=np.float32)
    for label, lo, hi in [(1,-np.inf,3.0),(1,3.0,5.0),(1,5.0,np.inf),(0,-np.inf,np.inf)]:
        mask = (tr_y==1)&(np.nan_to_num(tr_mags,nan=0.)>=lo)&(np.nan_to_num(tr_mags,nan=0.)<hi) \
               if label==1 else (tr_y==0)
        if mask.sum() > 0: weights[mask] = 1.0/mask.sum()
    sampler = WeightedRandomSampler(weights=weights, num_samples=split, replacement=True)
    return (DataLoader(tr, batch_size=BATCH, sampler=sampler, num_workers=0),
            split)

# ── Model ─────────────────────────────────────────────────────────────────────
class ConvBlock(nn.Module):
    def __init__(self, ci, co, k=7):
        super().__init__()
        self.net = nn.Sequential(nn.Conv1d(ci,co,k,padding=k//2),nn.BatchNorm1d(co),nn.ReLU())
    def forward(self, x): return self.net(x)

class C1DualNet(nn.Module):
    """CYCLES=1 dual-horizon network."""
    def __init__(self, perm_seed=0):
        super().__init__()
        self.enc = nn.Sequential(ConvBlock(3,32),ConvBlock(32,64),ConvBlock(64,K),nn.AdaptiveAvgPool1d(1))
        rng = np.random.RandomState(perm_seed)
        self.register_buffer('perm', torch.tensor(rng.permutation(K), dtype=torch.long))
        self.cls_early = nn.Linear(K, 2)
        self.cls_late  = nn.Linear(K, 2)
        self._buf = None

    def reset_stream(self): self._buf = None

    def _step(self, x, sigma=0.0, streaming=False):
        if sigma > 0: x = x + sigma * torch.randn_like(x)
        h   = self.enc(x).squeeze(-1)
        buf = self._buf if (streaming and self._buf is not None) else torch.zeros_like(h)
        for _ in range(CYCLES):
            h   = torch.relu(h[:, self.perm])
            buf = BUF_DECAY * buf + (1 - BUF_DECAY) * h.detach()
            h   = h + BUF_STRENGTH * buf
        if streaming: self._buf = buf.detach()
        return h  # return features, not logits

    def forward_early(self, x, sigma=0.0, streaming=False):
        return self.cls_early(self._step(x, sigma, streaming))

    def forward_late(self, x, sigma=0.0, streaming=False):
        return self.cls_late(self._step(x, sigma, streaming))

# ── Training ──────────────────────────────────────────────────────────────────
def train(model, tr_dl, dev):
    model.to(dev).train()
    opt = optim.Adam(model.parameters(), lr=LR)
    ce  = nn.CrossEntropyLoss()
    for _ in range(EPOCHS):
        for xb, yb in tr_dl:
            xb, yb = xb.to(dev), yb.to(dev)
            model.reset_stream()
            opt.zero_grad()
            with torch.no_grad():
                model._step(xb[:, IDX_NEG1], sigma=SIGMA, streaming=True)  # -1s warmup
            logits_e = model.forward_early(xb[:, IDX_HALF], sigma=SIGMA, streaming=True)  # -0.5s
            logits_l = model.forward_late( xb[:, IDX_ZERO], sigma=SIGMA, streaming=True)  # 0s
            loss = 0.5 * ce(logits_e, yb) + 0.5 * ce(logits_l, yb)
            loss.backward()
            opt.step()

# ── Eval ──────────────────────────────────────────────────────────────────────
def pr(confs, y, thresh):
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

def eval_model(model, X_val, y_val, mags_val, dev):
    model.eval()
    model.reset_stream()
    with torch.no_grad():
        model._step(torch.tensor(X_val[:, IDX_NEG1], dtype=torch.float32).to(dev), streaming=True)
        e_logits = model.forward_early(torch.tensor(X_val[:, IDX_HALF], dtype=torch.float32).to(dev), streaming=True)
        l_logits = model.forward_late( torch.tensor(X_val[:, IDX_ZERO], dtype=torch.float32).to(dev), streaming=True)
    e_conf = F.softmax(e_logits, dim=1)[:, 1].cpu().numpy()
    l_conf = F.softmax(l_logits, dim=1)[:, 1].cpu().numpy()
    results = {}
    for name, confs in [
        ('early-only', e_conf),
        ('late-only',  l_conf),
        ('max-conf',   np.maximum(e_conf, l_conf)),
        ('and-gate',   np.minimum(e_conf, l_conf)),   # both high = AND
        ('weighted',   0.4*e_conf + 0.6*l_conf),
    ]:
        p, r = pr(confs, y_val, THRESHOLD)
        mp   = mag_pr(confs, y_val, mags_val, THRESHOLD)
        results[name] = {'prec': p, 'rec': r, 'mag': mp}
    return results

# ── Main ──────────────────────────────────────────────────────────────────────
print(f"device={DEVICE}  K={K}  CYCLES={CYCLES}  EPOCHS={EPOCHS}  SEEDS={SEEDS}")
print(f"champion config: decay={BUF_DECAY}  strength={BUF_STRENGTH}  lr={LR}  threshold={THRESHOLD}")
print(f"architecture: C1DualNet (CYCLES=1, dual heads early@-0.5s + late@0s)")
print(f"training: warm -1s → loss=0.5*CE(early)+0.5*CE(late)")
print()

t0 = time.time()
print("Loading dataset...")
X, y, mags = load_data()
n = len(y); SPLIT = int(n*0.85)
X_val, y_val, mags_val = X[SPLIT:], y[SPLIT:], mags[SPLIT:]
print(f"Dataset: {n} total  ({y.sum()} eq, {(y==0).sum()} noise)\n")

STRATS = ['early-only', 'late-only', 'max-conf', 'and-gate', 'weighted']
agg = {s: {'precs': [], 'recs': [], 'mags': []} for s in STRATS}

for seed in range(SEEDS):
    torch.manual_seed(seed); np.random.seed(seed)
    print(f"{'─'*60}")
    print(f"SEED {seed}", flush=True)
    tr_dl, _ = make_loaders(X, y, mags)
    model = C1DualNet(perm_seed=seed)
    train(model, tr_dl, DEVICE)
    results = eval_model(model, X_val, y_val, mags_val, DEVICE)
    for strat, r in results.items():
        agg[strat]['precs'].append(r['prec'])
        agg[strat]['recs'].append(r['rec'])
        agg[strat]['mags'].append(r['mag'])
        mp = r['mag']
        print(f"  {strat:<14} prec={r['prec']*100:.1f}%  rec={r['rec']*100:.1f}%  "
              f"M<3={mp.get('M<3',float('nan'))*100:.1f}%/"
              f"{mp.get('M3-5',float('nan'))*100:.1f}%/"
              f"{mp.get('M5+',float('nan'))*100:.1f}%", flush=True)

elapsed = int(time.time() - t0)
print(f"\nTotal wall time: {elapsed}s  ({elapsed//60}m {elapsed%60}s)")

print(f"\n{'='*70}")
print(f"C1-DUAL SUMMARY  ({SEEDS} seeds, CYCLES=1, threshold={THRESHOLD})")
print(f"{'='*70}")
print(f"{'strategy':<16} {'prec%':>7} {'rec%':>7}  {'std':>6}  M<3/M3-5/M5+")
print(f"{'-'*70}")
for strat in STRATS:
    r = agg[strat]
    p  = np.mean(r['precs']); re = np.mean(r['recs']); sd = np.std(r['precs'])
    lt3 = np.nanmean([m.get('M<3', float('nan')) for m in r['mags']]) * 100
    m35 = np.nanmean([m.get('M3-5', float('nan')) for m in r['mags']]) * 100
    ge5 = np.nanmean([m.get('M5+', float('nan')) for m in r['mags']]) * 100
    print(f"  {strat:<14} {p*100:>7.1f}%  {re*100:>6.1f}%  {sd*100:>6.2f}%  "
          f"{lt3:.1f}%/{m35:.1f}%/{ge5:.1f}%")

print()
print("Baselines:")
print("  CYCLES=3 and-gate (dual-horizon):  89.8% / 97.5%")
print("  CYCLES=3 standard-3 (single head): 87.7% / 96.1%")
print("  CYCLES=1 stream-3  (single head):  85.0% / 96.9%")
print()
and_p = np.mean(agg['and-gate']['precs'])
and_r = np.mean(agg['and-gate']['recs'])
print(f"  C1-dual and-gate (this run):       {and_p*100:.1f}% / {and_r*100:.1f}%")
print(f"  vs CYCLES=3 and-gate:              {(and_p-0.898)*100:+.1f}pp prec  {(and_r-0.975)*100:+.1f}pp rec")
