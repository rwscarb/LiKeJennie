"""
ruby PoC 9 — Ternary Weight Quantization: H-Width Sweep
Requires: torch >= 2.0, matplotlib

PoC 7 (easy, H=256): orbit reliable but slow; fp32==xavier
PoC 8 (hard, H=64):  orbit loses (-0.0006 acc, 80% of seeds)

Question: where is the crossover? Does orbit structure help in the wide regime?

Sweep H ∈ {32, 64, 128, 256, 512} on the hard task (sep=1.5σ, C=16).
Fixed: D=64, sep=1.5, C=16, N_TRAIN=16000, STEPS=3000, N_SEEDS=10.

Expected: fp32/xavier cross below some H, orbit has reliability premium above it.

Run:  python3 poc_ternary_sweep.py
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

DEVICE   = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"[device] {DEVICE}" + (f"  ({torch.cuda.get_device_name(0)})" if DEVICE == 'cuda' else ""))

SEED     = 42
N        = 16
D        = 64
N_TRAIN  = 16000
N_TEST   = 4000
STEPS    = 3000
BATCH    = 512
SEP      = 1.5
N_SEEDS  = 10
H_VALUES = [32, 64, 128, 256, 512]
CONDITIONS = ['fp32_glorot', 'ternary_xavier', 'ternary_orbit']
COLORS   = {'fp32_glorot': '#00e5ff', 'ternary_xavier': '#ff9800', 'ternary_orbit': '#c060ff'}


# ── Dataset ────────────────────────────────────────────────────────────────────

def make_data(seed=SEED):
    rng = np.random.default_rng(seed)
    centers = rng.normal(0, SEP, (N, D))
    per_tr, per_te = N_TRAIN // N, N_TEST // N
    Xtr, ytr, Xte, yte = [], [], [], []
    for k in range(N):
        Xtr.append(rng.normal(centers[k], 1.0, (per_tr, D)))
        ytr.append(np.full(per_tr, k))
        Xte.append(rng.normal(centers[k], 1.0, (per_te, D)))
        yte.append(np.full(per_te, k))
    def prep(X, y):
        X = np.vstack(X).astype(np.float32)
        y = np.concatenate(y).astype(np.int64)
        idx = np.random.default_rng(seed + 1).permutation(len(y))
        return torch.from_numpy(X[idx]).to(DEVICE), torch.from_numpy(y[idx]).to(DEVICE)
    return prep(Xtr, ytr), prep(Xte, yte)


# ── Ternary init ───────────────────────────────────────────────────────────────

_ORBIT_BLOCK = torch.tensor([+1., +1., 0., +1., -1., 0., -1., -1., 0.])

def orbit_ternary_init_(tensor):
    with torch.no_grad():
        flat = tensor.view(-1); n = flat.numel()
        tiled = _ORBIT_BLOCK.repeat((n // 9) + 1).to(tensor.device)[:n]
        flat.copy_(tiled[torch.randperm(n, device=tensor.device)])

def ternarize(W):
    thresh = 0.7 * W.abs().mean()
    return (W > thresh).float() - (W < -thresh).float()

def ste_ternarize(W):
    return W + (ternarize(W.detach()) - W).detach()


# ── Model ──────────────────────────────────────────────────────────────────────

class MLP(nn.Module):
    def __init__(self, h, init):
        super().__init__()
        self.fc1 = nn.Linear(D, h)
        self.fc2 = nn.Linear(h, N)
        self.init = init
        for layer in (self.fc1, self.fc2):
            nn.init.xavier_uniform_(layer.weight)
            nn.init.zeros_(layer.bias)
        if init == 'ternary_orbit':
            orbit_ternary_init_(self.fc1.weight)
            orbit_ternary_init_(self.fc2.weight)

    def forward(self, x):
        if self.init == 'fp32':
            return self.fc2(F.relu(self.fc1(x)))
        w1 = ste_ternarize(self.fc1.weight)
        w2 = ste_ternarize(self.fc2.weight)
        return F.linear(F.relu(F.linear(x, w1, self.fc1.bias)), w2, self.fc2.bias)

    def final_sparsity(self):
        with torch.no_grad():
            W = ternarize(self.fc1.weight) if self.init != 'fp32' else self.fc1.weight
            return (W == 0).float().mean().item()


# ── Training ───────────────────────────────────────────────────────────────────

def train_one(h, init_name, X_tr, y_tr, X_te, y_te, seed):
    torch.manual_seed(seed); np.random.seed(seed)
    model = MLP(h, init_name).to(DEVICE)
    opt   = torch.optim.Adam(model.parameters(), lr=3e-4)
    n = len(X_tr)
    for step in range(STEPS):
        idx = torch.randperm(n, device=DEVICE)[:BATCH]
        F.cross_entropy(model(X_tr[idx]), y_tr[idx]).backward()
        opt.step(); opt.zero_grad()
    model.eval()
    with torch.no_grad():
        acc = (model(X_te).argmax(1) == y_te).float().mean().item()
    return acc, model.final_sparsity()


# ── Run ────────────────────────────────────────────────────────────────────────

def run():
    seeds = [SEED + i for i in range(N_SEEDS)]
    (X_tr, y_tr), (X_te, y_te) = make_data()
    print(f"Data: {len(X_tr)} train / {len(X_te)} test | sep={SEP}σ C={N} D={D}\n")

    results = {c: {h: [] for h in H_VALUES} for c in CONDITIONS}
    sparsity = {c: {h: [] for h in H_VALUES} for c in CONDITIONS}

    for h in H_VALUES:
        print(f"H={h:>4}  params={D*h + h*N:>7}  ", end='', flush=True)
        for seed in seeds:
            for cond in CONDITIONS:
                acc, sp = train_one(h, cond, X_tr, y_tr, X_te, y_te, seed)
                results[cond][h].append(acc)
                sparsity[cond][h].append(sp)
        # quick per-H summary
        for cond in CONDITIONS:
            mu = np.mean(results[cond][h])
            print(f"{cond[:3]}={mu:.4f}  ", end='')
        print()

    # ── Summary table ──────────────────────────────────────────────────────────
    print(f"\n{'='*72}")
    print(f"  H-Width Sweep | sep={SEP}σ C={N} D={D} | {STEPS} steps {N_SEEDS} seeds")
    print(f"{'='*72}")
    header = f"  {'H':>5}  " + "  ".join(f"{c:>18}" for c in CONDITIONS)
    print(header)
    print(f"  {'-'*65}")
    for h in H_VALUES:
        row = f"  {h:>5}  "
        gaps = []
        for cond in CONDITIONS:
            mu  = np.mean(results[cond][h])
            std = np.std(results[cond][h])
            row += f"  {mu:.4f}±{std:.4f}    "
            gaps.append(mu)
        delta_ov = gaps[2] - gaps[1]   # orbit - xavier
        delta_of = gaps[2] - gaps[0]   # orbit - fp32
        row += f"  Δ(o-x)={delta_ov:+.4f}"
        print(row)

    print(f"\n  Crossover analysis (orbit vs xavier):")
    for h in H_VALUES:
        o = np.array(results['ternary_orbit'][h])
        x = np.array(results['ternary_xavier'][h])
        wr = np.mean(o > x)
        gap = (o - x).mean()
        sp = np.mean(sparsity['ternary_orbit'][h])
        print(f"    H={h:>4}: orbit wins {wr:.0%} seeds  gap={gap:+.4f}  orbit_sparsity={sp:.3f}")
    print(f"{'='*72}")

    # ── Plot ───────────────────────────────────────────────────────────────────
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    fig.suptitle(
        f'Ternary Weight Quantization — H Width Sweep\n'
        f'sep={SEP}σ | C={N} | D={D} | {STEPS} steps | {N_SEEDS} seeds',
        fontsize=10)

    # Left: accuracy vs H
    ax = axes[0]
    for cond in CONDITIONS:
        mu_h  = [np.mean(results[cond][h]) for h in H_VALUES]
        std_h = [np.std(results[cond][h])  for h in H_VALUES]
        mu_h  = np.array(mu_h); std_h = np.array(std_h)
        c = COLORS[cond]
        ax.plot(H_VALUES, mu_h, 'o-', label=cond, color=c, linewidth=2)
        ax.fill_between(H_VALUES, mu_h-std_h, mu_h+std_h, color=c, alpha=0.15)
    ax.set_xscale('log', base=2)
    ax.set_xticks(H_VALUES); ax.set_xticklabels(H_VALUES)
    ax.set_xlabel('Hidden dim H'); ax.set_ylabel('Final accuracy')
    ax.set_title('Accuracy vs hidden width'); ax.legend(fontsize=9); ax.grid(alpha=0.2)

    # Right: orbit advantage (gap orbit - xavier) vs H
    ax2 = axes[1]
    gap_ov = [(np.mean(results['ternary_orbit'][h]) - np.mean(results['ternary_xavier'][h]))
              for h in H_VALUES]
    gap_of = [(np.mean(results['ternary_orbit'][h]) - np.mean(results['fp32_glorot'][h]))
              for h in H_VALUES]
    sp_orb = [np.mean(sparsity['ternary_orbit'][h]) for h in H_VALUES]

    ax2.axhline(0, color='#888', linestyle='--', alpha=0.5)
    ax2.plot(H_VALUES, gap_ov, 'o-', color='#c060ff', label='orbit − xavier', linewidth=2)
    ax2.plot(H_VALUES, gap_of, 's--', color='#80ff80', label='orbit − fp32', linewidth=1.5, alpha=0.8)
    ax2r = ax2.twinx()
    ax2r.plot(H_VALUES, sp_orb, '^:', color='#ff6060', label='orbit sparsity', alpha=0.7)
    ax2r.set_ylabel('Orbit sparsity (fc1)', color='#ff6060')
    ax2r.tick_params(axis='y', labelcolor='#ff6060')

    ax2.set_xscale('log', base=2)
    ax2.set_xticks(H_VALUES); ax2.set_xticklabels(H_VALUES)
    ax2.set_xlabel('Hidden dim H'); ax2.set_ylabel('Accuracy gap')
    ax2.set_title('Orbit advantage vs width\n(above 0 = orbit wins)')
    lines1, labels1 = ax2.get_legend_handles_labels()
    lines2, labels2 = ax2r.get_legend_handles_labels()
    ax2.legend(lines1+lines2, labels1+labels2, fontsize=8); ax2.grid(alpha=0.2)

    plt.tight_layout()
    plt.savefig('ternary_sweep.png', dpi=140, bbox_inches='tight')
    print('\n  Plot saved: ternary_sweep.png')


if __name__ == '__main__':
    run()
