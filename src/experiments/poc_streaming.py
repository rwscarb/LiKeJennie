#!/usr/bin/env python3
"""
Streaming Multi-Window Inference Experiment.

Core question: does feeding [-1s, -0.5s, 0s] windows sequentially to TribarNet
(with buffer state carried across steps) improve over single-window at 0s?

Design:
  · Load a fixed set of earthquake/noise indices.
  · For each index extract windows at 4 offsets: [-1s, -0.5s, 0s, +0.5s].
    Keep only indices where all 4 offsets are in-bounds.
  · Train on 0s windows (strongest single-offset: ~83%).
  · At inference, compare 4 strategies:
      single-0s   : standard eval at 0s window only
      stream-3    : feed [-1s, -0.5s, 0s] sequentially; classify at 0s
      stream-4    : feed [-1s, -0.5s, 0s, +0.5s]; classify at +0.5s
      stream-max  : max confidence across all 4 step outputs
  · Report precision + per-magnitude breakdown for each strategy.

Best config to date: decay=0.83, strength=1.4, per_bin=2666, mag-weighted.
"""
import time, warnings
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F, torch.optim as optim
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
warnings.filterwarnings('ignore')

# ── Constants ─────────────────────────────────────────────────────────────────
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

# Streaming offsets (samples from P-arrival)
STREAM_OFFSETS = [-100, -50, 0, 50]   # -1s, -0.5s, 0s, +0.5s
TRAIN_IDX      = 2                     # which offset to train on (0s)

ORBIT_BASE = [0, 1, 3, 7, 6, 4]

def make_orbit_perm(k):
    p = []
    while len(p) < k: p.extend(ORBIT_BASE)
    return torch.tensor(p[:k], dtype=torch.long)

# ── Datasets ──────────────────────────────────────────────────────────────────
class SingleWindowDataset(Dataset):
    def __init__(self, X, y):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.long)
    def __len__(self): return len(self.y)
    def __getitem__(self, i): return self.X[i], self.y[i]

# ── Multi-offset data loader ──────────────────────────────────────────────────
def load_streaming_data():
    """
    Returns:
      X_multi : (N, 4, 3, WIN_SAMPLES) — same samples at each of 4 offsets
      y       : (N,)
      mags    : (N,)
    Keeps only indices where all 4 offsets are valid.
    """
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

    t_ge5 = min(PER_BIN, len(b_ge5))
    t_3_5 = min(PER_BIN, len(b_3_5))
    t_lt3 = min(MAX_EVENTS - t_ge5 - t_3_5, len(b_lt3))
    print(f"  mag bins: M<3={t_lt3} M3-5={t_3_5} M5+={t_ge5}", flush=True)

    np.random.shuffle(b_lt3); np.random.shuffle(b_3_5); np.random.shuffle(b_ge5)
    eq_idx = np.concatenate([b_lt3[:t_lt3], b_3_5[:t_3_5], b_ge5[:t_ge5]])
    np.random.shuffle(eq_idx); np.random.shuffle(noise_pos)

    def load_multi_offsets(idx, meta):
        """Load one waveform at all 4 offsets. Returns (4, 3, WIN) or None."""
        try:
            wf = eq.get_waveforms(int(idx))
            if wf is None or wf.shape[1] < 3000: return None
            p_samp = int(meta.get('trace_p_arrival_sample', 0) or 0)
            windows = []
            for off in STREAM_OFFSETS:
                st = p_samp + off
                if st < 0 or st + WIN_SAMPLES > wf.shape[1]: return None
                w = wf[:, st:st+WIN_SAMPLES].astype(np.float32)
                if w.shape[1] < WIN_SAMPLES: return None
                std = w.std(axis=1, keepdims=True) + 1e-6
                windows.append(w / std)
            return np.stack(windows, axis=0)   # (4, 3, WIN)
        except Exception: return None

    print(f"  loading earthquakes at 4 offsets...", flush=True)
    X_eq_multi, mags_list = [], []
    for i, idx in enumerate(eq_idx):
        if i % 1000 == 0: print(f"    eq {i}/{len(eq_idx)} ok={len(X_eq_multi)}", flush=True)
        meta = meta_df.iloc[int(idx)]
        windows = load_multi_offsets(idx, meta)
        if windows is not None:
            X_eq_multi.append(windows)
            mags_list.append(float(meta.get('source_magnitude', np.nan) or np.nan))

    print(f"  loading noise at 4 offsets...", flush=True)
    X_noise_multi = []
    for i, idx in enumerate(noise_pos[:MAX_EVENTS * 4]):
        if len(X_noise_multi) >= MAX_EVENTS: break
        try:
            wf = eq.get_waveforms(int(idx))
            if wf is None or wf.shape[1] < 3000: continue
            windows = []
            valid = True
            for _ in STREAM_OFFSETS:
                st = np.random.randint(0, max(1, wf.shape[1] - WIN_SAMPLES))
                w  = wf[:, st:st+WIN_SAMPLES].astype(np.float32)
                if w.shape[1] < WIN_SAMPLES: valid = False; break
                std = w.std(axis=1, keepdims=True) + 1e-6
                windows.append(w / std)
            if valid: X_noise_multi.append(np.stack(windows, axis=0))
        except Exception: continue

    n = min(len(X_eq_multi), len(X_noise_multi))
    print(f"  kept: {n} earthquakes, {n} noise (multi-offset)", flush=True)
    mags_arr   = np.array(mags_list[:n])
    noise_mags = np.full(n, np.nan)

    X_multi = np.concatenate([np.array(X_eq_multi[:n]), np.array(X_noise_multi[:n])], axis=0)
    y       = np.array([1]*n + [0]*n)
    mags    = np.concatenate([mags_arr, noise_mags])
    perm = np.random.permutation(len(y))
    return X_multi[perm], y[perm], mags[perm]

