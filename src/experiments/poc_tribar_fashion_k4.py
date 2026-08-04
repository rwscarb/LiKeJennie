"""
Penrose Tribar PoC — Fashion-MNIST, K=4 (SUPERSEDED by poc_tribar_fashion_k32.py)
Finding: K=4 baseline is capacity-floored (~16% ≈ random on Fashion-MNIST),
making the noise-robustness comparison meaningless. Tribar showed +9% at σ=0
but this was a structural artifact, not signal.
Use poc_tribar_fashion_k32.py for the proper experiment.
- batch=4096, parallel seeds via multiprocessing
Best hyperparams from Optuna (MNIST): K=4, CYCLES=3, lr=2.42e-04, gate=0.346
"""
import torch, torch.nn as nn, torch.optim as optim
import torch.multiprocessing as mp
from torchvision import datasets, transforms
from torch.utils.data import DataLoader
import numpy as np, time, sys

# ── Orbit permutation ────────────────────────────────────────────────────────
def make_orbit_perm(N):
    ORBIT = [1, 2, 4, 8, 7, 5]
    idx = [ORBIT[i % 6] % N for i in range(N)]
    P = torch.zeros(N, N)
    for j, i in enumerate(idx):
        P[i, j] = 1.0
    return P

INPUT_DIM = 784

# ── Models ────────────────────────────────────────────────────────────────────
class TribarNet(nn.Module):
    def __init__(self, N, CYCLES, gate_init=0.346):
        super().__init__()
        self.CYCLES = CYCLES
        self.proj_in  = nn.Linear(INPUT_DIM, N, bias=False)
        self.proj_out = nn.Linear(N, 10)
        self.out_a    = nn.Linear(N, 10)
        self.gate     = nn.Parameter(torch.full((N,), gate_init))
        self.norm     = nn.LayerNorm(N)
        self.register_buffer('perm', make_orbit_perm(N))

    def forward(self, x, sigma=0.0):
        h = torch.relu(self.proj_in(x))
        arm_a = None
        for c in range(self.CYCLES):
            h = torch.relu(h @ self.perm)
            if sigma > 0:
                h = h + sigma * torch.randn_like(h)
            g = torch.sigmoid(self.gate)
            h = g * h + (1 - g) * h.detach()
            h = self.norm(h)
            if c == 0:
                arm_a = self.out_a(h)
        return self.proj_out(h), arm_a

class BaselineNet(nn.Module):
    def __init__(self, N):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(INPUT_DIM, N), nn.ReLU(),
            nn.Linear(N, N), nn.ReLU(),
            nn.Linear(N, N), nn.ReLU(),
            nn.Linear(N, 10),
        )
    def forward(self, x, sigma=0.0):
        if sigma > 0:
            x = x + sigma * torch.randn_like(x)
        return self.net(x), None

# ── Data (shared, loaded once per worker) ────────────────────────────────────
def get_loaders(batch=4096):
    tf = transforms.Compose([transforms.ToTensor(),
                              transforms.Normalize((0.2860,), (0.3530,))])
    tr = datasets.FashionMNIST('/tmp/fmnist', train=True,  download=False, transform=tf)
    te = datasets.FashionMNIST('/tmp/fmnist', train=False, download=False, transform=tf)
    # num_workers=0: avoids daemon-child conflict when called inside Pool workers
    kw = dict(num_workers=0, pin_memory=True)
    return (DataLoader(tr, batch_size=batch, shuffle=True,  **kw),
            DataLoader(te, batch_size=2048,  shuffle=False, **kw))

# ── Train + eval ─────────────────────────────────────────────────────────────
def train_eval(model, loaders, lr, epochs, sigma, use_a=False):
    train_dl, test_dl = loaders
    opt  = optim.Adam(model.parameters(), lr=lr)
    sched = optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
    loss_fn = nn.CrossEntropyLoss()
    model.train()
    for _ in range(epochs):
        for xb, yb in train_dl:
            xb = xb.view(-1, INPUT_DIM).cuda()
            yb = yb.cuda()
            ob, oa = model(xb, sigma)
            logits = oa if (use_a and oa is not None) else ob
            loss = loss_fn(logits, yb)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
        sched.step()
    model.eval()
    correct = total = 0
    with torch.no_grad():
        for xb, yb in test_dl:
            xb = xb.view(-1, INPUT_DIM).cuda()
            yb = yb.cuda()
            ob, oa = model(xb, sigma)
            logits = oa if (use_a and oa is not None) else ob
            correct += (logits.argmax(1) == yb).sum().item()
            total   += yb.size(0)
    return 100 * correct / total

# ── Worker: train one seed across all sigmas ─────────────────────────────────
def worker(args):
    seed, K, CYCLES, LR, GATE, EPOCHS, SIGMAS = args
    torch.manual_seed(seed)
    np.random.seed(seed)
    loaders = get_loaders()
    out = {}
    for sigma in SIGMAS:
        torch.manual_seed(seed)
        base = BaselineNet(K).cuda()
        acc_base = train_eval(base, loaders, LR, EPOCHS, sigma, use_a=False)
        torch.manual_seed(seed)
        tri = TribarNet(K, CYCLES, GATE).cuda()
        acc_tri = train_eval(tri, loaders, LR, EPOCHS, sigma, use_a=True)
        out[sigma] = (acc_base, acc_tri)
    return seed, out

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    K      = 4
    CYCLES = 3
    LR     = 2.42e-4
    GATE   = 0.346
    EPOCHS = 15
    SEEDS  = 5
    SIGMAS = [0.0, 0.3, 0.7, 1.0, 1.5]

    print(f"device: cuda={torch.cuda.is_available()}  K={K} CYCLES={CYCLES} "
          f"lr={LR:.2e} gate={GATE} epochs={EPOCHS} seeds={SEEDS} batch=4096")
    print(f"sigmas={SIGMAS}\n")

    # Pre-download once in main process
    tf = transforms.Compose([transforms.ToTensor(),
                              transforms.Normalize((0.2860,), (0.3530,))])
    datasets.FashionMNIST('/tmp/fmnist', train=True,  download=True, transform=tf)
    datasets.FashionMNIST('/tmp/fmnist', train=False, download=True, transform=tf)

    t0 = time.time()
    mp.set_start_method('spawn', force=True)

    job_args = [(s, K, CYCLES, LR, GATE, EPOCHS, SIGMAS) for s in range(SEEDS)]
    with mp.Pool(processes=SEEDS) as pool:
        seed_results = pool.map(worker, job_args)

    # Aggregate
    by_sigma = {s: {'base': [], 'tri': []} for s in SIGMAS}
    for seed, out in seed_results:
        for sigma, (b, t) in out.items():
            by_sigma[sigma]['base'].append(b)
            by_sigma[sigma]['tri'].append(t)

    print(f"\nTotal wall time: {time.time()-t0:.0f}s")
    print("\n" + "="*62)
    print("SUMMARY — Fashion-MNIST  K=4  CYCLES=3  (Optuna best)")
    print("="*62)
    print(f"{'sigma':>6}  {'baseline':>9}  {'tribar_A':>9}  {'gap':>8}")
    for sigma in SIGMAS:
        b = np.mean(by_sigma[sigma]['base'])
        t = np.mean(by_sigma[sigma]['tri'])
        g = t - b
        bar = '█' * int(abs(g) * 4) if abs(g) >= 0.25 else '·'
        sign = '+' if g >= 0 else ''
        print(f"{sigma:6.1f}  {b:9.2f}%  {t:9.2f}%  {sign}{g:.2f}% {bar}")
