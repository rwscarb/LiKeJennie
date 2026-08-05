#!/usr/bin/env python3
"""
Early Detection Experiment.

Can the orbit buffer detect a P-wave before it arrives?

Standard training classifies at t=0s (P arrival).
Early training classifies at t=-0.5s (0.5s before P arrival).

Protocol:
  standard: warm [-1s] → classify at 0s   (TRAIN_N_STEPS=3, label at step 2)
  early:    warm [-1s] → classify at -0.5s (TRAIN_N_STEPS=2, label at step 1)

Eval strategies for each trained model:
  early-1:  classify at -0.5s (no warmup)
  early-2:  warm at -1s → classify at -0.5s
  standard: warm at -1s, -0.5s → classify at 0s
  all-3:    warm at -1s, -0.5s → classify at 0s (full stream-3)

The hypothesis: if the Hebbian buffer accumulates meaningful signal from the
-1s window (the pre-P waveform texture differs between eq and noise traces),
early training should learn to classify earlier with acceptable precision.

If precision at -0.5s is competitive with standard, we have a 0.5s earlier
warning — practically significant for seismic alerting systems.

Uses random fixed perm (stable) + champion config.
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

# Window offsets: -1s, -0.5s, 0s, +0.5s
STREAM_OFFSETS = [-100, -50, 0, 50]
IDX_NEG1  = 0   # t = -1s
IDX_HALF  = 1   # t = -0.5s (early classify target)
IDX_ZERO  = 2   # t = 0s    (standard classify target)

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
def train_standard(model, tr_dl, dev):
    """Warm [-1s,-0.5s] no_grad, classify at 0s."""
    model.to(dev).train()
    opt = optim.Adam(model.parameters(), lr=LR)
    ce  = nn.CrossEntropyLoss()
    for _ in range(EPOCHS):
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

def train_early(model, tr_dl, dev):
    """Warm [-1s] no_grad, classify at -0.5s."""
    model.to(dev).train()
    opt = optim.Adam(model.parameters(), lr=LR)
    ce  = nn.CrossEntropyLoss()
    for _ in range(EPOCHS):
        for xb, yb in tr_dl:
            xb, yb = xb.to(dev), yb.to(dev)
            model.reset_stream()
            opt.zero_grad()
            with torch.no_grad():
                model(xb[:, IDX_NEG1], sigma=SIGMA, streaming=True)   # -1s warmup
            logits = model(xb[:, IDX_HALF], sigma=SIGMA, streaming=True)  # -0.5s
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

def eval_model(model, X_val, y_val, mags_val, dev):
    """Evaluate all early and standard strategies."""
    model.eval()
    results = {}

    def stream_confs(n_steps):
        model.reset_stream()
        with torch.no_grad():
            for t in range(n_steps):
                Xt = torch.tensor(X_val[:, t], dtype=torch.float32).to(dev)
                logits = model(Xt, streaming=True)
        return F.softmax(logits, dim=1)[:, 1].cpu().numpy()

    def single_confs(idx):
        model.reset_stream()
        with torch.no_grad():
            Xt = torch.tensor(X_val[:, idx], dtype=torch.float32).to(dev)
            logits = model(Xt)
        return F.softmax(logits, dim=1)[:, 1].cpu().numpy()

    strategies = [
        ('early-single',  single_confs(IDX_HALF)),      # classify at -0.5s, no warmup
        ('early-2',       stream_confs(2)),               # -1s warmup → -0.5s classify
        ('standard-3',    stream_confs(3)),               # -1s,-0.5s warmup → 0s classify
        ('standard-4',    stream_confs(4)),               # all 4 windows
    ]
    for name, confs in strategies:
        p, r = pr_at_threshold(confs, y_val, THRESHOLD)
        mp = mag_pr(confs, y_val, mags_val, THRESHOLD)
        results[name] = {'prec': p, 'rec': r, 'mag': mp}
    return results

# ── Main ──────────────────────────────────────────────────────────────────────
print(f"device={DEVICE}  K={K}  EPOCHS={EPOCHS}  SEEDS={SEEDS}")
print(f"champion config: decay={BUF_DECAY}  strength={BUF_STRENGTH}  lr={LR}  threshold={THRESHOLD}")
print(f"perm: random fixed (stable baseline)")
print(f"training modes: standard (classify@0s) vs early (classify@-0.5s)")
print()

t0 = time.time()
print("Loading multi-offset dataset...")
X_multi, y, mags = load_streaming_data()
n = len(y); SPLIT = int(n*0.85)
X_val, y_val, mags_val = X_multi[SPLIT:], y[SPLIT:], mags[SPLIT:]
print(f"Dataset: {n} total  ({y.sum()} eq, {(y==0).sum()} noise)\n")

STRATS = ['early-single', 'early-2', 'standard-3', 'standard-4']
agg = {
    'standard': {s: {'precs': [], 'recs': [], 'mags': []} for s in STRATS},
    'early':    {s: {'precs': [], 'recs': [], 'mags': []} for s in STRATS},
}

for seed in range(SEEDS):
    torch.manual_seed(seed); np.random.seed(seed)
    print(f"{'─'*65}")
    print(f"SEED {seed}", flush=True)
    tr_dl, _, _ = make_loaders(X_multi, y, mags)

    # Standard training (classify at 0s)
    m_std = StreamingNet(perm_seed=seed)
    train_standard(m_std, tr_dl, DEVICE)
    res_std = eval_model(m_std, X_val, y_val, mags_val, DEVICE)
    print("  [standard-trained]", flush=True)
    for strat, r in res_std.items():
        agg['standard'][strat]['precs'].append(r['prec'])
        agg['standard'][strat]['recs'].append(r['rec'])
        agg['standard'][strat]['mags'].append(r['mag'])
        mp = r['mag']
        print(f"    {strat:<16} prec={r['prec']*100:.1f}%  rec={r['rec']*100:.1f}%  "
              f"M<3={mp.get('M<3',float('nan'))*100:.1f}%/{mp.get('M3-5',float('nan'))*100:.1f}%/"
              f"{mp.get('M5+',float('nan'))*100:.1f}%", flush=True)

    # Early training (classify at -0.5s)
    m_early = StreamingNet(perm_seed=seed)
    train_early(m_early, tr_dl, DEVICE)
    res_early = eval_model(m_early, X_val, y_val, mags_val, DEVICE)
    print("  [early-trained]", flush=True)
    for strat, r in res_early.items():
        agg['early'][strat]['precs'].append(r['prec'])
        agg['early'][strat]['recs'].append(r['rec'])
        agg['early'][strat]['mags'].append(r['mag'])
        mp = r['mag']
        print(f"    {strat:<16} prec={r['prec']*100:.1f}%  rec={r['rec']*100:.1f}%  "
              f"M<3={mp.get('M<3',float('nan'))*100:.1f}%/{mp.get('M3-5',float('nan'))*100:.1f}%/"
              f"{mp.get('M5+',float('nan'))*100:.1f}%", flush=True)

elapsed = int(time.time() - t0)
print(f"\nTotal wall time: {elapsed}s  ({elapsed//60}m {elapsed%60}s)")

# ── Summary ───────────────────────────────────────────────────────────────────
print(f"\n{'='*80}")
print(f"EARLY DETECTION SUMMARY  ({SEEDS} seeds, threshold={THRESHOLD})")
print(f"{'='*80}")
print(f"{'':30} {'prec%':>7} {'rec%':>7}  M<3/M3-5/M5+")
print(f"{'-'*80}")

base_prec = np.mean(agg['standard']['standard-3']['precs'])
for train_mode in ['standard', 'early']:
    label = 'STANDARD (classify@0s)' if train_mode == 'standard' else 'EARLY    (classify@-0.5s)'
    print(f"\n  {label}")
    for strat in STRATS:
        r = agg[train_mode][strat]
        p  = np.mean(r['precs']); re = np.mean(r['recs'])
        lt3 = np.nanmean([m.get('M<3', float('nan')) for m in r['mags']]) * 100
        m35 = np.nanmean([m.get('M3-5', float('nan')) for m in r['mags']]) * 100
        ge5 = np.nanmean([m.get('M5+', float('nan')) for m in r['mags']]) * 100
        delta = p - base_prec; sign = '+' if delta >= 0 else ''
        print(f"    {strat:<20} {p*100:>7.1f}%  {re*100:>6.1f}%  "
              f"{lt3:.1f}%/{m35:.1f}%/{ge5:.1f}%  {sign}{delta*100:.1f}%")

print()
print("Key question: early-trained early-2 vs standard-trained standard-3")
early_p  = np.mean(agg['early']['early-2']['precs'])
early_r  = np.mean(agg['early']['early-2']['recs'])
std_p    = np.mean(agg['standard']['standard-3']['precs'])
std_r    = np.mean(agg['standard']['standard-3']['recs'])
print(f"  early-trained  early-2:    {early_p*100:.1f}% prec  {early_r*100:.1f}% rec  (0.5s earlier)")
print(f"  standard       standard-3: {std_p*100:.1f}% prec  {std_r*100:.1f}% rec  (at P arrival)")
print(f"  precision cost of early detection: {(early_p-std_p)*100:+.1f}pp")
print(f"  recall cost of early detection:    {(early_r-std_r)*100:+.1f}pp")
