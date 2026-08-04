"""
Penrose Tribar PoC — Early Seismic Detection
Task: detect P-wave onset before S-wave arrives (the destructive wave)
      The earlier we can classify, the more warning time issued.

Detection windows tested (all starting AT p_arrival_sample):
  - W_1s  : 1.0s = 100 samples  (pre-S, minimum alert window)
  - W_2s  : 2.0s = 200 samples
  - W_5s  : 5.0s = 500 samples
  - W_full: 30.0s = 3000 samples (baseline reference from full-window run)

Noise windows: equal-length clips from trace start (before P-wave).
Result: accuracy at each window width → earlier = harder, tribar gap shows
        how much the orbit structure helps under temporal compression.
"""
import torch, torch.nn as nn, torch.optim as optim
import numpy as np, time, sys
from math import gcd
from torch.utils.data import Dataset, DataLoader

# ── Config ───────────────────────────────────────────────────────────────────
K          = 128
CYCLES     = 3
LR         = 2.42e-4
GATE       = 0.346
EPOCHS     = 20
SEEDS      = 3
SIGMA      = 0.3         # ambient noise level (best-case window from full run)
N_CH       = 3
MAX_EVENTS = 8000        # per class per window — keeps total training fast
BATCH      = 512
DATA_DIR   = '/tmp/seismo_data'

WINDOWS = [
    ('1s',   100),
    ('2s',   200),
    ('5s',   500),
    ('10s', 1000),
]

# ── Orbit permutation ─────────────────────────────────────────────────────────
def make_orbit_perm(N):
    stride = 5
    while gcd(stride, N) != 1:
        stride += 2
    P = torch.zeros(N, N)
    for j in range(N):
        P[(j * stride) % N, j] = 1.0
    return P

# ── Models ────────────────────────────────────────────────────────────────────
class TribarNet(nn.Module):
    def __init__(self, input_dim, n_classes=2):
        super().__init__()
        self.proj_in  = nn.Linear(input_dim, K, bias=False)
        self.proj_out = nn.Linear(K, n_classes)
        self.gate     = nn.Parameter(torch.full((K,), GATE))
        self.norm     = nn.LayerNorm(K)
        self.register_buffer('perm', make_orbit_perm(K))

    def forward(self, x, sigma=0.0):
        if sigma > 0:
            x = x + sigma * torch.randn_like(x)
        h = torch.relu(self.proj_in(x))
        for _ in range(CYCLES):
            h = torch.relu(h @ self.perm)
            g = torch.sigmoid(self.gate)
            h = g * h + (1 - g) * h.detach()
            h = self.norm(h)
        return self.proj_out(h)

class BaselineNet(nn.Module):
    def __init__(self, input_dim, n_classes=2):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, K), nn.ReLU(),
            nn.Linear(K, K),         nn.ReLU(),
            nn.Linear(K, K),         nn.ReLU(),
            nn.Linear(K, n_classes),
        )
    def forward(self, x, sigma=0.0):
        if sigma > 0:
            x = x + sigma * torch.randn_like(x)
        return self.net(x)

# ── Dataset ───────────────────────────────────────────────────────────────────
class WindowDataset(Dataset):
    def __init__(self, X, y):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.long)
    def __len__(self): return len(self.y)
    def __getitem__(self, i): return self.X[i], self.y[i]

# ── STEAD loader: P-wave early detection windows ──────────────────────────────
def load_windows(win_samples, max_per_class=MAX_EVENTS):
    import seisbench.data as sbd
    eq = sbd.STEAD(download_kwargs={"chunk": "chunk2"}, cache=None)
    X_eq, X_noise = [], []

    # P-wave windows starting at p_arrival_sample
    indices = np.random.permutation(len(eq))[:max_per_class * 4]
    for _i, idx in enumerate(indices):
        if len(X_eq) >= max_per_class and len(X_noise) >= max_per_class:
            break
        if _i % 2000 == 0:
            print(f"    iter {_i} | eq={len(X_eq)} noise={len(X_noise)}", flush=True)
        try:
            meta = eq.metadata.iloc[idx]
            cat  = meta.get('trace_category', '')
            wf   = eq.get_waveforms(idx)  # (3, T)
            if wf is None or wf.shape[1] < 3000:
                continue

            if cat == 'earthquake_local' and len(X_eq) < max_per_class:
                p_samp = int(meta.get('p_arrival_sample', 0) or 0)
                # Clip: need p_samp + win_samples within waveform
                if p_samp + win_samples > wf.shape[1]:
                    p_samp = max(0, wf.shape[1] - win_samples)
                w = wf[:, p_samp : p_samp + win_samples].astype(np.float32)
                if w.shape[1] < win_samples:
                    continue
                std = w.std(axis=1, keepdims=True) + 1e-6
                X_eq.append((w / std).flatten())

            elif cat == 'noise' and len(X_noise) < max_per_class:
                # Noise: clip from a random position well before any arrival
                start = np.random.randint(0, max(1, wf.shape[1] - win_samples))
                w = wf[:, start : start + win_samples].astype(np.float32)
                if w.shape[1] < win_samples:
                    continue
                std = w.std(axis=1, keepdims=True) + 1e-6
                X_noise.append((w / std).flatten())

        except Exception:
            continue

    n = min(len(X_eq), len(X_noise))
    print(f"    collected: {n} eq, {n} noise", flush=True)
    X = np.array(X_eq[:n] + X_noise[:n])
    y = np.array([1]*n + [0]*n)
    perm = np.random.permutation(len(y))
    return X[perm], y[perm]

