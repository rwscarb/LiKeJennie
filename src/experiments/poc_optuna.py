#!/usr/bin/env python3
"""
Optuna HPO for streaming-trained TribarNet.

Search space:
  threshold    : [0.30, 0.70]  — softmax decision boundary
  buf_decay    : [0.75, 0.92]  — buffer momentum
  buf_strength : [0.8,  2.5]   — buffer injection weight
  lr           : [1e-4, 5e-3]  log-uniform

Strategy under optimization: stream-3 (feed -1s, -0.5s, then classify at 0s).

Objective: maximize precision subject to recall >= RECALL_FLOOR.
Trials that fall below the floor are scored 0.0 so TPE explores the
precision-feasible region rather than collapsing to recall-maximizing configs.

After study: re-evaluate best config with all 5 strategies at best threshold
to show the full picture.
"""
import warnings, time
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F, torch.optim as optim
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
warnings.filterwarnings('ignore')

import optuna
optuna.logging.set_verbosity(optuna.logging.WARNING)

# ── Constants ─────────────────────────────────────────────────────────────────
DEVICE        = 'cuda' if torch.cuda.is_available() else 'cpu'
K             = 128
CYCLES        = 3
WIN_SAMPLES   = 100
MAX_EVENTS    = 8000
PER_BIN       = 2666
BATCH         = 64
EPOCHS        = 25          # slightly fewer per trial to keep wall-time manageable
SIGMA         = 0.3
STREAM_OFFSETS = [-100, -50, 0, 50]
TRAIN_N_STEPS  = 3          # train on [-1s, -0.5s] → classify at 0s
RECALL_FLOOR   = 0.95       # minimum recall for a trial to score > 0
N_TRIALS       = 50

ORBIT_BASE = [0, 1, 3, 7, 6, 4]
def make_orbit_perm(k):
    p = []
    while len(p) < k: p.extend(ORBIT_BASE)
    return torch.tensor(p[:k], dtype=torch.long)

# ── Dataset ───────────────────────────────────────────────────────────────────
class MultiOffsetDataset(Dataset):
    def __init__(self, X, y):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.long)
    def __len__(self): return len(self.y)
    def __getitem__(self, i): return self.X[i], self.y[i]

_DATA_CACHE = None

def load_data():
    global _DATA_CACHE
    if _DATA_CACHE is not None:
        return _DATA_CACHE

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
    print(f"  bins: M<3={t_lt3}  M3-5={t_3_5}  M5+={t_ge5}", flush=True)

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
    X_eq, mags_list = [], []
    for i, idx in enumerate(eq_idx):
        if i % 1000 == 0: print(f"    eq {i}/{len(eq_idx)} ok={len(X_eq)}", flush=True)
        try:
            m = meta_df.iloc[int(idx)]
            p = int(m.get('trace_p_arrival_sample', 0) or 0)
            w = load_multi(idx, p)
            if w is not None:
                X_eq.append(w)
                mags_list.append(float(m.get('source_magnitude', np.nan) or np.nan))
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
    X = np.concatenate([np.array(X_eq[:n]), np.array(X_noise[:n])], axis=0)
    y = np.array([1]*n + [0]*n)
    mags = np.concatenate([np.array(mags_list[:n]), np.full(n, np.nan)])
    perm = np.random.permutation(len(y))
    X, y, mags = X[perm], y[perm], mags[perm]
    print(f"  dataset: {len(y)} total  ({y.sum()} eq, {(y==0).sum()} noise)", flush=True)
    _DATA_CACHE = (X, y, mags)
    return _DATA_CACHE

def make_loaders(X, y, mags, val_frac=0.15, seed=42):
    rng = np.random.RandomState(seed)
    n   = len(y); split = int(n * (1 - val_frac))
    idx = rng.permutation(n)
    tr_idx, va_idx = idx[:split], idx[split:]
    tr = MultiOffsetDataset(X[tr_idx], y[tr_idx])
    weights = np.ones(split, dtype=np.float32)
    tr_y    = y[tr_idx]; tr_mags = mags[tr_idx]
    for label, lo, hi in [(1,-np.inf,3.0),(1,3.0,5.0),(1,5.0,np.inf),(0,-np.inf,np.inf)]:
        mask = (tr_y==1)&(np.nan_to_num(tr_mags,nan=0.)>=lo)&(np.nan_to_num(tr_mags,nan=0.)<hi) \
               if label==1 else (tr_y==0)
        n_b = mask.sum()
        if n_b > 0: weights[mask] = 1.0 / n_b
    sampler = WeightedRandomSampler(weights=weights, num_samples=split, replacement=True)
    tr_dl = DataLoader(tr, batch_size=BATCH, sampler=sampler, num_workers=0)
    va_ds = MultiOffsetDataset(X[va_idx], y[va_idx])
    va_dl = DataLoader(va_ds, batch_size=BATCH, shuffle=False, num_workers=0)
    return tr_dl, va_dl, X[va_idx], y[va_idx], mags[va_idx]