def split_loaders_single(X_multi, y, mags, offset_idx=TRAIN_IDX, val_frac=0.15):
    """Train/val split using the single offset_idx window for training."""
    X = X_multi[:, offset_idx]   # (N, 3, WIN_SAMPLES)
    n = len(y); split = int(n*(1-val_frac))
    tr = SingleWindowDataset(X[:split], y[:split])
    va = SingleWindowDataset(X[split:], y[split:])
    tr_mags = mags[:split]; tr_y = y[:split]
    weights = np.ones(split, dtype=np.float32)
    for label, lo, hi in [(1,-np.inf,3.0),(1,3.0,5.0),(1,5.0,np.inf),(0,-np.inf,np.inf)]:
        mask = (tr_y==1)&(np.nan_to_num(tr_mags,nan=0.)>=lo)&(np.nan_to_num(tr_mags,nan=0.)<hi) \
               if label==1 else (tr_y==0)
        n_b = mask.sum()
        if n_b > 0: weights[mask] = 1.0/n_b
    sampler = WeightedRandomSampler(weights=weights, num_samples=split, replacement=True)
    return (DataLoader(tr, batch_size=BATCH, sampler=sampler, num_workers=0),
            DataLoader(va, batch_size=BATCH, shuffle=False, num_workers=0),
            split)

# ── Models ────────────────────────────────────────────────────────────────────
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
    def reset_stream(self):
        self._buf = None
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

# ── Train ─────────────────────────────────────────────────────────────────────
def train(model, tr_dl, dev):
    model.to(dev).train()
    opt = optim.Adam(model.parameters(), lr=LR)
    ce  = nn.CrossEntropyLoss()
    for _ in range(EPOCHS):
        for xb, yb in tr_dl:
            xb, yb = xb.to(dev), yb.to(dev)
            model.reset_stream()
            opt.zero_grad()
            ce(model(xb, sigma=SIGMA), yb).backward()
            opt.step()

# ── Eval strategies ────────────────────────────────────────────────────────────
def prec_recall(preds, y):
    tp = ((preds==1)&(y==1)).sum(); fp = ((preds==1)&(y==0)).sum()
    fn = ((preds==0)&(y==1)).sum()
    prec = tp/(tp+fp+1e-9); rec  = tp/(tp+fn+1e-9)
    return float(prec), float(rec)

