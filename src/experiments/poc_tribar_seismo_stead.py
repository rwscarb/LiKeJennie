"""
Penrose Tribar PoC — Seismology (STEAD earthquake vs noise detection)
Task: binary classification, seismic waveform vs ambient noise
Input: 3-channel, 3000-sample window (30s @ 100Hz) → 9000-dim flat vector
Architecture: same Tribar (stride-perm, gated skip, LayerNorm) vs baseline MLP
K=128, CYCLES=3, noise sweep σ=[0.0, 0.3, 0.7, 1.0, 1.5]
"""
import torch, torch.nn as nn, torch.optim as optim
import torch.multiprocessing as mp
from torch.utils.data import Dataset, DataLoader
import numpy as np, time, sys
from math import gcd

# ── Config ───────────────────────────────────────────────────────────────────
K      = 128
CYCLES = 3
LR     = 2.42e-4
GATE   = 0.346
EPOCHS = 20
SEEDS  = 3          # 3 seeds — seismo data is heavy
SIGMAS = [0.0, 0.3, 0.7, 1.0, 1.5]
N_SAMPLES  = 3000   # samples per channel (30s @ 100Hz)
N_CHANNELS = 3
INPUT_DIM  = N_SAMPLES * N_CHANNELS   # 9000
N_CLASSES  = 2     # earthquake vs noise
BATCH      = 512
MAX_EVENTS = 20000  # cap per class to keep training fast
DATA_DIR   = '/tmp/seismo_data'

# ── Orbit permutation (stride, valid for any N) ───────────────────────────────
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
    def __init__(self, N, CYCLES, gate_init=0.346, n_classes=2):
        super().__init__()
        self.CYCLES   = CYCLES
        self.proj_in  = nn.Linear(INPUT_DIM, N, bias=False)
        self.proj_out = nn.Linear(N, n_classes)
        self.gate     = nn.Parameter(torch.full((N,), gate_init))
        self.norm     = nn.LayerNorm(N)
        self.register_buffer('perm', make_orbit_perm(N))

    def forward(self, x, sigma=0.0):
        if sigma > 0:
            x = x + sigma * torch.randn_like(x)
        h = torch.relu(self.proj_in(x))
        for _ in range(self.CYCLES):
            h = torch.relu(h @ self.perm)
            g = torch.sigmoid(self.gate)
            h = g * h + (1 - g) * h.detach()
            h = self.norm(h)
        return self.proj_out(h), None

class BaselineNet(nn.Module):
    def __init__(self, N, n_classes=2):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(INPUT_DIM, N), nn.ReLU(),
            nn.Linear(N, N),         nn.ReLU(),
            nn.Linear(N, N),         nn.ReLU(),
            nn.Linear(N, n_classes),
        )
    def forward(self, x, sigma=0.0):
        if sigma > 0:
            x = x + sigma * torch.randn_like(x)
        return self.net(x), None

# ── Dataset ───────────────────────────────────────────────────────────────────
class SeismoDataset(Dataset):
    def __init__(self, X, y):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.long)
    def __len__(self):
        return len(self.y)
    def __getitem__(self, i):
        return self.X[i], self.y[i]

def load_stead(max_per_class=MAX_EVENTS):
    import seisbench.data as sbd
    print("Loading STEAD (earthquake subset)...", flush=True)
    eq = sbd.STEAD(download_kwargs={"chunk": "chunk2"}, cache=None)

    X_eq, X_noise = [], []

    # Earthquake waveforms
    print(f"  sampling up to {max_per_class} earthquake events...", flush=True)
    eq_indices = np.random.permutation(len(eq))[:max_per_class * 2]
    for _i, idx in enumerate(eq_indices):
        if len(X_eq) >= max_per_class:
            break
        if _i % 1000 == 0:
            print(f"    eq iter {_i}, collected {len(X_eq)}", flush=True)
        try:
            wf = eq.get_waveforms(idx)               # (3, T)
            meta = eq.metadata.iloc[idx]
            if meta.get('trace_category', '') != 'earthquake_local':
                continue
            if wf is None or wf.shape[1] < N_SAMPLES:
                continue
            # Normalize per trace
            w = wf[:, :N_SAMPLES].astype(np.float32)
            std = w.std(axis=1, keepdims=True) + 1e-6
            w = w / std
            X_eq.append(w.flatten())
        except Exception as e:
            if _i % 5000 == 0:
                print(f"    eq exception at {_i}: {e}", flush=True)
            continue

    # Noise waveforms
    print(f"  sampling up to {max_per_class} noise events...", flush=True)
    noise_indices = np.random.permutation(len(eq))[:max_per_class * 2]
    for _i, idx in enumerate(noise_indices):
        if len(X_noise) >= max_per_class:
            break
        if _i % 1000 == 0:
            print(f"    noise iter {_i}, collected {len(X_noise)}", flush=True)
        try:
            wf = eq.get_waveforms(idx)
            meta = eq.metadata.iloc[idx]
            if meta.get('trace_category', '') != 'noise':
                continue
            if wf is None or wf.shape[1] < N_SAMPLES:
                continue
            w = wf[:, :N_SAMPLES].astype(np.float32)
            std = w.std(axis=1, keepdims=True) + 1e-6
            w = w / std
            X_noise.append(w.flatten())
        except Exception as e:
            if _i % 5000 == 0:
                print(f"    noise exception at {_i}: {e}", flush=True)
            continue

    n = min(len(X_eq), len(X_noise))
    print(f"  collected: {n} eq, {n} noise", flush=True)
    X = np.array(X_eq[:n] + X_noise[:n])
    y = np.array([1]*n + [0]*n)
    perm = np.random.permutation(len(y))
    return X[perm], y[perm]

