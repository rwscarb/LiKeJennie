"""
Penrose Tribar PoC — Seismology (ETHZ dataset, earthquake vs noise)
ETHZ: Swiss seismic network, ~36K waveforms, 3-component, 400 samples @ 100Hz (4s)
Task: binary classification — earthquake/induced/quarry vs noise
K=128, CYCLES=3, noise sweep σ=[0.0, 0.3, 0.7, 1.0, 1.5]
"""
import torch, torch.nn as nn, torch.optim as optim
import torch.multiprocessing as mp
from torch.utils.data import Dataset, DataLoader
import numpy as np, time, sys
from math import gcd

K      = 128
CYCLES = 3
LR     = 2.42e-4
GATE   = 0.346
EPOCHS = 20
SEEDS  = 3
SIGMAS = [0.0, 0.3, 0.7, 1.0, 1.5]
BATCH  = 512
# Will be set after probing the dataset
N_SAMPLES  = 400
N_CHANNELS = 3
INPUT_DIM  = N_SAMPLES * N_CHANNELS   # 1200; adjusted in main if different

def make_orbit_perm(N):
    from math import gcd
    stride = 5
    while gcd(stride, N) != 1:
        stride += 2
    P = torch.zeros(N, N)
    for j in range(N):
        P[(j * stride) % N, j] = 1.0
    return P

class TribarNet(nn.Module):
    def __init__(self, in_dim, hidden, cycles, gate_init=0.346, n_classes=2):
        super().__init__()
        self.cycles   = cycles
        self.proj_in  = nn.Linear(in_dim, hidden, bias=False)
        self.proj_out = nn.Linear(hidden, n_classes)
        self.gate     = nn.Parameter(torch.full((hidden,), gate_init))
        self.norm     = nn.LayerNorm(hidden)
        self.register_buffer('perm', make_orbit_perm(hidden))

    def forward(self, x, sigma=0.0):
        if sigma > 0:
            x = x + sigma * torch.randn_like(x)
        h = torch.relu(self.proj_in(x))
        for _ in range(self.cycles):
            h = torch.relu(h @ self.perm)
            g = torch.sigmoid(self.gate)
            h = g * h + (1 - g) * h.detach()
            h = self.norm(h)
        return self.proj_out(h), None

class BaselineNet(nn.Module):
    def __init__(self, in_dim, hidden, n_classes=2):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden), nn.ReLU(),
            nn.Linear(hidden, hidden), nn.ReLU(),
            nn.Linear(hidden, hidden), nn.ReLU(),
            nn.Linear(hidden, n_classes),
        )
    def forward(self, x, sigma=0.0):
        if sigma > 0:
            x = x + sigma * torch.randn_like(x)
        return self.net(x), None

class SeismoDataset(Dataset):
    def __init__(self, X, y):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.long)
    def __len__(self): return len(self.y)
    def __getitem__(self, i): return self.X[i], self.y[i]