def get_loaders(X, y, val_frac=0.15):
    n = len(y)
    split = int(n * (1 - val_frac))
    tr = WindowDataset(X[:split], y[:split])
    va = WindowDataset(X[split:], y[split:])
    return (DataLoader(tr, batch_size=BATCH, shuffle=True, num_workers=0),
            DataLoader(va, batch_size=BATCH, shuffle=False, num_workers=0))

# ── Train / eval ──────────────────────────────────────────────────────────────
def train_eval(model, loaders, dev):
    model.to(dev)
    opt = optim.Adam(model.parameters(), lr=LR)
    ce  = nn.CrossEntropyLoss()
    train_dl, val_dl = loaders
    for _ in range(EPOCHS):
        model.train()
        for xb, yb in train_dl:
            xb, yb = xb.to(dev), yb.to(dev)
            logits = model(xb, sigma=SIGMA)
            loss   = ce(logits, yb)
            opt.zero_grad(); loss.backward(); opt.step()
    model.eval()
    correct = total = 0
    with torch.no_grad():
        for xb, yb in val_dl:
            xb, yb = xb.to(dev), yb.to(dev)
            correct += (model(xb).argmax(1) == yb).sum().item()
            total   += len(yb)
    return correct / total * 100

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"device: cuda={torch.cuda.is_available()}  K={K}  CYCLES={CYCLES}")
    print(f"sigma={SIGMA}  epochs={EPOCHS}  seeds={SEEDS}")
    print(f"windows: {[w for w,_ in WINDOWS]} (samples: {[s for _,s in WINDOWS]})\n")

    results = {}
    t0 = time.time()

    for win_label, win_samples in WINDOWS:
        input_dim = win_samples * N_CH
        print(f"\n── Window {win_label} ({win_samples} samples, input_dim={input_dim}) ──", flush=True)
        X, y = load_windows(win_samples)
        loaders = get_loaders(X, y)

        base_accs, tri_accs = [], []
        for seed in range(SEEDS):
            torch.manual_seed(seed); np.random.seed(seed)
            base = BaselineNet(input_dim)
            tri  = TribarNet(input_dim)
            b = train_eval(base, loaders, dev)
            t = train_eval(tri,  loaders, dev)
            base_accs.append(b); tri_accs.append(t)
            print(f"  seed={seed}  base={b:.2f}%  tri={t:.2f}%  gap={t-b:+.2f}%", flush=True)

        results[win_label] = (np.mean(base_accs), np.mean(tri_accs))

    wall = time.time() - t0
    print(f"\nTotal wall time: {wall:.0f}s")

    print("\n" + "=" * 64)
    print(f"SUMMARY — Early Detection  K={K}  CYCLES={CYCLES}  σ={SIGMA}")
    print("=" * 64)
    # Reference from full-window run
    REF = {'full 30s': (67.42, 69.71)}
    all_rows = list(results.items()) + list(REF.items())
    bar_max = max(t - b for _, (b, t) in all_rows)
    print(f" {'window':<10} {'baseline':>10} {'tribar':>10} {'gap':>8}  chart")
    print(f" {'-'*10} {'-'*10} {'-'*10} {'-'*8}  -----")
    for label, (b, t) in all_rows:
        gap   = t - b
        bar   = int(round(gap / bar_max * 10)) if bar_max > 0 else 0
        sign  = '+' if gap >= 0 else ''
        print(f" {label:<10} {b:>9.2f}% {t:>9.2f}% {sign}{gap:>6.2f}%  {'█'*bar}")
