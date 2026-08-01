"""
poc_trib_hard.py — Hard regime: Xavier vs Orbit-init vs Tribonacci-init

Same hard regime as PoC 8:
  H=64 (bottleneck), sep=1.5σ, C=16, 5000 steps, 20 seeds

Three ternary conditions:
  A. ternary_xavier     — STE ternary, Xavier shadow weights
  B. ternary_orbit      — STE ternary, orbit-pattern {+1,+1,0,+1,-1,0,-1,-1,0}
  C. ternary_tribonacci — STE ternary, Tribonacci-mod-3 pattern {0→0, 1→+1, 2→−1}

Key question: does Tribonacci-init's asymmetry (+1:46%, 0:31%, -1:23%) hurt
relative to orbit's balanced 33/33/33 when capacity is scarce?
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

DEVICE  = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"[device] {DEVICE}" + (f"  ({torch.cuda.get_device_name(0)})" if DEVICE == 'cuda' else ""))

N        = 16
D        = 64
H        = 64
N_TRAIN  = 16000
N_TEST   = 4000
STEPS    = 5000
BATCH    = 512
SEP      = 1.5
N_SEEDS  = 20
SEED     = 42

# ── Tribonacci ────────────────────────────────────────────────────────────────

def tribonacci(n_terms):
    T = [0, 1, 1]
    for _ in range(n_terms - 3):
        T.append(T[-1] + T[-2] + T[-3])
    return T[:n_terms]

# pre-generate enough terms for all weights across all seeds
_MAX_PARAMS = H * D + H + N * H + N
T_SEQ = tribonacci(_MAX_PARAMS * N_SEEDS + 100)
_TRIB_MAP = {0: 0.0, 1: 1.0, 2: -1.0}
TRIB_PATTERN = torch.tensor([_TRIB_MAP[t % 3] for t in T_SEQ], dtype=torch.float32)

# ── Orbit pattern ─────────────────────────────────────────────────────────────

_ORBIT_BLOCK = torch.tensor([+1., +1., 0., +1., -1., 0., -1., -1., 0.])

def orbit_init_(tensor):
    with torch.no_grad():
        n    = tensor.numel()
        flat = _ORBIT_BLOCK.repeat((n // 9) + 1).to(tensor.device)[:n]
        tensor.data = flat[torch.randperm(n, device=tensor.device)].view(tensor.shape)
        tensor.data += torch.randn_like(tensor) * 0.01

def trib_init_(tensor, offset):
    with torch.no_grad():
        n    = tensor.numel()
        flat = TRIB_PATTERN[offset:offset + n].to(tensor.device)
        tensor.data = flat.view(tensor.shape) + torch.randn_like(tensor) * 0.01
    return offset + n

# ── Ternary ops ───────────────────────────────────────────────────────────────

def ternarize(W):
    t = 0.7 * W.abs().mean()
    return (W > t).float() - (W < -t).float()

def ste_ternarize(W):
    return W + (ternarize(W.detach()) - W).detach()

# ── Model ─────────────────────────────────────────────────────────────────────

class MLP(nn.Module):
    def __init__(self, init, trib_offset=0):
        super().__init__()
        self.fc1  = nn.Linear(D, H)
        self.fc2  = nn.Linear(H, N)
        self.init = init
        nn.init.xavier_uniform_(self.fc1.weight); nn.init.zeros_(self.fc1.bias)
        nn.init.xavier_uniform_(self.fc2.weight); nn.init.zeros_(self.fc2.bias)
        if init == 'ternary_orbit':
            orbit_init_(self.fc1.weight)
            orbit_init_(self.fc2.weight)
        elif init == 'ternary_tribonacci':
            off = trib_offset
            off = trib_init_(self.fc1.weight, off)
            off = trib_init_(self.fc2.weight, off)

    def forward(self, x):
        if self.init == 'fp32_glorot':
            return self.fc2(F.relu(self.fc1(x)))
        w1 = ste_ternarize(self.fc1.weight)
        w2 = ste_ternarize(self.fc2.weight)
        return F.linear(F.relu(F.linear(x, w1, self.fc1.bias)), w2, self.fc2.bias)

    def weight_stats(self):
        with torch.no_grad():
            W = ternarize(self.fc1.weight) if self.init != 'fp32_glorot' else self.fc1.weight
            total = W.numel()
            zeros = (W == 0).sum().item()
            pos   = (W > 0).sum().item()
            neg   = (W < 0).sum().item()
        return {'sparsity': zeros/total, 'pos': pos/total, 'neg': neg/total}

# ── Data ──────────────────────────────────────────────────────────────────────

def make_data():
    rng = np.random.default_rng(SEED)
    centers = rng.normal(0, SEP, (N, D))
    per_tr, per_te = N_TRAIN // N, N_TEST // N
    Xtr, ytr, Xte, yte = [], [], [], []
    for k in range(N):
        Xtr.append(rng.normal(centers[k], 1.0, (per_tr, D)))
        ytr.append(np.full(per_tr, k))
        Xte.append(rng.normal(centers[k], 1.0, (per_te, D)))
        yte.append(np.full(per_te, k))
    def prep(X, y, seed_off):
        X = np.vstack(X).astype(np.float32)
        y = np.concatenate(y).astype(np.int64)
        idx = np.random.default_rng(SEED + seed_off).permutation(len(y))
        return torch.from_numpy(X[idx]).to(DEVICE), torch.from_numpy(y[idx]).to(DEVICE)
    return prep(Xtr, ytr, 1), prep(Xte, yte, 2)

# ── Train ─────────────────────────────────────────────────────────────────────

def train_one(init_name, X_tr, y_tr, X_te, y_te, seed):
    torch.manual_seed(seed)
    np.random.seed(seed)
    trib_offset = (seed - SEED) * _MAX_PARAMS  # unique slice per seed
    model = MLP(init_name, trib_offset=trib_offset).to(DEVICE)
    opt   = torch.optim.Adam(model.parameters(), lr=3e-4)
    n     = len(X_tr)
    best_acc = 0.0; step_best = STEPS; acc_curve = []

    for step in range(STEPS):
        idx  = torch.randperm(n, device=DEVICE)[:BATCH]
        loss = F.cross_entropy(model(X_tr[idx]), y_tr[idx])
        opt.zero_grad(); loss.backward(); opt.step()
        if step % 50 == 0:
            model.eval()
            with torch.no_grad():
                acc = (model(X_te).argmax(1) == y_te).float().mean().item()
            acc_curve.append((step, acc))
            if acc > best_acc:
                best_acc = acc; step_best = step
            model.train()

    model.eval()
    with torch.no_grad():
        final = (model(X_te).argmax(1) == y_te).float().mean().item()
    return final, best_acc, step_best, model.weight_stats(), acc_curve

# ── Run ───────────────────────────────────────────────────────────────────────

def run():
    (X_tr, y_tr), (X_te, y_te) = make_data()
    conditions = ['ternary_xavier', 'ternary_orbit', 'ternary_tribonacci']
    agg = {c: {'final': [], 'best': [], 'step_best': [], 'stats': [], 'curves': []}
           for c in conditions}

    print(f"\nH={H} | C={N} | sep={SEP}σ | {STEPS} steps | {N_SEEDS} seeds | {DEVICE}\n")

    for i in range(N_SEEDS):
        seed = SEED + i
        print(f"  seed {seed} ({i+1:>2}/{N_SEEDS})... ", end='', flush=True)
        row = {}
        for cond in conditions:
            final, best, sb, ws, curve = train_one(cond, X_tr, y_tr, X_te, y_te, seed)
            agg[cond]['final'].append(final)
            agg[cond]['best'].append(best)
            agg[cond]['step_best'].append(sb)
            agg[cond]['stats'].append(ws)
            agg[cond]['curves'].append(curve)
            row[cond] = f"{final:.3f}"
        tags = ['xav', 'orb', 'trib']
        print('  '.join(f"{t}={row[c]}" for t, c in zip(tags, conditions)))

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"  HARD REGIME: Xavier vs Orbit vs Tribonacci init")
    print(f"  H={H} | C={N} | sep={SEP}σ | {STEPS} steps | {DEVICE}")
    print(f"{'='*70}")
    for cond in conditions:
        a   = agg[cond]
        fa  = np.array(a['final'])
        ba  = np.array(a['best'])
        sb  = np.array(a['step_best'])
        sp  = np.mean([s['sparsity'] for s in a['stats']])
        pos = np.mean([s['pos']      for s in a['stats']])
        neg = np.mean([s['neg']      for s in a['stats']])
        print(f"\n  [{cond}]")
        print(f"    final:      {fa.mean():.4f} ± {fa.std():.4f}  "
              f"(min {fa.min():.4f}  max {fa.max():.4f})")
        print(f"    best:       {ba.mean():.4f} ± {ba.std():.4f}")
        print(f"    step@best:  {int(sb.mean())} ± {int(sb.std())}")
        print(f"    ternary:    +1={pos:.3f}  0={sp:.3f}  -1={neg:.3f}")

    x_fa  = np.array(agg['ternary_xavier']['final'])
    o_fa  = np.array(agg['ternary_orbit']['final'])
    t_fa  = np.array(agg['ternary_tribonacci']['final'])

    print(f"\n  Head-to-head (final acc, higher = better):")
    print(f"    orbit vs xavier:      {(o_fa > x_fa).mean():.0%} orbit better  gap={np.mean(o_fa-x_fa):+.4f}")
    print(f"    tribonacci vs xavier: {(t_fa > x_fa).mean():.0%} trib better   gap={np.mean(t_fa-x_fa):+.4f}")
    print(f"    orbit vs tribonacci:  {(o_fa > t_fa).mean():.0%} orbit better  gap={np.mean(o_fa-t_fa):+.4f}")

    # ── Plot ──────────────────────────────────────────────────────────────────
    COLORS = {
        'ternary_xavier':      '#ff9800',
        'ternary_orbit':       '#c060ff',
        'ternary_tribonacci':  '#00e5ff',
    }
    fig, axes = plt.subplots(1, 3, figsize=(17, 4))
    fig.suptitle(
        f'Hard Regime: Xavier vs Orbit vs Tribonacci init (ternary)\n'
        f'H={H} | C={N} | sep={SEP}σ | {STEPS} steps | {N_SEEDS} seeds',
        fontsize=10)

    for cond in conditions:
        curves = agg[cond]['curves']
        steps_x = [s for s, _ in curves[0]]
        mat = np.array([[a for _, a in c] for c in curves])
        mu, sd = mat.mean(0), mat.std(0)
        col = COLORS[cond]
        label = cond.replace('ternary_', '')
        axes[0].plot(steps_x, mu, label=label, color=col, alpha=0.9)
        axes[0].fill_between(steps_x, mu - sd, mu + sd, color=col, alpha=0.12)
    axes[0].set_title('Mean accuracy (±1σ)'); axes[0].set_xlabel('Step')
    axes[0].legend(fontsize=8); axes[0].grid(alpha=0.15)

    for cond in conditions:
        axes[1].hist(agg[cond]['final'], bins=12, color=COLORS[cond],
                     alpha=0.6, label=cond.replace('ternary_', ''))
    axes[1].set_title('Final accuracy distribution')
    axes[1].set_xlabel('Accuracy'); axes[1].legend(fontsize=8); axes[1].grid(alpha=0.15)

    for cond in conditions:
        axes[2].hist(agg[cond]['best'], bins=12, color=COLORS[cond],
                     alpha=0.6, label=cond.replace('ternary_', ''))
    axes[2].set_title('Best accuracy distribution')
    axes[2].set_xlabel('Accuracy'); axes[2].legend(fontsize=8); axes[2].grid(alpha=0.15)

    plt.tight_layout()
    out = 'ternary_trib_hard.png'
    plt.savefig(out, dpi=140, bbox_inches='tight')
    print(f"\n  Plot: {out}")
    print(f"{'='*70}")

if __name__ == '__main__':
    run()