def mag_prec(preds, y, mags):
    out = {}
    for lbl, lo, hi in [('M<3',-np.inf,3.0),('M3-5',3.0,5.0),('M5+',5.0,np.inf)]:
        mask = (y==1)&(np.nan_to_num(mags,nan=0.)>=lo)&(np.nan_to_num(mags,nan=0.)<hi)
        if mask.sum()==0: out[lbl]=float('nan'); continue
        tp = ((preds==1)&mask).sum(); fp = ((preds==1)&(y==0)).sum()
        out[lbl] = float(tp/(tp+fp+1e-9))
    return out

def eval_all_strategies(model, X_multi_val, y_val, mags_val, dev):
    """
    X_multi_val: (N_val, 4, 3, WIN_SAMPLES)
    Returns dict of strategy → (preds, prec, recall, mag_breakdown)
    """
    model.to(dev).eval()
    N = len(y_val)
    results = {}

    # ── Strategy 1: single-0s (no streaming) ────────────────────────────────
    X0 = torch.tensor(X_multi_val[:, TRAIN_IDX], dtype=torch.float32).to(dev)
    with torch.no_grad():
        model.reset_stream()
        logits0 = model(X0)
    preds0 = logits0.argmax(1).cpu().numpy()
    p, r = prec_recall(preds0, y_val)
    results['single-0s'] = {'preds': preds0, 'prec': p, 'rec': r, 'mag': mag_prec(preds0, y_val, mags_val)}

    # ── Strategy 2: stream-3 → classify at 0s ───────────────────────────────
    model.reset_stream()
    with torch.no_grad():
        for t in range(3):   # -1s, -0.5s, 0s
            Xt = torch.tensor(X_multi_val[:, t], dtype=torch.float32).to(dev)
            logits_t = model(Xt, streaming=True)
    preds_s3 = logits_t.argmax(1).cpu().numpy()
    p, r = prec_recall(preds_s3, y_val)
    results['stream-3'] = {'preds': preds_s3, 'prec': p, 'rec': r, 'mag': mag_prec(preds_s3, y_val, mags_val)}

    # ── Strategy 3: stream-4 → classify at +0.5s ────────────────────────────
    model.reset_stream()
    with torch.no_grad():
        for t in range(4):   # -1s, -0.5s, 0s, +0.5s
            Xt = torch.tensor(X_multi_val[:, t], dtype=torch.float32).to(dev)
            logits_t = model(Xt, streaming=True)
    preds_s4 = logits_t.argmax(1).cpu().numpy()
    p, r = prec_recall(preds_s4, y_val)
    results['stream-4'] = {'preds': preds_s4, 'prec': p, 'rec': r, 'mag': mag_prec(preds_s4, y_val, mags_val)}

    # ── Strategy 4: stream-max confidence across all 4 steps ────────────────
    model.reset_stream()
    all_eq_conf = np.zeros(N)
    with torch.no_grad():
        for t in range(4):
            Xt = torch.tensor(X_multi_val[:, t], dtype=torch.float32).to(dev)
            logits_t = model(Xt, streaming=True)
            conf_t = F.softmax(logits_t, dim=1)[:, 1].cpu().numpy()
            all_eq_conf = np.maximum(all_eq_conf, conf_t)
    preds_mx = (all_eq_conf > 0.5).astype(int)
    p, r = prec_recall(preds_mx, y_val)
    results['stream-max'] = {'preds': preds_mx, 'prec': p, 'rec': r, 'mag': mag_prec(preds_mx, y_val, mags_val)}

    # ── Strategy 5: stream-vote — majority vote across 4 step predictions ───
    model.reset_stream()
    vote_preds = np.zeros((4, N), dtype=int)
    with torch.no_grad():
        for t in range(4):
            Xt = torch.tensor(X_multi_val[:, t], dtype=torch.float32).to(dev)
            logits_t = model(Xt, streaming=True)
            vote_preds[t] = logits_t.argmax(1).cpu().numpy()
    preds_vote = (vote_preds.sum(axis=0) >= 2).astype(int)
    p, r = prec_recall(preds_vote, y_val)
    results['stream-vote'] = {'preds': preds_vote, 'prec': p, 'rec': r, 'mag': mag_prec(preds_vote, y_val, mags_val)}

    return results

