#!/usr/bin/env python3
"""
CYCLES Ablation Experiment.

Tests CYCLES ∈ {1,2,3,4,5,6} to find the optimal orbit buffer depth.

The orbit buffer runs for CYCLES iterations per forward pass:
    for _ in range(CYCLES):
        h   = relu(h[:, perm])
        buf = DECAY * buf + (1-DECAY) * h.detach()
        h   = h + STRENGTH * buf

We've always used CYCLES=3 (half-orbit of [0,1,3,7,6,4]), but this ablation
tests whether that's optimal vs. under/over-smoothing at other depths.

Champion config: BUF_DECAY=0.876, BUF_STRENGTH=1.429, LR=2.78e-3, THRESHOLD=0.480
Training: streaming-aware (warm at -1s,-0.5s no_grad, classify at 0s)
Eval: stream-3 at THRESHOLD=0.480
"""
import time, warnings
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F, torch.optim as optim
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
warnings.filterwarnings('ignore')

DEVICE        = 'cuda' if torch.cuda.is_available() else 'cpu'
K             = 128
CYCLES_LIST   = [1, 2, 3, 4, 5, 6]
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

STREAM_OFFSETS = [-100, -50, 0, 50]
IDX_NEG1  = 0   # t = -1s
IDX_HALF  = 1   # t = -0.5s
IDX_ZERO  = 2   # t = 0s

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
    """TribarNet with random fixed perm and configurable CYCLES."""
    def __init__(self, perm_seed=0, cycles=3):
        super().__init__()
        self.cycles = cycles
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
        for _ in range(self.cycles):
            h   = torch.relu(h[:, self.perm])
            buf = BUF_DECAY * buf + (1 - BUF_DECAY) * h.detach()
            h   = h + BUF_STRENGTH * buf
        if streaming: self._buf = buf.detach()
        return self.cls(h)

# ── Training ──────────────────────────────────────────────────────────────────
def train_streaming(model, tr_dl, dev):
    """Streaming-aware: warm [-1s,-0.5s] no_grad, classify at 0s."""
    model.to(dev).train()
    opt = optim.Adam(model.parameters(), lr=LR)
    ce  = nn.CrossEntropyLoss()
    for ep in range(EPOCHS):
        for xb, yb in tr_dl:
            xb, yb = xb.to(dev), yb.to(dev)
            model.reset_stream()
            opt.zero_grad()
            with torch.no_grad():
                model(xb[:, IDX_NEG1], sigma=SIGMA, streaming=True)   # -1s
                model(xb[:, IDX_HALF], sigma=SIGMA, streaming=True)   # -0.5s
            logits = model(xb[:, IDX_ZERO], sigma=SIGMA, streaming=True)  # 0s
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

def eval_stream3(model, X_val, y_val, mags_val, dev):
    """Eval stream-3: warm -1s,-0.5s → classify at 0s."""
    model.eval()
    model.reset_stream()
    with torch.no_grad():
        for t in [IDX_NEG1, IDX_HALF, IDX_ZERO]:
            Xt = torch.tensor(X_val[:, t], dtype=torch.float32).to(dev)
            logits = model(Xt, streaming=True)
    confs = F.softmax(logits, dim=1)[:, 1].cpu().numpy()
    p, r  = pr_at_threshold(confs, y_val, THRESHOLD)
    mp    = mag_pr(confs, y_val, mags_val, THRESHOLD)
    return p, r, mp

# ── Main ──────────────────────────────────────────────────────────────────────
print(f"device={DEVICE}  K={K}  EPOCHS={EPOCHS}  SEEDS={SEEDS}")
print(f"champion config: decay={BUF_DECAY}  strength={BUF_STRENGTH}  lr={LR}  threshold={THRESHOLD}")
print(f"CYCLES tested: {CYCLES_LIST}")
print(f"eval: stream-3 (warm -1s,-0.5s → classify at 0s)")
print()

