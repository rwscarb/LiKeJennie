"""
poc_trib_3layer.py — 3-layer network: Xavier vs Orbit vs Trib-Permuted vs Trib-Magnitude

Architecture: D=64 → H1=64 → H2=64 → N=16  (3 linear layers)
Hard regime:  sep=1.5σ, C=16, 5000 steps, 20 seeds

Tribonacci magnitude cascade across 3 layers (C):
  fc1: ±(1/φ_T²) ≈ ±0.296   (most plastic — easiest to flip ternary assignment)
  fc2: ±(1/φ_T)  ≈ ±0.544   (intermediate)
  fc3: ±1.0                   (most stiff — hardest to flip)

Hypothesis: with 3 layers, the stiffness gradient compounds. fc1 becomes a
highly sparse feature extractor; fc3 becomes a stable balanced classifier.
The 2-layer result showed C's fc2 reaching exact 33/33/33 balance — can fc3
do the same, while fc1 pushes past 50% sparsity?
"""

import math
import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

DEVICE  = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"[device] {DEVICE}" + (f"  ({torch.cuda.get_device_name(0)})" if DEVICE == 'cuda' else ""))

N = 16; D = 64; H1 = 64; H2 = 64
N_TRAIN = 16000; N_TEST = 4000
STEPS = 5000; BATCH = 512; SEP = 0.7; N_SEEDS = 20; SEED = 42

PHI_T = 1.8392867552141612

# Xavier-matching global_scale: sets fc1 init mean |W| = Xavier's for the same layer dims.
# Orbit non-zeros are ±s (1/3 zeros), so mean |W| at init = (2/3)*s where s = scale/PHI_T².
# Xavier uniform mean |W| for fan_in=D, fan_out=H1 = sqrt(6/(D+H1))/2.
# Solving: (2/3)*(SCALE_F/PHI_T²) = sqrt(6/(D+H1))/2  →  SCALE_F = PHI_T²*(3/4)*sqrt(6/(D+H1))
# Computed at module level using default D/H1; overrideable per-run if arch changes.
SCALE_F = PHI_T**2 * 0.75 * math.sqrt(6 / (D + H1))

# ── Tribonacci ────────────────────────────────────────────────────────────────

def tribonacci(n_terms):
    T = [0, 1, 1]
    for _ in range(n_terms - 3):
        T.append(T[-1] + T[-2] + T[-3])
    return T[:n_terms]

_TRIB_NUMS = sorted(set(tribonacci(60)[1:]), reverse=True)

def zeckendorf(n):
    remaining = n; terms = []
    for t in _TRIB_NUMS:
        if t <= remaining:
            terms.append(t); remaining -= t
    return terms

def zeck_sort_key(pos):
    terms = zeckendorf(pos + 1)
    return (len(terms), tuple(-t for t in terms))

# ── Orbit ─────────────────────────────────────────────────────────────────────

_ORBIT_BLOCK = [+1., +1., 0., +1., -1., 0., -1., -1., 0.]