# ── Model ─────────────────────────────────────────────────────────────────────
class ConvBlock(nn.Module):
    def __init__(self, ci, co, k=7):
        super().__init__()
        self.net = nn.Sequential(nn.Conv1d(ci,co,k,padding=k//2),nn.BatchNorm1d(co),nn.ReLU())
    def forward(self, x): return self.net(x)

class TribarNet(nn.Module):
    def __init__(self, buf_decay, buf_strength):
        super().__init__()
        self.buf_decay    = buf_decay
        self.buf_strength = buf_strength
        self.enc  = nn.Sequential(ConvBlock(3,32),ConvBlock(32,64),ConvBlock(64,K),nn.AdaptiveAvgPool1d(1))
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
            buf = self.buf_decay * buf + (1 - self.buf_decay) * h.detach()
            h   = h + self.buf_strength * buf
        if streaming: self._buf = buf.detach()
        return self.cls(h)

def train_streaming_model(model, tr_dl, lr, dev):
    model.to(dev).train()
    opt = optim.Adam(model.parameters(), lr=lr)
    ce  = nn.CrossEntropyLoss()
    for _ in range(EPOCHS):
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

def stream3_confs(model, X_val, dev):
    """Return softmax P(eq) scores using stream-3 strategy."""
    model.eval()
    model.reset_stream()
    N = len(X_val)
    with torch.no_grad():
        for t in range(3):
            Xt = torch.tensor(X_val[:, t], dtype=torch.float32).to(dev)
            logits = model(Xt, streaming=True)
    return F.softmax(logits, dim=1)[:, 1].cpu().numpy()

def pr_at_threshold(confs, y, thresh):
    preds = (confs >= thresh).astype(int)
    tp = ((preds==1)&(y==1)).sum(); fp = ((preds==1)&(y==0)).sum()
    fn = ((preds==0)&(y==1)).sum()
    prec = float(tp/(tp+fp+1e-9)); rec = float(tp/(tp+fn+1e-9))
    return prec, rec

def mag_prec(preds, y, mags):
    out = {}
    for lbl, lo, hi in [('M<3',-np.inf,3.0),('M3-5',3.0,5.0),('M5+',5.0,np.inf)]:
        mask = (y==1)&(np.nan_to_num(mags,nan=0.)>=lo)&(np.nan_to_num(mags,nan=0.)<hi)
        if not mask.any(): out[lbl]=float('nan'); continue
        tp = ((preds==1)&mask).sum(); fp = ((preds==1)&(y==0)).sum()
        out[lbl] = float(tp/(tp+fp+1e-9))
    return out

# ── Optuna objective ──────────────────────────────────────────────────────────
_TR_DL = _X_VAL = _Y_VAL = _MAGS_VAL = None

def objective(trial):
    threshold    = trial.suggest_float('threshold',    0.30, 0.70)
    buf_decay    = trial.suggest_float('buf_decay',    0.75, 0.92)
    buf_strength = trial.suggest_float('buf_strength', 0.80, 2.50)
    lr           = trial.suggest_float('lr',           1e-4, 5e-3, log=True)

    torch.manual_seed(trial.number % 10)
    model = TribarNet(buf_decay, buf_strength)
    train_streaming_model(model, _TR_DL, lr, DEVICE)

    confs = stream3_confs(model, _X_VAL, DEVICE)
    prec, rec = pr_at_threshold(confs, _Y_VAL, threshold)

    trial.set_user_attr('prec', prec)
    trial.set_user_attr('rec',  rec)

    if rec < RECALL_FLOOR:
        return 0.0
    return prec

# ── Main ──────────────────────────────────────────────────────────────────────
print(f"device={DEVICE}  K={K}  epochs={EPOCHS}/trial  trials={N_TRIALS}")
print(f"strategy=stream-3  recall_floor={RECALL_FLOOR*100:.0f}%  obj=precision")
print()

t0 = time.time()
print("Loading dataset...")
X, y, mags = load_data()
print()

_TR_DL, _, _X_VAL, _Y_VAL, _MAGS_VAL = make_loaders(X, y, mags)

study = optuna.create_study(direction='maximize',
                            sampler=optuna.samplers.TPESampler(seed=0))

def print_trial(study, trial):
    p = trial.user_attrs.get('prec', float('nan'))
    r = trial.user_attrs.get('rec',  float('nan'))
    beat = '*' if trial.number == study.best_trial.number else ' '
    print(f"  t{trial.number:03d}{beat} thresh={trial.params['threshold']:.3f}  "
          f"decay={trial.params['buf_decay']:.3f}  strength={trial.params['buf_strength']:.3f}  "
          f"lr={trial.params['lr']:.2e}  "
          f"prec={p*100:.1f}%  rec={r*100:.1f}%  score={trial.value:.4f}", flush=True)

study.optimize(objective, n_trials=N_TRIALS, callbacks=[print_trial], show_progress_bar=False)

elapsed = int(time.time() - t0)
best = study.best_trial

print(f"\nWall time: {elapsed}s ({elapsed//60}m {elapsed%60}s)")
print(f"\n{'='*75}")
print(f"BEST TRIAL: #{best.number}")
print(f"  threshold    = {best.params['threshold']:.4f}")
print(f"  buf_decay    = {best.params['buf_decay']:.4f}")
print(f"  buf_strength = {best.params['buf_strength']:.4f}")
print(f"  lr           = {best.params['lr']:.5f}")
print(f"  prec = {best.user_attrs['prec']*100:.1f}%  rec = {best.user_attrs['rec']*100:.1f}%")

# ── Full eval of best config across all strategies ────────────────────────────
print(f"\n--- Full eval of best config ---")
torch.manual_seed(99)
model_best = TribarNet(best.params['buf_decay'], best.params['buf_strength'])
train_streaming_model(model_best, _TR_DL, best.params['lr'], DEVICE)
thresh = best.params['threshold']

model_best.eval()
with torch.no_grad():
    # single-0s
    model_best.reset_stream()
    Xt = torch.tensor(_X_VAL[:, 2], dtype=torch.float32).to(DEVICE)
    preds_s0 = (F.softmax(model_best(Xt), dim=1)[:,1].cpu().numpy() >= thresh).astype(int)

    # stream-3
    model_best.reset_stream()
    for t in range(3):
        Xt = torch.tensor(_X_VAL[:, t], dtype=torch.float32).to(DEVICE)
        logits3 = model_best(Xt, streaming=True)
    preds_s3 = (F.softmax(logits3, dim=1)[:,1].cpu().numpy() >= thresh).astype(int)

    # stream-4
    model_best.reset_stream()
    for t in range(4):
        Xt = torch.tensor(_X_VAL[:, t], dtype=torch.float32).to(DEVICE)
        logits4 = model_best(Xt, streaming=True)
    preds_s4 = (F.softmax(logits4, dim=1)[:,1].cpu().numpy() >= thresh).astype(int)

    # stream-max
    model_best.reset_stream()
    best_conf = np.zeros(len(_Y_VAL))
    for t in range(4):
        Xt = torch.tensor(_X_VAL[:, t], dtype=torch.float32).to(DEVICE)
        conf = F.softmax(model_best(Xt, streaming=True), dim=1)[:,1].cpu().numpy()
        best_conf = np.maximum(best_conf, conf)
    preds_mx = (best_conf >= thresh).astype(int)

def pr(preds, y):
    tp = ((preds==1)&(y==1)).sum(); fp = ((preds==1)&(y==0)).sum()
    fn = ((preds==0)&(y==1)).sum()
    return float(tp/(tp+fp+1e-9)), float(tp/(tp+fn+1e-9))

print(f"\n  (threshold={thresh:.3f} on stream-trained model with best HPO params)")
print(f"  {'strategy':<16}  {'prec%':>7}  {'rec%':>7}  M<3/M3-5/M5+")
print(f"  {'-'*65}")
for name, preds in [('single-0s', preds_s0), ('stream-3', preds_s3), ('stream-4', preds_s4), ('stream-max', preds_mx)]:
    p, r = pr(preds, _Y_VAL)
    m = mag_prec(preds, _Y_VAL, _MAGS_VAL)
    print(f"  {name:<16}  {p*100:>7.1f}%  {r*100:>6.1f}%  "
          f"{m.get('M<3',float('nan'))*100:.1f}%/{m.get('M3-5',float('nan'))*100:.1f}%/"
          f"{m.get('M5+',float('nan'))*100:.1f}%", flush=True)

# Top 10 trials
print(f"\nTop 10 trials (by precision, recall >= {RECALL_FLOOR*100:.0f}%):")
trials = sorted(
    [t for t in study.trials if t.value is not None and t.value > 0],
    key=lambda t: -t.value
)[:10]
for t in trials:
    print(f"  #{t.number:03d}  prec={t.user_attrs['prec']*100:.1f}%  "
          f"rec={t.user_attrs['rec']*100:.1f}%  "
          f"thresh={t.params['threshold']:.3f}  "
          f"decay={t.params['buf_decay']:.3f}  "
          f"str={t.params['buf_strength']:.2f}  "
          f"lr={t.params['lr']:.2e}")
