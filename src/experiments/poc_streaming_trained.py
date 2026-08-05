#!/usr/bin/env python3
"""
Streaming-Aware Training Experiment.

The streaming inference run showed: precision drops when feeding pre-P windows
at inference time because the model was trained on 0s only.
Pre-P activations poison the buffer with noise patterns.

Fix: train with streaming sequences. For each batch, feed [-1s, -0.5s, 0s]
sequentially with streaming=True; compute loss at the 0s output only.
The encoder learns that pre-P buffer state ≠ noise, 0s buffer state = signal.

Gradient flows through the 0s forward pass only (pre-P steps use h.detach()
inside the buffer update — same as the original design). The model learns
what the buffer should look like by 0s given sequential context.

Compare:
  baseline-single  : trained on 0s only,  infer single-0s  (from previous run)
  baseline-stream  : trained on 0s only,  infer stream-3   (from previous run)
  stream-trained-s : trained on streams,  infer single-0s  (sanity check)
  stream-trained-3 : trained on streams,  infer stream-3   (target)
  stream-trained-mx: trained on streams,  infer stream-max (target)

Expected: stream-trained-3 and stream-trained-mx should recover/exceed
baseline-single precision while keeping higher recall.
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
LR           = 1e-3
SIGMA        = 0.3
SEEDS        = 3
BUF_DECAY    = 0.83
BUF_STRENGTH = 1.4

# Streaming windows. Train sequence uses first TRAIN_N_STEPS; label at step TRAIN_N_STEPS-1.
STREAM_OFFSETS  = [-100, -50, 0, 50]   # -1s, -0.5s, 0s, +0.5s
TRAIN_N_STEPS   = 3                     # feed -1s, -0.5s, 0s; classify at 0s

ORBIT_BASE = [0, 1, 3, 7, 6, 4]
def make_orbit_perm(k):
    p = []
    while len(p) < k: p.extend(ORBIT_BASE)
    return torch.tensor(p[:k], dtype=torch.long)

# ── Multi-offset dataset ──────────────────────────────────────────────────────
class MultiOffsetDataset(Dataset):
    """Returns (X_multi, y) where X_multi is (n_offsets, 3, WIN_SAMPLES)."""
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

# ── Training modes ────────────────────────────────────────────────────────────
def train_single(model, tr_dl, dev):
    """Original: train on the 0s window only (X_multi[:, 2])."""
    model.to(dev).train()
    opt = optim.Adam(model.parameters(), lr=LR)
    ce  = nn.CrossEntropyLoss()
    for _ in range(EPOCHS):
        for xb, yb in tr_dl:
            xb, yb = xb.to(dev), yb.to(dev)
            x0 = xb[:, 2]   # index 2 = 0s offset
            model.reset_stream()
            opt.zero_grad()
            ce(model(x0, sigma=SIGMA), yb).backward()
            opt.step()

def train_streaming(model, tr_dl, dev):
    """New: feed [-1s, -0.5s, 0s] sequentially; loss at 0s output."""
    model.to(dev).train()
    opt = optim.Adam(model.parameters(), lr=LR)
    ce  = nn.CrossEntropyLoss()
    for _ in range(EPOCHS):
        for xb, yb in tr_dl:
            xb, yb = xb.to(dev), yb.to(dev)
            model.reset_stream()
            opt.zero_grad()
            # Run pre-P steps with no_grad (warm-up buffer only)
            with torch.no_grad():
                for t in range(TRAIN_N_STEPS - 1):
                    model(xb[:, t], sigma=SIGMA, streaming=True)
            # Classify at the final (0s) step — gradient flows here
            logits = model(xb[:, TRAIN_N_STEPS-1], sigma=SIGMA, streaming=True)
            ce(logits, yb).backward()
            opt.step()

# ── Eval ──────────────────────────────────────────────────────────────────────
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

def eval_strategies(model, X_val, y_val, mags_val, dev):
    N = len(y_val)
    model.to(dev).eval()

    def run_stream(n_steps, classify_at=None):
        model.reset_stream()
        with torch.no_grad():
            for t in range(n_steps):
                Xt = torch.tensor(X_val[:, t], dtype=torch.float32).to(dev)
                logits = model(Xt, streaming=True)
        return logits.argmax(1).cpu().numpy()

    def run_max():
        model.reset_stream()
        best = np.zeros(N)
        with torch.no_grad():
            for t in range(len(STREAM_OFFSETS)):
                Xt = torch.tensor(X_val[:, t], dtype=torch.float32).to(dev)
                conf = F.softmax(model(Xt, streaming=True), dim=1)[:,1].cpu().numpy()
                best = np.maximum(best, conf)
        return (best > 0.5).astype(int)

    out = {}
    for name, preds in [
        ('single-0s',  run_stream(1, 0)),   # single step at 0s (no streaming)
        ('stream-3',   run_stream(3)),
        ('stream-4',   run_stream(4)),
        ('stream-max', run_max()),
    ]:
        # single-0s: reset and run one step only
        if name == 'single-0s':
            model.reset_stream()
            with torch.no_grad():
                Xt = torch.tensor(X_val[:, 2], dtype=torch.float32).to(dev)
                preds = model(Xt).argmax(1).cpu().numpy()
        p, r = prec_recall(preds, y_val)
        out[name] = {'prec': p, 'rec': r, 'mag': mag_prec(preds, y_val, mags_val)}
    return out

# ── Main ──────────────────────────────────────────────────────────────────────
print(f"device={DEVICE}  K={K}  epochs={EPOCHS}  seeds={SEEDS}")
print(f"decay={BUF_DECAY}  strength={BUF_STRENGTH}  per_bin={PER_BIN}  mag-weighted")
print(f"stream offsets: {STREAM_OFFSETS}  train seq: first {TRAIN_N_STEPS} (label at 0s)")
print()

t0 = time.time()
print("Loading multi-offset dataset...")
X_multi, y, mags = load_streaming_data()
n = len(y); SPLIT = int(n*0.85)
X_val, y_val, mags_val = X_multi[SPLIT:], y[SPLIT:], mags[SPLIT:]
print(f"Dataset: {n} total  ({y.sum()} eq, {(y==0).sum()} noise)\n")

STRATEGIES = ['single-0s', 'stream-3', 'stream-4', 'stream-max']
agg = {
    'single-trained': {s: {'precs':[], 'recs':[], 'mags':[]} for s in STRATEGIES},
    'stream-trained': {s: {'precs':[], 'recs':[], 'mags':[]} for s in STRATEGIES},
}

for seed in range(SEEDS):
    torch.manual_seed(seed); np.random.seed(seed)
    print(f"{'─'*65}")
    print(f"SEED {seed}", flush=True)
    tr_dl, va_dl, _ = make_loaders(X_multi, y, mags)

    # ── Single-trained ──────────────────────────────────────────────────────
    m_single = StreamingTribarNet()
    train_single(m_single, tr_dl, DEVICE)
    res_single = eval_strategies(m_single, X_val, y_val, mags_val, DEVICE)
    print("  [single-trained]", flush=True)
    for strat, r in res_single.items():
        agg['single-trained'][strat]['precs'].append(r['prec'])
        agg['single-trained'][strat]['recs'].append(r['rec'])
        agg['single-trained'][strat]['mags'].append(r['mag'])
        m = r['mag']
        print(f"    {strat:<14} prec={r['prec']*100:.1f}%  rec={r['rec']*100:.1f}%  "
              f"M<3={m.get('M<3',float('nan'))*100:.1f}%/{m.get('M3-5',float('nan'))*100:.1f}%/"
              f"{m.get('M5+',float('nan'))*100:.1f}%", flush=True)

    # ── Stream-trained ──────────────────────────────────────────────────────
    m_stream = StreamingTribarNet()
    train_streaming(m_stream, tr_dl, DEVICE)
    res_stream = eval_strategies(m_stream, X_val, y_val, mags_val, DEVICE)
    print("  [stream-trained]", flush=True)
    for strat, r in res_stream.items():
        agg['stream-trained'][strat]['precs'].append(r['prec'])
        agg['stream-trained'][strat]['recs'].append(r['rec'])
        agg['stream-trained'][strat]['mags'].append(r['mag'])
        m = r['mag']
        print(f"    {strat:<14} prec={r['prec']*100:.1f}%  rec={r['rec']*100:.1f}%  "
              f"M<3={m.get('M<3',float('nan'))*100:.1f}%/{m.get('M3-5',float('nan'))*100:.1f}%/"
              f"{m.get('M5+',float('nan'))*100:.1f}%", flush=True)

elapsed = int(time.time() - t0)
print(f"\nTotal wall time: {elapsed}s  ({elapsed//60}m {elapsed%60}s)")

# ── Summary table ─────────────────────────────────────────────────────────────
print(f"\n{'='*80}")
print(f"STREAMING-AWARE TRAINING SUMMARY  ({SEEDS} seeds)")
print(f"{'='*80}")
print(f"{'':22} {'prec%':>7} {'rec%':>7}  M<3/M3-5/M5+")
print(f"{'-'*80}")
base_prec = np.mean(agg['single-trained']['single-0s']['precs'])
for train_mode, label in [('single-trained','SINGLE-TRAINED'), ('stream-trained','STREAM-TRAINED')]:
    print(f"\n  {label}")
    for strat in STRATEGIES:
        r = agg[train_mode][strat]
        p = np.mean(r['precs']); re = np.mean(r['recs'])
        lt3 = np.nanmean([m.get('M<3',float('nan')) for m in r['mags']])*100
        m35 = np.nanmean([m.get('M3-5',float('nan')) for m in r['mags']])*100
        ge5 = np.nanmean([m.get('M5+',float('nan')) for m in r['mags']])*100
        delta = p - base_prec; sign = '+' if delta >= 0 else ''
        print(f"    {strat:<16} {p*100:>7.1f}%  {re*100:>6.1f}%  "
              f"{lt3:.1f}%/{m35:.1f}%/{ge5:.1f}%  {sign}{delta*100:.1f}% vs baseline")