def orbit_init_(tensor):
    with torch.no_grad():
        n = tensor.numel()
        tiled = torch.tensor(_ORBIT_BLOCK * ((n // 9) + 1), dtype=torch.float32)[:n]
        perm  = torch.randperm(n)
        tensor.data = tiled[perm].view(tensor.shape).to(tensor.device)
        tensor.data += torch.randn_like(tensor) * 0.01

def trib_permuted_orbit_init_(tensor):
    with torch.no_grad():
        n = tensor.numel()
        orbit_vals = torch.tensor(_ORBIT_BLOCK * ((n // 9) + 1), dtype=torch.float32)[:n]
        positions  = sorted(range(n), key=zeck_sort_key)
        result = torch.zeros(n)
        for rank, pos in enumerate(positions):
            result[pos] = orbit_vals[rank]
        tensor.data = result.view(tensor.shape).to(tensor.device)
        tensor.data += torch.randn_like(tensor) * 0.01

def trib_magnitude_orbit_init_(tensor, layer_depth, n_layers=3, global_scale=1.0):
    """Scale: fc0→1/φ_T², fc1→1/φ_T, fc2→1.0  (Tribonacci growth toward output)."""
    with torch.no_grad():
        n     = tensor.numel()
        scale = (PHI_T ** layer_depth) / (PHI_T ** (n_layers - 1)) * global_scale
        tiled = torch.tensor(_ORBIT_BLOCK * ((n // 9) + 1), dtype=torch.float32)[:n]
        perm  = torch.randperm(n)
        vals  = tiled[perm]
        vals[vals != 0] *= scale
        tensor.data = vals.view(tensor.shape).to(tensor.device)
        tensor.data += torch.randn_like(tensor) * 0.01

# ── Ternary ───────────────────────────────────────────────────────────────────

def ternarize(W):
    t = 0.7 * W.abs().mean()
    return (W > t).float() - (W < -t).float()

def ste_t(W):
    return W + (ternarize(W.detach()) - W).detach()

# ── Model ─────────────────────────────────────────────────────────────────────

class MLP3(nn.Module):
    def __init__(self, init_name):
        super().__init__()
        self.fc1 = nn.Linear(D,  H1)
        self.fc2 = nn.Linear(H1, H2)
        self.fc3 = nn.Linear(H2, N)
        self.init = init_name
        for layer in (self.fc1, self.fc2, self.fc3):
            nn.init.xavier_uniform_(layer.weight); nn.init.zeros_(layer.bias)
        if init_name == 'ternary_orbit':
            for layer in (self.fc1, self.fc2, self.fc3):
                orbit_init_(layer.weight)
        elif init_name == 'trib_magnitude':
            trib_magnitude_orbit_init_(self.fc1.weight, 0, 3)
            trib_magnitude_orbit_init_(self.fc2.weight, 1, 3)
            trib_magnitude_orbit_init_(self.fc3.weight, 2, 3)
        elif init_name == 'trib_magnitude_half':
            trib_magnitude_orbit_init_(self.fc1.weight, 0, 3, global_scale=0.5)
            trib_magnitude_orbit_init_(self.fc2.weight, 1, 3, global_scale=0.5)
            trib_magnitude_orbit_init_(self.fc3.weight, 2, 3, global_scale=0.5)
        elif init_name == 'trib_magnitude_xav':
            trib_magnitude_orbit_init_(self.fc1.weight, 0, 3, global_scale=SCALE_F)
            trib_magnitude_orbit_init_(self.fc2.weight, 1, 3, global_scale=SCALE_F)
            trib_magnitude_orbit_init_(self.fc3.weight, 2, 3, global_scale=SCALE_F)

    def forward(self, x):
        if self.init == 'ternary_xavier':
            h = F.relu(F.linear(x,  ste_t(self.fc1.weight), self.fc1.bias))
            h = F.relu(F.linear(h,  ste_t(self.fc2.weight), self.fc2.bias))
            return F.linear(h, ste_t(self.fc3.weight), self.fc3.bias)
        elif self.init in ('ternary_orbit', 'trib_magnitude', 'trib_magnitude_half', 'trib_magnitude_xav'):
            h = F.relu(F.linear(x,  ste_t(self.fc1.weight), self.fc1.bias))
            h = F.relu(F.linear(h,  ste_t(self.fc2.weight), self.fc2.bias))
            return F.linear(h, ste_t(self.fc3.weight), self.fc3.bias)
        else:
            h = F.relu(self.fc1(x))
            h = F.relu(self.fc2(h))
            return self.fc3(h)

    def weight_stats(self):
        with torch.no_grad():
            def s(w):
                W = ternarize(w); n = W.numel()
                return {'sp': (W==0).sum().item()/n,
                        'pos': (W>0).sum().item()/n,
                        'neg': (W<0).sum().item()/n,
                        'mag': w.abs().mean().item()}
            return {'fc1': s(self.fc1.weight),
                    'fc2': s(self.fc2.weight),
                    'fc3': s(self.fc3.weight)}

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
    def prep(X, y, s):
        X = np.vstack(X).astype(np.float32); y = np.concatenate(y).astype(np.int64)
        idx = np.random.default_rng(SEED + s).permutation(len(y))
        return torch.from_numpy(X[idx]).to(DEVICE), torch.from_numpy(y[idx]).to(DEVICE)
    return prep(Xtr, ytr, 1), prep(Xte, yte, 2)

# ── Train ─────────────────────────────────────────────────────────────────────

def train_one(init_name, X_tr, y_tr, X_te, y_te, seed):
    torch.manual_seed(seed); np.random.seed(seed)
    model = MLP3(init_name).to(DEVICE)
    opt   = torch.optim.Adam(model.parameters(), lr=3e-4)
    n     = len(X_tr); best = 0.0; sb = STEPS; curves = []
    for step in range(STEPS):
        idx  = torch.randperm(n, device=DEVICE)[:BATCH]
        loss = F.cross_entropy(model(X_tr[idx]), y_tr[idx])
        opt.zero_grad(); loss.backward(); opt.step()
        if step % 50 == 0:
            model.eval()
            with torch.no_grad():
                acc = (model(X_te).argmax(1) == y_te).float().mean().item()
            curves.append((step, acc))
            if acc > best: best = acc; sb = step
            model.train()
    model.eval()
    with torch.no_grad():
        final = (model(X_te).argmax(1) == y_te).float().mean().item()
    return final, best, sb, model.weight_stats(), curves

# ── Run ───────────────────────────────────────────────────────────────────────

def run():
    (X_tr, y_tr), (X_te, y_te) = make_data()
    conditions = ['ternary_xavier', 'ternary_orbit',
                  'trib_magnitude', 'trib_magnitude_half', 'trib_magnitude_xav']
    labels     = {'ternary_xavier': 'xav', 'ternary_orbit': 'orb',
                  'trib_magnitude': 'C', 'trib_magnitude_half': 'D',
                  'trib_magnitude_xav': 'F'}
    agg = {c: {'final': [], 'best': [], 'sb': [], 'stats': [], 'curves': []}
           for c in conditions}

    print(f"\nD={D}→H1={H1}→H2={H2}→N={N} | sep={SEP}σ | {STEPS} steps | {N_SEEDS} seeds | {DEVICE}")
    print(f"C magnitude cascade: fc1=±{1/PHI_T**2:.3f}  fc2=±{1/PHI_T:.3f}  fc3=±1.000")
    print(f"D magnitude cascade: fc1=±{0.5/PHI_T**2:.3f}  fc2=±{0.5/PHI_T:.3f}  fc3=±0.500")
    print(f"F magnitude cascade: fc1=±{SCALE_F/PHI_T**2:.3f}  fc2=±{SCALE_F/PHI_T:.3f}  fc3=±{SCALE_F:.3f}  (xavier-matched, scale={SCALE_F:.4f})\n")

    for i in range(N_SEEDS):
        seed = SEED + i
        print(f"  seed {seed} ({i+1:>2}/{N_SEEDS})... ", end='', flush=True)
        row = {}
        for cond in conditions:
            final, best, sb, ws, curves = train_one(cond, X_tr, y_tr, X_te, y_te, seed)
            agg[cond]['final'].append(final)
            agg[cond]['best'].append(best)
            agg[cond]['sb'].append(sb)
            agg[cond]['stats'].append(ws)
            agg[cond]['curves'].append(curves)
            row[cond] = f"{final:.3f}"
        print('  '.join(f"{labels[c]}={row[c]}" for c in conditions))

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'='*72}")
    print(f"  3-LAYER: Xavier | Orbit | C: Trib-Mag-1.0x | D: Trib-Mag-0.5x | F: Trib-Mag-Xav")
    print(f"  D={D}→{H1}→{H2}→{N} | sep={SEP}σ | {STEPS} steps | {DEVICE}")
    print(f"{'='*72}")

    for cond in conditions:
        a = agg[cond]
        fa = np.array(a['final']); ba = np.array(a['best']); sb = np.array(a['sb'])
        print(f"\n  [{cond}]")
        print(f"    final:     {fa.mean():.4f} ± {fa.std():.4f}  "
              f"(min {fa.min():.4f}  max {fa.max():.4f})")
        print(f"    best:      {ba.mean():.4f} ± {ba.std():.4f}")
        print(f"    step@best: {int(sb.mean())} ± {int(sb.std())}")
        for layer in ('fc1', 'fc2', 'fc3'):
            sp  = np.mean([s[layer]['sp']  for s in a['stats']])
            pos = np.mean([s[layer]['pos'] for s in a['stats']])
            neg = np.mean([s[layer]['neg'] for s in a['stats']])
            mag = np.mean([s[layer]['mag'] for s in a['stats']])
            print(f"    {layer}: +1={pos:.3f}  0={sp:.3f}  -1={neg:.3f}  |W|={mag:.3f}")

    x_fa = np.array(agg['ternary_xavier']['final'])
    o_fa = np.array(agg['ternary_orbit']['final'])
    c_fa = np.array(agg['trib_magnitude']['final'])
    d_fa = np.array(agg['trib_magnitude_half']['final'])
    f_fa = np.array(agg['trib_magnitude_xav']['final'])

    print(f"\n  Head-to-head (final acc):")
    for fa, lbl in [(o_fa,'orbit'), (c_fa,'C'), (d_fa,'D'), (f_fa,'F')]:
        print(f"    {lbl} vs xavier: {(fa>x_fa).mean():.0%} better  gap={np.mean(fa-x_fa):+.4f}")
    print(f"    D vs C:        {(d_fa>c_fa).mean():.0%} D better  gap={np.mean(d_fa-c_fa):+.4f}")
    print(f"    F vs C:        {(f_fa>c_fa).mean():.0%} F better  gap={np.mean(f_fa-c_fa):+.4f}")
    print(f"    F vs D:        {(f_fa>d_fa).mean():.0%} F better  gap={np.mean(f_fa-d_fa):+.4f}")
    print(f"{'='*72}")

    # ── Plot ──────────────────────────────────────────────────────────────────
    COLORS = {'ternary_xavier': '#ff9800', 'ternary_orbit': '#c060ff',
              'trib_magnitude': '#00ff88', 'trib_magnitude_half': '#ff4081',
              'trib_magnitude_xav': '#ffe033'}
    PNAMES = {'ternary_xavier': 'xavier', 'ternary_orbit': 'orbit',
              'trib_magnitude': 'C: trib-mag-1.0x', 'trib_magnitude_half': 'D: trib-mag-0.5x',
              'trib_magnitude_xav': f'F: trib-mag-xav ({SCALE_F:.3f}x)'}

    fig, axes = plt.subplots(1, 4, figsize=(22, 4))
    fig.suptitle(
        f'3-Layer Hard Regime: Xavier | Orbit | C: Trib-Mag-1.0x | D: Trib-Mag-0.5x | F: Trib-Mag-Xav ({SCALE_F:.3f}x)\n'
        f'D={D}→{H1}→{H2}→{N} | sep={SEP}σ | {STEPS} steps | {N_SEEDS} seeds',
        fontsize=10)

    # accuracy curves
    for cond in conditions:
        curves = agg[cond]['curves']
        steps_x = [s for s, _ in curves[0]]
        mat = np.array([[a for _, a in c] for c in curves])
        mu, sd = mat.mean(0), mat.std(0)
        axes[0].plot(steps_x, mu, label=PNAMES[cond], color=COLORS[cond], alpha=0.9)
        axes[0].fill_between(steps_x, mu-sd, mu+sd, color=COLORS[cond], alpha=0.12)
    axes[0].set_title('Mean accuracy curve'); axes[0].set_xlabel('Step')
    axes[0].legend(fontsize=7); axes[0].grid(alpha=0.15)

    # final accuracy distribution
    for cond in conditions:
        axes[1].hist(agg[cond]['final'], bins=12,
                     color=COLORS[cond], alpha=0.55, label=PNAMES[cond])
    axes[1].set_title('Final accuracy dist')
    axes[1].set_xlabel('Accuracy'); axes[1].legend(fontsize=7); axes[1].grid(alpha=0.15)

    # per-layer sparsity
    layer_names = ['fc1', 'fc2', 'fc3']
    x_pos = np.arange(len(layer_names))
    n_conds = len(conditions)
    width = 0.15
    for j, cond in enumerate(conditions):
        sp = [np.mean([s[l]['sp'] for s in agg[cond]['stats']]) for l in layer_names]
        axes[2].bar(x_pos + (j - (n_conds - 1) / 2) * width, sp, width,
                    color=COLORS[cond], alpha=0.8, label=PNAMES[cond])
    axes[2].set_xticks(x_pos); axes[2].set_xticklabels(layer_names)
    axes[2].set_title('Sparsity per layer'); axes[2].set_ylabel('Fraction zeros')
    axes[2].legend(fontsize=7); axes[2].grid(alpha=0.15)

    # per-layer |W| magnitude
    for j, cond in enumerate(conditions):
        mag = [np.mean([s[l]['mag'] for s in agg[cond]['stats']]) for l in layer_names]
        axes[3].bar(x_pos + (j - (n_conds - 1) / 2) * width, mag, width,
                    color=COLORS[cond], alpha=0.8, label=PNAMES[cond])
    axes[3].set_xticks(x_pos); axes[3].set_xticklabels(layer_names)
    axes[3].set_title('Mean |W| per layer'); axes[3].set_ylabel('|W| mean')
    axes[3].legend(fontsize=7); axes[3].grid(alpha=0.15)

    plt.tight_layout()
    out = 'ternary_trib_3layer.png'
    plt.savefig(out, dpi=140, bbox_inches='tight')
    print(f"\n  Plot: {out}")

if __name__ == '__main__':
    run()
