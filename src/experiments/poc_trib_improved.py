"""
poc_trib_improved.py — Two improved Tribonacci init strategies vs baseline

Hard regime: H=64, sep=1.5σ, C=16, 5000 steps, 20 seeds

Four conditions:
  A. ternary_xavier       — STE ternary, Xavier baseline
  B. ternary_orbit        — STE ternary, balanced orbit {+1+1,0,+1,-1,0,-1,-1,0}
  C. trib_permuted_orbit  — orbit VALUES, Zeckendorf-Tribonacci POSITION ordering
  D. trib_magnitude       — orbit VALUES, per-layer magnitude scaled by Tribonacci ratio

B: The problem with raw Tribonacci (mod 3) is distributional skew (Pisano period-13
   gives 1:2:1 ratio for -1:0:+1). Fix: keep orbit's algebraically guaranteed balance,
   use Tribonacci Zeckendorf rank to determine WHICH weight positions get WHICH orbit
   value. Positions that are Tribonacci numbers (1-term Zeckendorf) cluster together;
   2-term sums cluster separately. Creates structured sparsity at Tribonacci-indexed
   positions while preserving 33/33/33 balance.

C: Orbit {-1,0,+1} pattern with non-zero magnitudes scaled by Tribonacci ratio per
   layer depth: fc1 at ±1/φ_T ≈ ±0.544, fc2 at ±1.0. Tests whether Tribonacci growth
   rate gives useful depth-wise scaling of weight stiffness. Later layers (larger |W|)
   need more drift before ternary assignment changes → stiffer. Earlier layers more
   plastic. Hypothesis: gradient flow benefits from asymmetric stiffness profile.
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

N = 16; D = 64; H = 64; N_TRAIN = 16000; N_TEST = 4000
STEPS = 5000; BATCH = 512; SEP = 1.5; N_SEEDS = 20; SEED = 42

PHI_T = 1.8392867552141612  # Tribonacci constant

# ── Tribonacci utils ──────────────────────────────────────────────────────────

def tribonacci(n_terms):
    T = [0, 1, 1]
    for _ in range(n_terms - 3):
        T.append(T[-1] + T[-2] + T[-3])
    return T[:n_terms]

# Distinct Tribonacci numbers (values, not indices): {1, 2, 4, 7, 13, 24, ...}
_TRIB_NUMS = sorted(set(tribonacci(60)[1:]), reverse=True)

def zeckendorf(n):
    """Return list of Tribonacci numbers summing to n (greedy, no repeats)."""
    remaining = n
    terms = []
    for t in _TRIB_NUMS:
        if t <= remaining:
            terms.append(t)
            remaining -= t
    return terms

def zeck_sort_key(pos):
    """Sort key for Zeckendorf-Tribonacci rank of position pos.
    Rank order: fewer terms first, then larger leading terms first.
    Positions that ARE Tribonacci numbers rank lowest (1-term), then 2-term sums, etc.
    """
    terms = zeckendorf(pos + 1)  # 1-indexed so pos=0 → n=1 (a Trib number)
    return (len(terms), tuple(-t for t in terms))

# ── Orbit pattern ─────────────────────────────────────────────────────────────

_ORBIT_BLOCK = [+1., +1., 0., +1., -1., 0., -1., -1., 0.]

# ── Init strategies ───────────────────────────────────────────────────────────

def orbit_init_(tensor):
    """Standard orbit: balanced {+1,+1,0,+1,-1,0,-1,-1,0} tiled, shuffled, + noise."""
    with torch.no_grad():
        n    = tensor.numel()
        tiled = torch.tensor(_ORBIT_BLOCK * ((n // 9) + 1), dtype=torch.float32)[:n]
        perm  = torch.randperm(n)
        tensor.data = tiled[perm].view(tensor.shape).to(tensor.device)
        tensor.data += torch.randn_like(tensor) * 0.01

def trib_permuted_orbit_init_(tensor):
    """Option B: orbit VALUES at Zeckendorf-Tribonacci ranked POSITIONS.

    Assigns orbit values to positions in order of their Zeckendorf rank:
    - positions that ARE Tribonacci numbers get first orbit values
    - 2-term Zeckendorf positions get next batch
    - etc.
    Preserves exact 33/33/33 orbit balance; adds Tribonacci spatial structure.
    """
    with torch.no_grad():
        n = tensor.numel()
        # balanced orbit values
        orbit_vals = torch.tensor(
            _ORBIT_BLOCK * ((n // 9) + 1), dtype=torch.float32)[:n]
        # sort positions by Zeckendorf rank
        positions  = sorted(range(n), key=zeck_sort_key)
        # assign: position positions[rank] gets orbit_vals[rank]
        result = torch.zeros(n)
        for rank, pos in enumerate(positions):
            result[pos] = orbit_vals[rank]
        tensor.data = result.view(tensor.shape).to(tensor.device)
        tensor.data += torch.randn_like(tensor) * 0.01

def trib_magnitude_orbit_init_(tensor, layer_depth, n_layers=2):
    """Option C: orbit VALUES with per-layer magnitude scaling via Tribonacci ratio.

    Layer l (0-indexed) gets non-zero weights scaled by:
        scale = PHI_T^l / PHI_T^(n_layers-1)

    So deepest layer (output side) has magnitude 1.0, shallower layers are
    scaled DOWN by Tribonacci ratio. This creates stiffness gradient:
    deeper layer weights are larger → need more drift to flip ternary assignment →
    deeper layers are stiffer. Hypothesis: plasticity should be higher near input.
    """
    with torch.no_grad():
        n     = tensor.numel()
        scale = (PHI_T ** layer_depth) / (PHI_T ** (n_layers - 1))
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

def ste_ternarize(W):
    return W + (ternarize(W.detach()) - W).detach()

# ── Model ─────────────────────────────────────────────────────────────────────

class MLP(nn.Module):
    def __init__(self, init_name):
        super().__init__()
        self.fc1  = nn.Linear(D, H)
        self.fc2  = nn.Linear(H, N)
        self.init = init_name
        nn.init.xavier_uniform_(self.fc1.weight); nn.init.zeros_(self.fc1.bias)
        nn.init.xavier_uniform_(self.fc2.weight); nn.init.zeros_(self.fc2.bias)
        if init_name == 'ternary_orbit':
            orbit_init_(self.fc1.weight)
            orbit_init_(self.fc2.weight)
        elif init_name == 'trib_permuted_orbit':
            trib_permuted_orbit_init_(self.fc1.weight)
            trib_permuted_orbit_init_(self.fc2.weight)
        elif init_name == 'trib_magnitude':
            trib_magnitude_orbit_init_(self.fc1.weight, layer_depth=0, n_layers=2)
            trib_magnitude_orbit_init_(self.fc2.weight, layer_depth=1, n_layers=2)

    def forward(self, x):
        if self.init == 'ternary_xavier':
            w1 = ste_ternarize(self.fc1.weight)
            w2 = ste_ternarize(self.fc2.weight)
        elif self.init == 'ternary_orbit':
            w1 = ste_ternarize(self.fc1.weight)
            w2 = ste_ternarize(self.fc2.weight)
        elif self.init == 'trib_permuted_orbit':
            w1 = ste_ternarize(self.fc1.weight)
            w2 = ste_ternarize(self.fc2.weight)
        elif self.init == 'trib_magnitude':
            w1 = ste_ternarize(self.fc1.weight)
            w2 = ste_ternarize(self.fc2.weight)
        else:
            w1 = self.fc1.weight
            w2 = self.fc2.weight
        return F.linear(F.relu(F.linear(x, w1, self.fc1.bias)), w2, self.fc2.bias)

    def weight_stats(self):
        with torch.no_grad():
            def stats(w):
                W = ternarize(w)
                n = W.numel()
                return {'sp': (W==0).sum().item()/n,
                        'pos': (W>0).sum().item()/n,
                        'neg': (W<0).sum().item()/n,
                        'mag': w.abs().mean().item()}
            return {'fc1': stats(self.fc1.weight), 'fc2': stats(self.fc2.weight)}

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
    model = MLP(init_name).to(DEVICE)
    opt   = torch.optim.Adam(model.parameters(), lr=3e-4)
    n     = len(X_tr)
    best  = 0.0; step_best = STEPS; curves = []

    for step in range(STEPS):
        idx  = torch.randperm(n, device=DEVICE)[:BATCH]
        loss = F.cross_entropy(model(X_tr[idx]), y_tr[idx])
        opt.zero_grad(); loss.backward(); opt.step()
        if step % 50 == 0:
            model.eval()
            with torch.no_grad():
                acc = (model(X_te).argmax(1) == y_te).float().mean().item()
            curves.append((step, acc))
            if acc > best: best = acc; step_best = step
            model.train()

    model.eval()
    with torch.no_grad():
        final = (model(X_te).argmax(1) == y_te).float().mean().item()
    return final, best, step_best, model.weight_stats(), curves

# ── Run ───────────────────────────────────────────────────────────────────────

def run():
    (X_tr, y_tr), (X_te, y_te) = make_data()

    conditions = ['ternary_xavier', 'ternary_orbit',
                  'trib_permuted_orbit', 'trib_magnitude']
    agg = {c: {'final': [], 'best': [], 'sb': [], 'stats': [], 'curves': []}
           for c in conditions}

    print(f"\nH={H} | C={N} | sep={SEP}σ | {STEPS} steps | {N_SEEDS} seeds | {DEVICE}")
    print(f"Conditions: xavier | orbit | trib-permuted(B) | trib-magnitude(C)\n")

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
        labels = ['xav', 'orb', 'B', 'C']
        print('  '.join(f"{l}={row[c]}" for l, c in zip(labels, conditions)))

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'='*72}")
    print(f"  IMPROVED TRIBONACCI: Permuted-Orbit (B) vs Magnitude-Scaling (C)")
    print(f"  H={H} | C={N} | sep={SEP}σ | {STEPS} steps | {DEVICE}")
    print(f"{'='*72}")

    for cond in conditions:
        a  = agg[cond]
        fa = np.array(a['final']); ba = np.array(a['best']); sb = np.array(a['sb'])
        print(f"\n  [{cond}]")
        print(f"    final:     {fa.mean():.4f} ± {fa.std():.4f}  "
              f"(min {fa.min():.4f}  max {fa.max():.4f})")
        print(f"    best:      {ba.mean():.4f} ± {ba.std():.4f}")
        print(f"    step@best: {int(sb.mean())} ± {int(sb.std())}")
        # weight stats (fc1 only for brevity)
        sp1  = np.mean([s['fc1']['sp']  for s in a['stats']])
        pos1 = np.mean([s['fc1']['pos'] for s in a['stats']])
        neg1 = np.mean([s['fc1']['neg'] for s in a['stats']])
        sp2  = np.mean([s['fc2']['sp']  for s in a['stats']])
        pos2 = np.mean([s['fc2']['pos'] for s in a['stats']])
        neg2 = np.mean([s['fc2']['neg'] for s in a['stats']])
        print(f"    fc1 ternary: +1={pos1:.3f}  0={sp1:.3f}  -1={neg1:.3f}")
        print(f"    fc2 ternary: +1={pos2:.3f}  0={sp2:.3f}  -1={neg2:.3f}")

    x_fa = np.array(agg['ternary_xavier']['final'])
    o_fa = np.array(agg['ternary_orbit']['final'])
    b_fa = np.array(agg['trib_permuted_orbit']['final'])
    c_fa = np.array(agg['trib_magnitude']['final'])

    print(f"\n  Head-to-head vs orbit (the baseline to beat):")
    print(f"    orbit vs xavier:  {(o_fa > x_fa).mean():.0%} orbit better  gap={np.mean(o_fa-x_fa):+.4f}")
    print(f"    B vs orbit:       {(b_fa > o_fa).mean():.0%} B better       gap={np.mean(b_fa-o_fa):+.4f}")
    print(f"    C vs orbit:       {(c_fa > o_fa).mean():.0%} C better       gap={np.mean(c_fa-o_fa):+.4f}")
    print(f"    B vs xavier:      {(b_fa > x_fa).mean():.0%} B better       gap={np.mean(b_fa-x_fa):+.4f}")
    print(f"    C vs xavier:      {(c_fa > x_fa).mean():.0%} C better       gap={np.mean(c_fa-x_fa):+.4f}")

    # Verdicts per improved condition
    for fa, name in [(b_fa, 'B (trib-permuted-orbit)'), (c_fa, 'C (trib-magnitude)')]:
        gap_o = np.mean(fa - o_fa); gap_x = np.mean(fa - x_fa)
        wins_o = (fa > o_fa).mean(); wins_x = (fa > x_fa).mean()
        if gap_o > 0.001 and wins_o > 0.55:
            v = f"BEATS ORBIT — Tribonacci spatial structure adds value"
        elif gap_x > 0.001 and wins_x > 0.55:
            v = f"BEATS XAVIER — better than random init, not better than orbit"
        elif abs(gap_o) <= 0.001:
            v = f"TIES ORBIT — Tribonacci structure is neutral at this scale"
        else:
            v = f"LOSES TO ORBIT — structure doesn't help here"
        print(f"\n  {name}: {v}")

    print(f"{'='*72}")

    # ── Plot ──────────────────────────────────────────────────────────────────
    COLORS = {'ternary_xavier': '#ff9800', 'ternary_orbit': '#c060ff',
              'trib_permuted_orbit': '#00e5ff', 'trib_magnitude': '#00ff88'}
    LABELS = {'ternary_xavier': 'xavier', 'ternary_orbit': 'orbit',
              'trib_permuted_orbit': 'B: trib-permuted', 'trib_magnitude': 'C: trib-magnitude'}

    fig, axes = plt.subplots(1, 3, figsize=(18, 4))
    fig.suptitle(
        f'Improved Tribonacci Inits — Hard Regime\n'
        f'H={H} | C={N} | sep={SEP}σ | {STEPS} steps | {N_SEEDS} seeds',
        fontsize=10)

    for cond in conditions:
        curves = agg[cond]['curves']
        steps_x = [s for s, _ in curves[0]]
        mat = np.array([[a for _, a in c] for c in curves])
        mu, sd = mat.mean(0), mat.std(0)
        col = COLORS[cond]; lbl = LABELS[cond]
        axes[0].plot(steps_x, mu, label=lbl, color=col, alpha=0.9)
        axes[0].fill_between(steps_x, mu - sd, mu + sd, color=col, alpha=0.12)
    axes[0].set_title('Mean accuracy curve (±1σ)'); axes[0].set_xlabel('Step')
    axes[0].legend(fontsize=8); axes[0].grid(alpha=0.15)

    for cond in conditions:
        axes[1].hist(agg[cond]['final'], bins=12, color=COLORS[cond],
                     alpha=0.55, label=LABELS[cond])
    axes[1].set_title('Final accuracy distribution')
    axes[1].set_xlabel('Accuracy'); axes[1].legend(fontsize=8); axes[1].grid(alpha=0.15)

    # sparsity comparison (fc1 at convergence)
    names = [LABELS[c] for c in conditions]
    sp_fc1 = [np.mean([s['fc1']['sp'] for s in agg[c]['stats']]) for c in conditions]
    sp_fc2 = [np.mean([s['fc2']['sp'] for s in agg[c]['stats']]) for c in conditions]
    x_pos = np.arange(len(conditions))
    w = 0.35
    axes[2].bar(x_pos - w/2, sp_fc1, w, label='fc1 sparsity',
                color=[COLORS[c] for c in conditions], alpha=0.8)
    axes[2].bar(x_pos + w/2, sp_fc2, w, label='fc2 sparsity',
                color=[COLORS[c] for c in conditions], alpha=0.4)
    axes[2].set_xticks(x_pos); axes[2].set_xticklabels(names, rotation=15, fontsize=8)
    axes[2].set_title('Final sparsity (fc1=dark, fc2=light)')
    axes[2].set_ylabel('Fraction of zeros'); axes[2].legend(fontsize=8); axes[2].grid(alpha=0.15)

    plt.tight_layout()
    out = 'ternary_trib_improved.png'
    plt.savefig(out, dpi=140, bbox_inches='tight')
    print(f"\n  Plot: {out}")

if __name__ == '__main__':
    # brief sanity check on Zeckendorf sorting
    print("Zeckendorf rank check (first 15 positions):")
    ranked = sorted(range(15), key=zeck_sort_key)
    trib_set = set(_TRIB_NUMS)
    for rank, pos in enumerate(ranked):
        terms = zeckendorf(pos + 1)
        marker = "← Trib#" if (pos + 1) in trib_set else ""
        print(f"  rank {rank:>2}: pos {pos:>3}  (n={pos+1}: {'+'.join(str(t) for t in terms)}) {marker}")
    print()
    run()