def get_loaders(X, y, val_frac=0.15):
    n = len(y)
    n_val = int(n * val_frac)
    X_tr, y_tr = X[n_val:], y[n_val:]
    X_val, y_val = X[:n_val], y[:n_val]
    tr = DataLoader(SeismoDataset(X_tr, y_tr), batch_size=BATCH, shuffle=True,  num_workers=0)
    va = DataLoader(SeismoDataset(X_val, y_val), batch_size=BATCH, shuffle=False, num_workers=0)
    return tr, va

# ── Train + eval ─────────────────────────────────────────────────────────────
def train_eval(model, loaders, sigma):
    train_dl, val_dl = loaders
    opt   = optim.Adam(model.parameters(), lr=LR)
    sched = optim.lr_scheduler.CosineAnnealingLR(opt, T_max=EPOCHS)
    loss_fn = nn.CrossEntropyLoss()
    model.train()
    for _ in range(EPOCHS):
        for xb, yb in train_dl:
            xb, yb = xb.cuda(), yb.cuda()
            out, _ = model(xb, sigma)
            loss = loss_fn(out, yb)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
        sched.step()
    model.eval()
    correct = total = 0
    with torch.no_grad():
        for xb, yb in val_dl:
            xb, yb = xb.cuda(), yb.cuda()
            out, _ = model(xb, sigma)
            correct += (out.argmax(1) == yb).sum().item()
            total   += yb.size(0)
    return 100 * correct / total

# ── Worker ────────────────────────────────────────────────────────────────────
def worker(args):
    seed, X, y, sigmas = args
    torch.manual_seed(seed)
    np.random.seed(seed)
    loaders = get_loaders(X, y)
    out = {}
    for sigma in sigmas:
        torch.manual_seed(seed)
        base = BaselineNet(K).cuda()
        acc_base = train_eval(base, loaders, sigma)
        torch.manual_seed(seed)
        tri = TribarNet(K, CYCLES, GATE).cuda()
        acc_tri = train_eval(tri, loaders, sigma)
        out[sigma] = (acc_base, acc_tri)
        print(f"  seed={seed} σ={sigma:.1f} base={acc_base:.2f}% tri={acc_tri:.2f}%", flush=True)
    return seed, out

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print(f"device: cuda={torch.cuda.is_available()}  K={K} CYCLES={CYCLES} "
          f"lr={LR:.2e} gate={GATE} epochs={EPOCHS} seeds={SEEDS}")
    print(f"input_dim={INPUT_DIM}  task=earthquake_vs_noise  sigmas={SIGMAS}\n")

    np.random.seed(42)
    X, y = load_stead(max_per_class=MAX_EVENTS)
    print(f"Dataset: {X.shape}  classes: {np.bincount(y)}\n")

    t0 = time.time()
    mp.set_start_method('spawn', force=True)

    job_args = [(s, X, y, SIGMAS) for s in range(SEEDS)]
    with mp.Pool(processes=SEEDS) as pool:
        seed_results = pool.map(worker, job_args)

    by_sigma = {s: {'base': [], 'tri': []} for s in SIGMAS}
    for seed, out in seed_results:
        for sigma, (b, t) in out.items():
            by_sigma[sigma]['base'].append(b)
            by_sigma[sigma]['tri'].append(t)

    print(f"\nTotal wall time: {time.time()-t0:.0f}s")
    print("\n" + "="*64)
    print("SUMMARY — STEAD Seismic  K=128  CYCLES=3  (earthquake vs noise)")
    print("="*64)
    print(f"{'sigma':>6}  {'baseline':>9}  {'tribar_B':>9}  {'gap':>8}")
    for sigma in SIGMAS:
        b = np.mean(by_sigma[sigma]['base'])
        t = np.mean(by_sigma[sigma]['tri'])
        g = t - b
        bar = '█' * max(0, int(abs(g) * 4))
        sign = '+' if g >= 0 else ''
        print(f"{sigma:6.1f}  {b:9.2f}%  {t:9.2f}%  {sign}{g:.2f}% {bar}")