# ── Main ──────────────────────────────────────────────────────────────────────
print(f"device={DEVICE}  K={K}  epochs={EPOCHS}  seeds={SEEDS}")
print(f"decay={BUF_DECAY}  strength={BUF_STRENGTH}  per_bin={PER_BIN}  mag-weighted")
print(f"stream offsets: {STREAM_OFFSETS} samples  train on: offset[{TRAIN_IDX}]=0s")
print()

t0 = time.time()

print("Loading multi-offset dataset (this takes a while — loading 4 windows per sample)...")
X_multi, y, mags = load_streaming_data()
n = len(y)
print(f"Dataset: {n} total samples  ({y.sum()} eq, {(y==0).sum()} noise)")
print()

# Fixed train/val split indices
SPLIT = int(n * 0.85)
X_multi_val = X_multi[SPLIT:]
y_val, mags_val = y[SPLIT:], mags[SPLIT:]

agg = {strat: {'precs':[], 'recs':[], 'mags':[]} for strat in
       ['single-0s', 'stream-3', 'stream-4', 'stream-max', 'stream-vote']}

for seed in range(SEEDS):
    torch.manual_seed(seed); np.random.seed(seed)
    print(f"{'─'*65}")
    print(f"SEED {seed}", flush=True)

    tr_dl, va_dl, _ = split_loaders_single(X_multi, y, mags)
    model = StreamingTribarNet()
    train(model, tr_dl, DEVICE)

    # Quick single-window val to confirm training worked
    p_single_tr = 0.0
    model.eval()
    tp = fp = 0
    with torch.no_grad():
        for xb, yb in va_dl:
            pred = model(xb.to(DEVICE)).argmax(1).cpu()
            tp += ((pred==1)&(yb==1)).sum().item()
            fp += ((pred==1)&(yb==0)).sum().item()
    p_single_tr = tp/(tp+fp+1e-9)
    print(f"  trained single-0s precision: {p_single_tr*100:.1f}%", flush=True)

    # All strategies on the fixed val set
    res = eval_all_strategies(model, X_multi_val, y_val, mags_val, DEVICE)
    for strat, r in res.items():
        agg[strat]['precs'].append(r['prec'])
        agg[strat]['recs'].append(r['rec'])
        agg[strat]['mags'].append(r['mag'])
        m = r['mag']
        print(f"  {strat:<14} prec={r['prec']*100:.1f}%  rec={r['rec']*100:.1f}%  "
              f"M<3={m.get('M<3',float('nan'))*100:.1f}%  "
              f"M3-5={m.get('M3-5',float('nan'))*100:.1f}%  "
              f"M5+={m.get('M5+',float('nan'))*100:.1f}%", flush=True)

elapsed = int(time.time() - t0)
print(f"\nTotal wall time: {elapsed}s  ({elapsed//60}m {elapsed%60}s)")
print(f"\n{'='*78}")
print(f"STREAMING INFERENCE SUMMARY  (mean ± std over {SEEDS} seeds)")
print(f"{'='*78}")
print(f"{'strategy':<16} {'prec%':>7} {'rec%':>7}  mag M<3/M3-5/M5+  vs single-0s")
print(f"{'-'*78}")
base_prec = np.mean(agg['single-0s']['precs'])
for strat in ['single-0s', 'stream-3', 'stream-4', 'stream-max', 'stream-vote']:
    r = agg[strat]
    p_mean = np.mean(r['precs']); p_std = np.std(r['precs'])
    re_mean = np.mean(r['recs'])
    lt3 = np.nanmean([m.get('M<3',float('nan')) for m in r['mags']])*100
    m35 = np.nanmean([m.get('M3-5',float('nan')) for m in r['mags']])*100
    ge5 = np.nanmean([m.get('M5+',float('nan')) for m in r['mags']])*100
    delta = p_mean - base_prec
    sign  = '+' if delta >= 0 else ''
    print(f"{strat:<16} {p_mean*100:>7.1f}%  {re_mean*100:>6.1f}%  "
          f"{lt3:.1f}%/{m35:.1f}%/{ge5:.1f}%  {sign}{delta*100:.1f}%")
