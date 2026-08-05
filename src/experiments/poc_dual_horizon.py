#!/usr/bin/env python3
"""
Dual-Horizon Seismic Detection Experiment.

Trains a single model with TWO classifier heads:
  - cls_early: fires at t=-0.5s (0.5s before P arrival)
  - cls_late:  fires at t=0s    (at P arrival)

Training protocol:
  1. Warm at -1s (no_grad)
  2. cls_early gets early logits at -0.5s (gradient flows)
  3. Continue streaming, cls_late gets late logits at 0s (gradient flows)
  4. Loss = 0.5 * CE(early) + 0.5 * CE(late)

Eval strategies:
  - early-only:  conf from cls_early at -0.5s, threshold=0.48
  - late-only:   conf from cls_late at 0s, threshold=0.48
  - max-conf:    max(early_conf, late_conf), threshold=0.48
  - and-gate:    BOTH early_conf>=0.48 AND late_conf>=0.48
  - weighted:    0.4*early_conf + 0.6*late_conf, threshold=0.48

Baseline comparison:
  - single early-trained early-2:    84.4% prec / 98.5% rec
  - single standard standard-3:      87.7% prec / 96.1% rec

Champion config: BUF_DECAY=0.876, BUF_STRENGTH=1.429, LR=2.78e-3,
                 THRESHOLD=0.480, EPOCHS=30, K=128, CYCLES=3
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
IDX_NEG1  = 0   # t = -1s  (warmup)
IDX_HALF  = 1   # t = -0.5s (early classify target)
IDX_ZERO  = 2   # t = 0s    (late classify target)

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

class DualHorizonNet(nn.Module):
    """StreamingNet with two classifier heads for dual-horizon detection."""
    def __init__(self, perm_seed=0):
        super().__init__()
        self.enc = nn.Sequential(ConvBlock(3,32),ConvBlock(32,64),ConvBlock(64,K),nn.AdaptiveAvgPool1d(1))
        rng = np.random.RandomState(perm_seed)
        perm = torch.tensor(rng.permutation(K), dtype=torch.long)
        self.register_buffer('perm', perm)
        self.cls_early = nn.Linear(K, 2)   # fires at -0.5s
        self.cls_late  = nn.Linear(K, 2)   # fires at  0.0s
        self._buf = None

    def reset_stream(self): self._buf = None

    def _encode(self, x, sigma=0.0, streaming=False):
        """Run encoder + orbit buffer, return hidden state h."""
        if sigma > 0: x = x + sigma * torch.randn_like(x)
        h   = self.enc(x).squeeze(-1)
        buf = self._buf if (streaming and self._buf is not None) else torch.zeros_like(h)
        for _ in range(CYCLES):
            h   = torch.relu(h[:, self.perm])
            buf = BUF_DECAY * buf + (1 - BUF_DECAY) * h.detach()
            h   = h + BUF_STRENGTH * buf
        if streaming: self._buf = buf.detach()
        return h

    def forward_early(self, x, sigma=0.0, streaming=False):
        h = self._encode(x, sigma=sigma, streaming=streaming)
        return self.cls_early(h)

    def forward_late(self, x, sigma=0.0, streaming=False):
        h = self._encode(x, sigma=sigma, streaming=streaming)
        return self.cls_late(h)

# ── Training ──────────────────────────────────────────────────────────────────
def train_dual(model, tr_dl, dev):
    """
    Dual-horizon training:
      1. Warm at -1s (no_grad)
      2. Early head classifies at -0.5s (gradient flows)
      3. Late head classifies at 0s (gradient flows)
      4. Loss = 0.5 * CE(early) + 0.5 * CE(late)
    """
    model.to(dev).train()
    opt = optim.Adam(model.parameters(), lr=LR)
    ce  = nn.CrossEntropyLoss()
    for ep in range(EPOCHS):
        for xb, yb in tr_dl:
            xb, yb = xb.to(dev), yb.to(dev)
            model.reset_stream()
            opt.zero_grad()

            # Step 1: warm at -1s, no gradient
            with torch.no_grad():
                model._encode(xb[:, IDX_NEG1], sigma=SIGMA, streaming=True)

            # Step 2: early head at -0.5s (gradient flows through cls_early)
            early_logits = model.forward_early(xb[:, IDX_HALF], sigma=SIGMA, streaming=True)

            # Step 3: late head at 0s (gradient flows through cls_late)
            late_logits = model.forward_late(xb[:, IDX_ZERO], sigma=SIGMA, streaming=True)

            # Step 4: combined loss, equal weight
            loss = 0.5 * ce(early_logits, yb) + 0.5 * ce(late_logits, yb)
            loss.backward()
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

def eval_dual(model, X_val, y_val, mags_val, dev):
    """Evaluate all dual-horizon aggregation strategies."""
    model.eval()

    # Collect early and late confidences
    with torch.no_grad():
        model.reset_stream()
        # Warmup at -1s
        Xn1 = torch.tensor(X_val[:, IDX_NEG1], dtype=torch.float32).to(dev)
        model._encode(Xn1, streaming=True)

        # Early head at -0.5s
        Xh = torch.tensor(X_val[:, IDX_HALF], dtype=torch.float32).to(dev)
        early_logits = model.forward_early(Xh, streaming=True)
        early_conf = F.softmax(early_logits, dim=1)[:, 1].cpu().numpy()

        # Late head at 0s
        Xz = torch.tensor(X_val[:, IDX_ZERO], dtype=torch.float32).to(dev)
        late_logits = model.forward_late(Xz, streaming=True)
        late_conf = F.softmax(late_logits, dim=1)[:, 1].cpu().numpy()

    results = {}

    # early-only: classify using early head at -0.5s
    confs = early_conf
    p, r = pr_at_threshold(confs, y_val, THRESHOLD)
    results['early-only'] = {'prec': p, 'rec': r, 'mag': mag_pr(confs, y_val, mags_val, THRESHOLD),
                              'confs': confs}

    # late-only: classify using late head at 0s
    confs = late_conf
    p, r = pr_at_threshold(confs, y_val, THRESHOLD)
    results['late-only'] = {'prec': p, 'rec': r, 'mag': mag_pr(confs, y_val, mags_val, THRESHOLD),
                             'confs': confs}

    # max-conf: take whichever head is more confident
    confs = np.maximum(early_conf, late_conf)
    p, r = pr_at_threshold(confs, y_val, THRESHOLD)
    results['max-conf'] = {'prec': p, 'rec': r, 'mag': mag_pr(confs, y_val, mags_val, THRESHOLD),
                            'confs': confs}

    # and-gate: positive only if BOTH heads exceed threshold
    preds = ((early_conf >= THRESHOLD) & (late_conf >= THRESHOLD)).astype(int)
    tp = ((preds==1)&(y_val==1)).sum(); fp = ((preds==1)&(y_val==0)).sum()
    fn = ((preds==0)&(y_val==1)).sum()
    p_ag = float(tp/(tp+fp+1e-9)); r_ag = float(tp/(tp+fn+1e-9))
    # For mag_pr use late_conf as representative (and-gate makes late_conf irrelevant for TP rate—use preds directly)
    mag_ag = {}
    for lbl, lo, hi in [('M<3',-np.inf,3.0),('M3-5',3.0,5.0),('M5+',5.0,np.inf)]:
        mask = (y_val==1)&(np.nan_to_num(mags_val,nan=0.)>=lo)&(np.nan_to_num(mags_val,nan=0.)<hi)
        if mask.sum()==0: mag_ag[lbl]=float('nan'); continue
        tp_m = ((preds==1)&mask).sum()
        fp_m = ((preds==1)&(y_val==0)).sum()
        mag_ag[lbl] = float(tp_m/(tp_m+fp_m+1e-9))
    results['and-gate'] = {'prec': p_ag, 'rec': r_ag, 'mag': mag_ag}

    # weighted: 0.4*early + 0.6*late
    confs = 0.4 * early_conf + 0.6 * late_conf
    p, r = pr_at_threshold(confs, y_val, THRESHOLD)
    results['weighted'] = {'prec': p, 'rec': r, 'mag': mag_pr(confs, y_val, mags_val, THRESHOLD),
                            'confs': confs}

    return results

# ── Main ──────────────────────────────────────────────────────────────────────
print(f"device={DEVICE}  K={K}  EPOCHS={EPOCHS}  SEEDS={SEEDS}")
print(f"champion config: decay={BUF_DECAY}  strength={BUF_STRENGTH}  lr={LR}  threshold={THRESHOLD}")
print(f"architecture: DualHorizonNet (cls_early@-0.5s + cls_late@0s)")
print(f"loss: 0.5*CE(early) + 0.5*CE(late)")
print()

t0 = time.time()
print("Loading multi-offset dataset...")
X_multi, y, mags = load_streaming_data()
n = len(y); SPLIT = int(n*0.85)
X_val, y_val, mags_val = X_multi[SPLIT:], y[SPLIT:], mags[SPLIT:]
print(f"Dataset: {n} total  ({y.sum()} eq, {(y==0).sum()} noise)\n")

STRATS = ['early-only', 'late-only', 'max-conf', 'and-gate', 'weighted']
agg = {s: {'precs': [], 'recs': [], 'mags': []} for s in STRATS}

for seed in range(SEEDS):
    torch.manual_seed(seed); np.random.seed(seed)
    print(f"{'─'*70}")
    print(f"SEED {seed}", flush=True)
    tr_dl, _, _ = make_loaders(X_multi, y, mags)

    model = DualHorizonNet(perm_seed=seed)
    train_dual(model, tr_dl, DEVICE)

    results = eval_dual(model, X_val, y_val, mags_val, DEVICE)
    print("  [dual-horizon-trained]", flush=True)
    for strat in STRATS:
        r = results[strat]
        agg[strat]['precs'].append(r['prec'])
        agg[strat]['recs'].append(r['rec'])
        agg[strat]['mags'].append(r['mag'])
        mp = r['mag']
        print(f"    {strat:<14} prec={r['prec']*100:.1f}%  rec={r['rec']*100:.1f}%  "
              f"M<3={mp.get('M<3',float('nan'))*100:.1f}%/"
              f"{mp.get('M3-5',float('nan'))*100:.1f}%/"
              f"{mp.get('M5+',float('nan'))*100:.1f}%", flush=True)

elapsed = int(time.time() - t0)
print(f"\nTotal wall time: {elapsed}s  ({elapsed//60}m {elapsed%60}s)")

# ── Summary ───────────────────────────────────────────────────────────────────
print(f"\n{'='*80}")
print(f"DUAL-HORIZON SUMMARY  ({SEEDS} seeds, threshold={THRESHOLD})")
print(f"{'='*80}")
print(f"{'strategy':<18} {'prec%':>7} {'rec%':>7}  M<3/M3-5/M5+")
print(f"{'-'*80}")

for strat in STRATS:
    r  = agg[strat]
    p  = np.mean(r['precs']); re = np.mean(r['recs'])
    lt3 = np.nanmean([m.get('M<3', float('nan')) for m in r['mags']]) * 100
    m35 = np.nanmean([m.get('M3-5', float('nan')) for m in r['mags']]) * 100
    ge5 = np.nanmean([m.get('M5+', float('nan')) for m in r['mags']]) * 100
    print(f"  {strat:<16} {p*100:>7.1f}%  {re*100:>6.1f}%  {lt3:.1f}%/{m35:.1f}%/{ge5:.1f}%")

print(f"\n{'─'*80}")
print(f"BASELINE COMPARISON")
print(f"  single early-2    (early-trained):    84.4% prec  98.5% rec  (fires at -0.5s)")
print(f"  single standard-3 (standard-trained): 87.7% prec  96.1% rec  (fires at   0s)")
print(f"{'─'*80}")
print(f"DUAL-HORIZON RESULTS:")
for strat in STRATS:
    p  = np.mean(agg[strat]['precs'])
    re = np.mean(agg[strat]['recs'])
    # compare to best baseline for this timing: early-only vs early-2, others vs standard-3
    if strat == 'early-only':
        ref_p, ref_r, ref_name = 0.844, 0.985, 'early-2'
    else:
        ref_p, ref_r, ref_name = 0.877, 0.961, 'standard-3'
    dp = (p - ref_p) * 100; dr = (re - ref_r) * 100
    sp = '+' if dp >= 0 else ''; sr = '+' if dr >= 0 else ''
    print(f"  {strat:<16} {p*100:.1f}% prec  {re*100:.1f}% rec  "
          f"(vs {ref_name}: prec {sp}{dp:.1f}pp  rec {sr}{dr:.1f}pp)")

print()
print("Verdict:")
best_strat = max(STRATS, key=lambda s: np.mean(agg[s]['precs']))
best_p  = np.mean(agg[best_strat]['precs'])
best_r  = np.mean(agg[best_strat]['recs'])
print(f"  Best strategy by precision: [{best_strat}]  {best_p*100:.1f}% prec  {best_r*100:.1f}% rec")
best_rec_strat = max(STRATS, key=lambda s: np.mean(agg[s]['recs']))
best_rp = np.mean(agg[best_rec_strat]['precs'])
best_rr = np.mean(agg[best_rec_strat]['recs'])
print(f"  Best strategy by recall:    [{best_rec_strat}]  {best_rp*100:.1f}% prec  {best_rr*100:.1f}% rec")