t0 = time.time()
print("Loading multi-offset dataset...")
X_multi, y, mags = load_streaming_data()
n = len(y); SPLIT = int(n*0.85)
X_val, y_val, mags_val = X_multi[SPLIT:], y[SPLIT:], mags[SPLIT:]
print(f"Dataset: {n} total  ({y.sum()} eq, {(y==0).sum()} noise)\n")

# agg[cycles] = {'precs': [], 'recs': [], 'mags': []}
agg = {c: {'precs': [], 'recs': [], 'mags': []} for c in CYCLES_LIST}

for cycles in CYCLES_LIST:
    print(f"{'═'*65}")
    print(f"CYCLES={cycles}", flush=True)
    for seed in range(SEEDS):
        torch.manual_seed(seed); np.random.seed(seed)
        print(f"  seed={seed}", flush=True)
        tr_dl, _, _ = make_loaders(X_multi, y, mags)
        model = StreamingNet(perm_seed=seed, cycles=cycles)
        train_streaming(model, tr_dl, DEVICE)
        p, r, mp = eval_stream3(model, X_val, y_val, mags_val, DEVICE)
        agg[cycles]['precs'].append(p)
        agg[cycles]['recs'].append(r)
        agg[cycles]['mags'].append(mp)
        lt3 = mp.get('M<3', float('nan'))
        m35 = mp.get('M3-5', float('nan'))
        ge5 = mp.get('M5+', float('nan'))
        print(f"    prec={p*100:.1f}%  rec={r*100:.1f}%  "
              f"M<3={lt3*100 if not np.isnan(lt3) else float('nan'):.1f}%/"
              f"M3-5={m35*100 if not np.isnan(m35) else float('nan'):.1f}%/"
              f"M5+={ge5*100 if not np.isnan(ge5) else float('nan'):.1f}%", flush=True)

elapsed = int(time.time() - t0)
print(f"\nTotal wall time: {elapsed}s  ({elapsed//60}m {elapsed%60}s)")

# ── Summary ───────────────────────────────────────────────────────────────────
print(f"\n{'='*80}")
print(f"CYCLES ABLATION SUMMARY  ({SEEDS} seeds, threshold={THRESHOLD}, eval=stream-3)")
print(f"{'='*80}")
print(f"{'CYCLES':>8}  {'prec%':>12}  {'rec%':>12}  {'M<3%':>8}  {'M3-5%':>8}  {'M5+%':>8}")
print(f"{'-'*80}")

best_prec = -1.0; best_cycles = None
rows = []
for c in CYCLES_LIST:
    r      = agg[c]
    p_mean = np.mean(r['precs']); p_std = np.std(r['precs'])
    r_mean = np.mean(r['recs']);  r_std = np.std(r['recs'])
    lt3    = np.nanmean([m.get('M<3',  float('nan')) for m in r['mags']]) * 100
    m35    = np.nanmean([m.get('M3-5', float('nan')) for m in r['mags']]) * 100
    ge5    = np.nanmean([m.get('M5+',  float('nan')) for m in r['mags']]) * 100
    rows.append((c, p_mean, p_std, r_mean, r_std, lt3, m35, ge5))
    if p_mean > best_prec:
        best_prec = p_mean; best_cycles = c

for c, pm, ps, rm, rs, lt3, m35, ge5 in rows:
    marker = " ◀ BEST" if c == best_cycles else ""
    print(f"  {c:>6}    {pm*100:>5.1f}±{ps*100:.1f}%    {rm*100:>5.1f}±{rs*100:.1f}%    "
          f"{lt3:>6.1f}%  {m35:>7.1f}%  {ge5:>6.1f}%{marker}")

print(f"\nBest CYCLES by mean precision: CYCLES={best_cycles}  ({best_prec*100:.1f}%)")
if best_cycles == 3:
    print("CYCLES=3 (half-orbit hypothesis) confirmed as optimal.")
else:
    print(f"CYCLES={best_cycles} outperforms CYCLES=3 "
          f"(delta={( best_prec - np.mean(agg[3]['precs']) )*100:+.1f}pp precision).")
print()
