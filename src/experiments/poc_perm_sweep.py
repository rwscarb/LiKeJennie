#!/usr/bin/env python3
"""
Permutation Selection Sweep.

Hypothesis: a short warmup run (3 epochs) can predict which permutation
will perform best at full training (30 epochs). If true, we can reliably
land in the 90%+ regime by selecting the best perm from a pool of candidates
instead of running blind 10-seed searches.

Protocol:
  1. Draw N_PERMS=20 candidates: 19 random + orbit perm [0,1,3,7,6,4]
  2. For each candidate: train WARMUP_EPOCHS=3, eval stream-3 prec on mini-val
  3. Select best candidate by warmup prec
  4. Train winner to FULL_EPOCHS=30
  5. Report: warmup ranking vs final prec (does warmup predict final?)

Champion config: BUF_DECAY=0.876, BUF_STRENGTH=1.429, LR=2.78e-3, threshold=0.480
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
FULL_EPOCHS   = 30
WARMUP_EPOCHS = 3
N_PERMS       = 20
SIGMA         = 0.3
SEED          = 42   # dataset/loader seed; perm candidates get their own seeds

BUF_DECAY    = 0.876
BUF_STRENGTH = 1.429
LR           = 2.78e-3
THRESHOLD    = 0.480

STREAM_OFFSETS = [-100, -50, 0, 50]
TRAIN_N_STEPS  = 3

ORBIT_BASE = [0, 1, 3, 7, 6, 4]

def make_orbit_perm(k):
    p = []
    while len(p) < k: p.extend(ORBIT_BASE)
    return torch.tensor(p[:k], dtype=torch.long)

def make_random_perm(k, seed):
    rng = np.random.RandomState(seed)
    return torch.tensor(rng.permutation(k), dtype=torch.long)

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

class PermNet(nn.Module):
    def __init__(self, perm: torch.Tensor):
        super().__init__()
        self.enc = nn.Sequential(ConvBlock(3,32),ConvBlock(32,64),ConvBlock(64,K),nn.AdaptiveAvgPool1d(1))
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
def train_n_epochs(model, tr_dl, dev, n_epochs):
    model.to(dev).train()
    opt = optim.Adam(model.parameters(), lr=LR)
    ce  = nn.CrossEntropyLoss()
    for _ in range(n_epochs):
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
    return model

# ── Eval ──────────────────────────────────────────────────────────────────────
def stream3_prec_rec(model, X_val, y_val, dev, thresh):
    model.eval()
    model.reset_stream()
    with torch.no_grad():
        for t in range(3):
            Xt = torch.tensor(X_val[:, t], dtype=torch.float32).to(dev)
            logits = model(Xt, streaming=True)
    confs = F.softmax(logits, dim=1)[:, 1].cpu().numpy()
    preds = (confs >= thresh).astype(int)
    tp = ((preds==1)&(y_val==1)).sum(); fp = ((preds==1)&(y_val==0)).sum()
    fn = ((preds==0)&(y_val==1)).sum()
    return float(tp/(tp+fp+1e-9)), float(tp/(tp+fn+1e-9))

# ── Main ──────────────────────────────────────────────────────────────────────
torch.manual_seed(SEED); np.random.seed(SEED)

print(f"device={DEVICE}  K={K}  N_PERMS={N_PERMS}  WARMUP={WARMUP_EPOCHS}  FULL={FULL_EPOCHS}")
print(f"champion config: decay={BUF_DECAY}  strength={BUF_STRENGTH}  lr={LR}  threshold={THRESHOLD}")
print(f"candidates: 1 orbit + {N_PERMS-1} random")
print()

t0 = time.time()
print("Loading multi-offset dataset...")
X_multi, y, mags = load_streaming_data()
n = len(y); SPLIT = int(n*0.85)
X_val, y_val = X_multi[SPLIT:], y[SPLIT:]
print(f"Dataset: {n} total  ({y.sum()} eq, {(y==0).sum()} noise)\n")

tr_dl, _, _ = make_loaders(X_multi, y, mags)

# Build candidate pool: orbit first, then N-1 randoms
candidates = [('orbit', make_orbit_perm(K))]
for i in range(N_PERMS - 1):
    candidates.append((f'rand_{i:02d}', make_random_perm(K, seed=1000+i)))

# ── Warmup sweep ──────────────────────────────────────────────────────────────
print(f"{'='*65}")
print(f"PHASE 1 — WARMUP SWEEP ({WARMUP_EPOCHS} epochs each)")
print(f"{'='*65}")

warmup_results = []
for name, perm in candidates:
    torch.manual_seed(SEED)
    model = PermNet(perm)
    t_start = time.time()
    train_n_epochs(model, tr_dl, DEVICE, WARMUP_EPOCHS)
    p, r = stream3_prec_rec(model, X_val, y_val, DEVICE, THRESHOLD)
    elapsed = int(time.time() - t_start)
    warmup_results.append({'name': name, 'perm': perm, 'prec': p, 'rec': r, 'model': model})
    print(f"  [{name:>8}]  warmup prec={p*100:.1f}%  rec={r*100:.1f}%  ({elapsed}s)", flush=True)

warmup_results.sort(key=lambda x: x['prec'], reverse=True)
best = warmup_results[0]
print(f"\n  Winner: {best['name']}  warmup prec={best['prec']*100:.1f}%  rec={best['rec']*100:.1f}%")

# ── Full train winner ─────────────────────────────────────────────────────────
print(f"\n{'='*65}")
print(f"PHASE 2 — FULL TRAINING of winner: {best['name']} ({FULL_EPOCHS} epochs)")
print(f"{'='*65}")

torch.manual_seed(SEED)
winner_model = PermNet(best['perm'])
t_full = time.time()
train_n_epochs(winner_model, tr_dl, DEVICE, FULL_EPOCHS)
final_p, final_r = stream3_prec_rec(winner_model, X_val, y_val, DEVICE, THRESHOLD)
full_elapsed = int(time.time() - t_full)
print(f"  Final result: prec={final_p*100:.2f}%  rec={final_r*100:.2f}%  ({full_elapsed}s)")

torch.save(winner_model.state_dict(), 'perm_sweep_best.pt')
print(f"  Saved: perm_sweep_best.pt  (perm={best['name']})")

elapsed = int(time.time() - t0)
print(f"\nTotal wall time: {elapsed}s  ({elapsed//60}m {elapsed%60}s)")

# ── Summary ───────────────────────────────────────────────────────────────────
print(f"\n{'='*65}")
print(f"PERM SWEEP SUMMARY")
print(f"{'='*65}")
print(f"{'rank':>5}  {'name':>10}  {'warmup%':>8}  {'warmup rec':>10}")
print(f"{'-'*45}")
for rank, r in enumerate(warmup_results, 1):
    flag = '  ← selected' if rank == 1 else ''
    print(f"  {rank:>3}  {r['name']:>10}  {r['prec']*100:>8.1f}%  {r['rec']*100:>10.1f}%{flag}")

print(f"\nSelected perm : {best['name']}")
print(f"Warmup prec   : {best['prec']*100:.1f}%  rec={best['rec']*100:.1f}%")
print(f"Final prec    : {final_p*100:.2f}%  rec={final_r*100:.2f}%")
print(f"Warmup→Final  : {(final_p-best['prec'])*100:+.1f}pp")
print()
print("Did warmup rank predict final quality?")
print(f"  Best warmup score → final {final_p*100:.1f}% (vs orbit ceiling 92.0%, random best 90.0%)")
print()
print(f"Orbit perm warmup rank: "
      f"{next(i+1 for i,r in enumerate(warmup_results) if r['name']=='orbit')}"
      f" / {N_PERMS}")
