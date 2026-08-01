"""
ruby PoC 8 — Ternary Weight Quantization: Hard Regime
Requires: torch >= 2.0, matplotlib

Harder than PoC 7 on three axes simultaneously:
  H=64    (bottleneck: same width as input, parameter efficiency matters)
  sep=1.5σ (overlapping clusters, harder decision boundary)
  C=16    (more classes, fewer samples per cluster)

PoC 7 result: easy task floated all three to the ceiling.
  - orbit was SLOWER to 99% but MORE RELIABLE to 100% (18/20 vs 8/20)
  - fp32 == ternary_xavier (task too easy for quantization to matter)
  - orbit's stiffness (shadow weights start at ±1, hard to flip) caused slow start

Hard regime tests whether:
  a) orbit's structured sparsity is an advantage when capacity is scarce
  b) the slow-start penalty becomes fatal when the task is difficult
  c) the reliability premium persists or collapses under pressure

Conditions:
  A. fp32_glorot     — full precision, Xavier init
  B. ternary_xavier  — STE ternary, Xavier shadow weights
  C. ternary_orbit   — STE ternary, orbit-pattern init {-1,0,+1}

Run:  python3 poc_ternary_hard.py
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

DEVICE   = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"[device] {DEVICE}" + (f"  ({torch.cuda.get_device_name(0)})" if DEVICE == 'cuda' else "  (no CUDA)"))

SEED     = 42
N        = 16       # classes (doubled from PoC 7)
D        = 64       # input dimension
H        = 64       # hidden dim (bottleneck: same as D, was 256 in PoC 7)
N_TRAIN  = 16000    # 1000 per cluster
N_TEST   = 4000
STEPS    = 5000     # more steps for harder task
BATCH    = 512
SEP      = 1.5      # tighter clusters (was 3.0 in PoC 7)
N_SEEDS  = 20


# ── Dataset ────────────────────────────────────────────────────────────────────

def make_gaussian_mixture(n_train, n_test, n_clusters, d, separation, seed=SEED):
    """Shared cluster centers — train and test from the SAME geometry."""
    rng = np.random.default_rng(seed)
    centers = rng.normal(0, separation, (n_clusters, d))
    per_tr, per_te = n_train // n_clusters, n_test // n_clusters
    Xtr, ytr, Xte, yte = [], [], [], []
    for k in range(n_clusters):
        Xtr.append(rng.normal(centers[k], 1.0, (per_tr, d)))
        ytr.append(np.full(per_tr, k))
        Xte.append(rng.normal(centers[k], 1.0, (per_te, d)))
        yte.append(np.full(per_te, k))
    def prep(X, y):
        X = np.vstack(X).astype(np.float32)
        y = np.concatenate(y).astype(np.int64)
        idx = np.random.default_rng(seed + 1).permutation(len(y))
        return (torch.from_numpy(X[idx]).to(DEVICE),
                torch.from_numpy(y[idx]).to(DEVICE))
    return prep(Xtr, ytr), prep(Xte, yte)


# ── Ternary init ───────────────────────────────────────────────────────────────

# Orbit map for one block of 9 (0-indexed positions → orbit values 1..9):
# pos 0→val1→+1, pos1→val2→+1, pos2→val3→0,
# pos3→val4→+1, pos4→val5→-1, pos5→val6→0,
# pos6→val7→-1, pos7→val8→-1, pos8→val9→0
_ORBIT_BLOCK = torch.tensor([+1., +1., 0., +1., -1., 0., -1., -1., 0.])


def orbit_ternary_init_(tensor):
    """Orbit-structured {-1,0,+1}: every 9-weight block has exactly 3 of each."""
    with torch.no_grad():
        flat = tensor.view(-1)
        n    = flat.numel()
        tiled = _ORBIT_BLOCK.repeat((n // 9) + 1).to(tensor.device)[:n]
        flat.copy_(tiled[torch.randperm(n, device=tensor.device)])


def ternarize(W):
    thresh = 0.7 * W.abs().mean()
    return (W > thresh).float() - (W < -thresh).float()


def ste_ternarize(W):
    return W + (ternarize(W.detach()) - W).detach()


# ── Model ──────────────────────────────────────────────────────────────────────

class MLP(nn.Module):
    def __init__(self, d_in, d_hid, d_out, init='fp32'):
        super().__init__()
        self.fc1  = nn.Linear(d_in,  d_hid)
        self.fc2  = nn.Linear(d_hid, d_out)
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

    def weight_stats(self):
        with torch.no_grad():
            W = ternarize(self.fc1.weight) if self.init != 'fp32' else self.fc1.weight
            total = W.numel()
            zeros = (W == 0).sum().item()
            pos   = (W >  0).sum().item()
            neg   = (W <  0).sum().item()
        return {'sparsity': zeros/total, 'balance': min(pos,neg)/max(pos,neg,1)}


# ── Training ───────────────────────────────────────────────────────────────────

def train_one(init_name, X_train, y_train, X_test, y_test, seed):
    torch.manual_seed(seed)
    np.random.seed(seed)
    model = MLP(D, H, N, init=init_name).to(DEVICE)
    opt   = torch.optim.Adam(model.parameters(), lr=3e-4)
    n     = len(X_train)
    best_acc = 0.0
    step_best = STEPS
    acc_curve = []

    for step in range(STEPS):
        idx = torch.randperm(n, device=DEVICE)[:BATCH]
        loss = F.cross_entropy(model(X_train[idx]), y_train[idx])
        opt.zero_grad(); loss.backward(); opt.step()

        if step % 50 == 0:
            model.eval()
            with torch.no_grad():
                acc = (model(X_test).argmax(1) == y_test).float().mean().item()
            acc_curve.append((step, acc))
            if acc > best_acc:
                best_acc = acc
                step_best = step
            model.train()

    model.eval()
    with torch.no_grad():
        final_acc = (model(X_test).argmax(1) == y_test).float().mean().item()

    return final_acc, best_acc, step_best, model.weight_stats(), acc_curve


# ── Run ────────────────────────────────────────────────────────────────────────

def run():
    seeds = [SEED + i for i in range(N_SEEDS)]
    print(f"\nGenerating data (shared centers, sep={SEP}σ, C={N})...")
    (X_tr, y_tr), (X_te, y_te) = make_gaussian_mixture(N_TRAIN, N_TEST, N, D, SEP)
    print(f"  Train: {len(X_tr)}  Test: {len(X_te)}")
    print(f"\n{N_SEEDS} seeds × 3 conditions × {STEPS} steps\n")

    conditions = ['fp32_glorot', 'ternary_xavier', 'ternary_orbit']
    agg = {c: {'final': [], 'best': [], 'step_best': [], 'balance': [], 'sparsity': [],
               'curves': []} for c in conditions}

    for i, seed in enumerate(seeds):
        print(f"  seed {seed} ({i+1:>2}/{N_SEEDS})... ", end='', flush=True)
        row = {}
        for cond in conditions:
            final, best, sb, ws, curve = train_one(cond, X_tr, y_tr, X_te, y_te, seed)
            agg[cond]['final'].append(final)
            agg[cond]['best'].append(best)
            agg[cond]['step_best'].append(sb)
            agg[cond]['balance'].append(ws['balance'])
            agg[cond]['sparsity'].append(ws['sparsity'])
            agg[cond]['curves'].append(curve)
            row[cond] = f"{final:.3f}"
        print('  '.join(f"{c[:3]}={row[c]}" for c in conditions))

    # ── Summary ────────────────────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"  Ternary Quantization: HARD Regime")
    print(f"  H={H} (bottleneck) | C={N} | sep={SEP}σ | {STEPS} steps | {DEVICE}")
    print(f"{'='*70}")
    for cond in conditions:
        a = agg[cond]
        fa = np.array(a['final'])
        ba = np.array(a['best'])
        sb = np.array(a['step_best'])
        print(f"\n  [{cond}]")
        print(f"    final acc:  {fa.mean():.4f} ± {fa.std():.4f}  "
              f"(min {fa.min():.4f}  max {fa.max():.4f})")
        print(f"    best acc:   {ba.mean():.4f} ± {ba.std():.4f}")
        print(f"    step@best:  {sb.mean():.0f} ± {sb.std():.0f}  (median {np.median(sb):.0f})")
        if cond != 'fp32_glorot':
            print(f"    balance:    {np.mean(a['balance']):.3f}  "
                  f"sparsity: {np.mean(a['sparsity']):.3f}")

    o_fa = np.array(agg['ternary_orbit']['final'])
    x_fa = np.array(agg['ternary_xavier']['final'])
    f_fa = np.array(agg['fp32_glorot']['final'])

    print(f"\n  Pairwise accuracy (final):")
    print(f"    orbit vs xavier: {np.mean(o_fa > x_fa):.0%} seeds orbit better")
    print(f"    orbit vs fp32:   {np.mean(o_fa > f_fa):.0%} seeds orbit better")
    print(f"    xavier vs fp32:  {np.mean(x_fa > f_fa):.0%} seeds xavier better")

    gap_ox = (o_fa - x_fa).mean()
    gap_of = (o_fa - f_fa).mean()
    print(f"    mean gap orbit-xavier: {gap_ox:+.4f}")
    print(f"    mean gap orbit-fp32:   {gap_of:+.4f}")

    if gap_of > 0.005 and np.mean(o_fa > f_fa) > 0.6:
        verdict = "ORBIT WINS: structured sparsity beats fp32 under pressure"
    elif gap_ox > 0.005 and np.mean(o_fa > x_fa) > 0.6:
        verdict = "ORBIT BEATS TERNARY: orbit sparsity > random sparsity"
    elif gap_of < -0.005:
        verdict = "FP32 WINS: quantization hurts in hard regime"
    elif gap_ox < -0.005:
        verdict = "XAVIER WINS: orbit stiffness is a liability here"
    else:
        verdict = "WITHIN NOISE: hard regime didn't differentiate conditions"
    print(f"\n  Verdict: {verdict}")
    print(f"{'='*70}")

    # ── Plot ───────────────────────────────────────────────────────────────────
    COLORS = {'fp32_glorot': '#00e5ff', 'ternary_xavier': '#ff9800', 'ternary_orbit': '#c060ff'}
    fig, axes = plt.subplots(1, 3, figsize=(17, 4))
    fig.suptitle(
        f'Ternary Quantization — Hard Regime\n'
        f'H={H} bottleneck | C={N} classes | sep={SEP}σ | {STEPS} steps | {N_SEEDS} seeds',
        fontsize=10)

    # Mean accuracy curves
    for cond in conditions:
        curves = agg[cond]['curves']
        steps_common = [s for s, _ in curves[0]]
        accs_mat = np.array([[a for _, a in c] for c in curves])
        mean_acc = accs_mat.mean(axis=0)
        std_acc  = accs_mat.std(axis=0)
        c = COLORS[cond]
        axes[0].plot(steps_common, mean_acc, label=cond, color=c, alpha=0.9)
        axes[0].fill_between(steps_common, mean_acc-std_acc, mean_acc+std_acc,
                             color=c, alpha=0.12)

    axes[0].set_title('Mean accuracy curve (±1σ)')
    axes[0].set_xlabel('Step'); axes[0].set_ylabel('Accuracy')
    axes[0].legend(fontsize=8); axes[0].grid(alpha=0.15)

    # Final accuracy distribution
    for cond in conditions:
        axes[1].hist(agg[cond]['final'], bins=15, color=COLORS[cond], alpha=0.6, label=cond)
    axes[1].set_title('Final accuracy distribution')
    axes[1].set_xlabel('Accuracy'); axes[1].legend(fontsize=8); axes[1].grid(alpha=0.15)

    # Best accuracy distribution
    for cond in conditions:
        axes[2].hist(agg[cond]['best'], bins=15, color=COLORS[cond], alpha=0.6, label=cond)
    axes[2].set_title('Best accuracy distribution')
    axes[2].set_xlabel('Accuracy'); axes[2].legend(fontsize=8); axes[2].grid(alpha=0.15)

    plt.tight_layout()
    plt.savefig('ternary_hard.png', dpi=140, bbox_inches='tight')
    print('\n  Plot saved: ternary_hard.png')


if __name__ == '__main__':
    run()