def load_ethz():
    import seisbench.data as sbd
    print("Loading ETHZ...", flush=True)
    ds = sbd.ETHZ(cache='full')
    meta = ds.metadata

    # Determine waveform length from first valid sample
    sample_wf = None
    for i in range(min(20, len(ds))):
        try:
            w = ds.get_waveforms(i)
            if w is not None and w.ndim == 2 and w.shape[0] == 3:
                sample_wf = w
                break
        except Exception:
            continue
    n_samp = sample_wf.shape[1] if sample_wf is not None else N_SAMPLES
    n_ch   = sample_wf.shape[0] if sample_wf is not None else N_CHANNELS
    in_dim = n_samp * n_ch
    print(f"  waveform shape: ({n_ch}, {n_samp})  →  input_dim={in_dim}", flush=True)

    # Identify earthquake and noise indices
    if 'trace_category' in meta.columns:
        cat_col = 'trace_category'
    elif 'source_type' in meta.columns:
        cat_col = 'source_type'
    else:
        cat_col = None

    eq_cat   = {'earthquake', 'earthquake_local', 'induced', 'quarry_blast'}
    noise_cat = {'noise'}

    if cat_col:
        eq_idx    = meta[meta[cat_col].isin(eq_cat)].index.tolist()
        noise_idx = meta[meta[cat_col].isin(noise_cat)].index.tolist()
    else:
        # Fallback: split by detection_vs_noise column if available
        eq_idx    = list(range(len(meta) // 2))
        noise_idx = list(range(len(meta) // 2, len(meta)))

    print(f"  eq: {len(eq_idx)}  noise: {len(noise_idx)}", flush=True)

    def collect(indices, label, max_n):
        X_out = []
        np.random.shuffle(indices)
        for idx in indices:
            if len(X_out) >= max_n:
                break
            try:
                wf = ds.get_waveforms(idx)
                if wf is None or wf.shape[1] < n_samp or wf.shape[0] < n_ch:
                    continue
                w = wf[:n_ch, :n_samp].astype(np.float32)
                std = w.std(axis=1, keepdims=True) + 1e-8
                w = w / std
                X_out.append(w.flatten())
            except Exception:
                continue
        return X_out

    n_each = min(len(eq_idx), len(noise_idx), 15000)
    print(f"  collecting {n_each} per class...", flush=True)
    X_eq    = collect(list(eq_idx),    1, n_each)
    X_noise = collect(list(noise_idx), 0, n_each)
    n = min(len(X_eq), len(X_noise))
    print(f"  collected {n} eq + {n} noise = {2*n} total", flush=True)

    X = np.array(X_eq[:n] + X_noise[:n])
    y = np.array([1]*n + [0]*n)
    perm = np.random.permutation(len(y))
    return X[perm], y[perm], in_dim

def get_loaders(X, y, val_frac=0.15):
    n = len(y)
    n_val = int(n * val_frac)
    tr = DataLoader(SeismoDataset(X[n_val:], y[n_val:]), batch_size=BATCH, shuffle=True,  num_workers=0)
    va = DataLoader(SeismoDataset(X[:n_val], y[:n_val]), batch_size=BATCH, shuffle=False, num_workers=0)
    return tr, va

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

def worker(args):
    seed, X, y, in_dim, sigmas = args
    torch.manual_seed(seed)
    np.random.seed(seed)
    loaders = get_loaders(X, y)
    out = {}
    for sigma in sigmas:
        torch.manual_seed(seed)
        base = BaselineNet(in_dim, K).cuda()
        acc_base = train_eval(base, loaders, sigma)
        torch.manual_seed(seed)
        tri = TribarNet(in_dim, K, CYCLES, GATE).cuda()
        acc_tri = train_eval(tri, loaders, sigma)
        out[sigma] = (acc_base, acc_tri)
        print(f"  seed={seed} σ={sigma:.1f}  base={acc_base:.2f}%  tri={acc_tri:.2f}%", flush=True)
    return seed, out

if __name__ == '__main__':
    print(f"K={K} CYCLES={CYCLES} lr={LR:.2e} gate={GATE} epochs={EPOCHS} seeds={SEEDS}")
    print(f"sigmas={SIGMAS}\n")

    np.random.seed(42)
    X, y, in_dim = load_ethz()
    print(f"\nDataset: {X.shape}  in_dim={in_dim}  classes: {np.bincount(y)}\n")

    t0 = time.time()
    mp.set_start_method('spawn', force=True)
    job_args = [(s, X, y, in_dim, SIGMAS) for s in range(SEEDS)]
    with mp.Pool(processes=SEEDS) as pool:
        seed_results = pool.map(worker, job_args)

    by_sigma = {s: {'base': [], 'tri': []} for s in SIGMAS}
    for seed, out in seed_results:
        for sigma, (b, t) in out.items():
            by_sigma[sigma]['base'].append(b)
            by_sigma[sigma]['tri'].append(t)

    print(f"\nTotal wall time: {time.time()-t0:.0f}s")
    print("\n" + "="*64)
    print("SUMMARY — ETHZ Seismic  K=128  CYCLES=3  (earthquake vs noise)")
    print("="*64)
    print(f"{'sigma':>6}  {'baseline':>9}  {'tribar_B':>9}  {'gap':>8}")
    for sigma in SIGMAS:
        b = np.mean(by_sigma[sigma]['base'])
        t = np.mean(by_sigma[sigma]['tri'])
        g = t - b
        bar = '█' * max(0, int(abs(g) * 4))
        sign = '+' if g >= 0 else ''
        print(f"{sigma:6.1f}  {b:9.2f}%  {t:9.2f}%  {sign}{g:.2f}% {bar}")
