"""
ruby PoC 7 — Ternary Weight Quantization with Orbit Structure
Requires: torch >= 2.0, scipy, matplotlib

Connection to ruby math:
  Balanced ternary trit values {-1, 0, +1} ARE the ruby structure:
    {1, 2, 4}  → +1  (orbit generators, ascending powers)
    {8, 7, 5}  → -1  (orbit complements: 1+8=9, 2+7=9, 4+5=9)
    {3, 6, 9}  →  0  (nil/excluded — 6=nil, 3 and 9 are axis values)
  Nil fraction = 3/9 = 1/3, exactly as in echo-pair init.

  Orbit-structured ternary: organize weights into blocks of 9,
  assign signs by orbit membership. Every block has EXACTLY
  3 zeros (nil), 3 +1s (orbit generators), 3 -1s (complements).
  Permute globally to remove spatial bias.

  Compare to standard ternary: same STE training, random ±1 assignment,
  same nil fraction but without local balance guarantee.

BitNet b1.58 (Microsoft 2024) demonstrated ternary weights work at
transformer scale. This PoC asks: does orbit-structured sparsity pattern
give any advantage over random ternary at MLP scale?

Technique: Straight-Through Estimator (STE)
  Forward:  W_ternary = ternarize(W_real)     ← {-1, 0, +1} used in matmul
  Backward: dL/dW_real ≈ dL/dW_ternary        ← gradient passes through

Conditions:
  A. fp32_glorot     — full precision, Xavier init (ceiling reference)
  B. ternary_xavier  — STE ternary, Xavier shadow weights (industry standard)
  C. ternary_orbit   — STE ternary, orbit-pattern init (ruby-specific)

Multi-seed experiment (N_SEEDS) to avoid single-seed noise (lesson from PoC 6).

Run:  python3 poc_ternary_orbit.py
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
N        = 8        # clusters / classes / experts
D        = 64       # input dimension
H        = 256      # hidden dim (wider to make ternary capacity fair)
N_TRAIN  = 8000
N_TEST   = 2000
STEPS    = 2000
BATCH    = 512
SEP      = 3.0
N_SEEDS  = 20
NIL_FRAC = 1/3     # matches ruby's 3/9 nil values


# ── Dataset ────────────────────────────────────────────────────────────────────

def make_gaussian_mixture(n_train, n_test, n_clusters, d, separation=3.0, seed=SEED):
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


# ── Ternary init strategies ───────────────────────────────────────────────────

# Orbit pattern for one block of 9:
# indices 0..8 map to orbit values 1..9
# {1,2,4} → +1; {8,7,5} → -1; {3,6,9→pos 2,5,8} → 0
_ORBIT_BLOCK = torch.tensor([+1., +1., 0., +1., -1., 0., -1., -1., 0.])

def orbit_ternary_init_(tensor):
    """
    Fill tensor with orbit-structured ternary values {-1, 0, +1}.
    Every block of 9 weights has exactly 3 zeros, 3 +1s, 3 -1s.
    Globally permuted to remove positional bias.
    """
    with torch.no_grad():
        flat = tensor.view(-1)
        n    = flat.numel()
        reps = (n // 9) + 1
        tiled = _ORBIT_BLOCK.repeat(reps).to(tensor.device)[:n]
        perm  = torch.randperm(n, device=tensor.device)
        flat.copy_(tiled[perm])


def ternarize(W):
    """Threshold-based ternarize: {-1, 0, +1} using 0.7 * mean(|W|)."""
    thresh = 0.7 * W.abs().mean()
    return (W > thresh).float() - (W < -thresh).float()


def ste_ternarize(W):
    """STE ternarize: ternary in forward, identity gradient in backward."""
    return W + (ternarize(W.detach()) - W).detach()


# ── Model ──────────────────────────────────────────────────────────────────────

class MLP(nn.Module):
    """2-layer MLP. init in {'fp32', 'ternary_xavier', 'ternary_orbit'}."""
    def __init__(self, d_in, d_hid, d_out, init='fp32'):
        super().__init__()
        self.fc1  = nn.Linear(d_in,  d_hid)
        self.fc2  = nn.Linear(d_hid, d_out)
        self.init = init
        self._apply_init()

    def _apply_init(self):
        for layer in (self.fc1, self.fc2):
            nn.init.xavier_uniform_(layer.weight)
            nn.init.zeros_(layer.bias)
        if self.init == 'ternary_orbit':
            orbit_ternary_init_(self.fc1.weight)
            orbit_ternary_init_(self.fc2.weight)
        # xavier shadow weights used for both fp32 and ternary_xavier

    def forward(self, x):
        if self.init == 'fp32':
            h = F.relu(self.fc1(x))
            return self.fc2(h)
        else:
            # STE: ternary forward, real-valued gradient
            w1 = ste_ternarize(self.fc1.weight)
            h  = F.relu(F.linear(x, w1, self.fc1.bias))
            w2 = ste_ternarize(self.fc2.weight)
            return F.linear(h, w2, self.fc2.bias)

    def weight_stats(self):
        """Return sparsity and sign balance of fc1 weights after ternarize."""
        with torch.no_grad():
            W = ternarize(self.fc1.weight) if self.init != 'fp32' else self.fc1.weight
            total  = W.numel()
            zeros  = (W == 0).sum().item()
            pos    = (W >  0).sum().item()
            neg    = (W <  0).sum().item()
        return {'sparsity': zeros/total, 'pos': pos/total, 'neg': neg/total,
                'balance': min(pos,neg)/max(pos,neg,1)}


# ── Training ───────────────────────────────────────────────────────────────────

def train_one(init_name, X_train, y_train, X_test, y_test, seed):
    torch.manual_seed(seed)
    np.random.seed(seed)
    model = MLP(D, H, N, init=init_name).to(DEVICE)
    opt   = torch.optim.Adam(model.parameters(), lr=3e-4)
    milestones = {0.99: None, 1.00: None}
    n = len(X_train)

    for step in range(STEPS):
        idx = torch.randperm(n, device=DEVICE)[:BATCH]
        out = model(X_train[idx])
        loss = F.cross_entropy(out, y_train[idx])
        opt.zero_grad(); loss.backward(); opt.step()

        if step % 10 == 0:
            model.eval()
            with torch.no_grad():
                logits = model(X_test)
                acc = (logits.argmax(1) == y_test).float().mean().item()
            for thresh in list(milestones.keys()):
                if milestones[thresh] is None and acc >= thresh:
                    milestones[thresh] = step
            model.train()

    model.eval()
    with torch.no_grad():
        final_acc = (model(X_test).argmax(1) == y_test).float().mean().item()
    wstats = model.weight_stats()

    s99  = milestones[0.99] if milestones[0.99] is not None else STEPS
    s100 = milestones[1.00] if milestones[1.00] is not None else STEPS
    return s99, s100, final_acc, wstats


# ── Run ────────────────────────────────────────────────────────────────────────

def run():
    seeds = [SEED + i for i in range(N_SEEDS)]
    print(f"\nGenerating data (shared centers, sep={SEP}σ)...")
    (X_tr, y_tr), (X_te, y_te) = make_gaussian_mixture(N_TRAIN, N_TEST, N, D, SEP)
    print(f"  Train: {len(X_tr)}  Test: {len(X_te)}")
    print(f"\n{N_SEEDS} seeds × 3 conditions × {STEPS} steps\n")

    conditions = ['fp32_glorot', 'ternary_xavier', 'ternary_orbit']
    agg = {c: {'s99': [], 's100': [], 'acc': [], 'balance': [], 'sparsity': []}
           for c in conditions}

    for i, seed in enumerate(seeds):
        print(f"  seed {seed} ({i+1:>2}/{N_SEEDS})... ", end='', flush=True)
        row = {}
        for cond in conditions:
            s99, s100, acc, ws = train_one(cond, X_tr, y_tr, X_te, y_te, seed)
            agg[cond]['s99'].append(s99)
            agg[cond]['s100'].append(s100)
            agg[cond]['acc'].append(acc)
            agg[cond]['balance'].append(ws['balance'])
            agg[cond]['sparsity'].append(ws['sparsity'])
            row[cond] = s100
        print('  '.join(f"{c[:3]}={row[c]}" for c in conditions))

    # ── Summary ────────────────────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"  Ternary Weight Quantization: Orbit vs Random vs FP32")
    print(f"  {N_SEEDS} seeds | d={D} H={H} | sep={SEP}σ | steps={STEPS} | device={DEVICE}")
    print(f"{'='*70}")
    for cond in conditions:
        a = agg[cond]
        s99  = np.array(a['s99'])
        s100 = np.array(a['s100'])
        acc  = np.array(a['acc'])
        bal  = np.array(a['balance'])
        spa  = np.array(a['sparsity'])
        conv = np.sum(s100 < STEPS)
        print(f"\n  [{cond}]")
        print(f"    steps to 99%:  {s99.mean():.0f} ± {s99.std():.0f}  (median {np.median(s99):.0f})")
        print(f"    steps to 100%: {s100.mean():.0f} ± {s100.std():.0f}  (median {np.median(s100):.0f})"
              f"  [{conv}/{N_SEEDS} converged]")
        print(f"    final acc:     {acc.mean():.4f} ± {acc.std():.4f}")
        if cond != 'fp32_glorot':
            print(f"    weight balance (fc1): {bal.mean():.3f}  sparsity: {spa.mean():.3f}")

    # ── Pairwise comparison ────────────────────────────────────────────────────
    print(f"\n  Orbit vs Xavier ternary (win rate, steps to 100%):")
    o100 = np.array(agg['ternary_orbit']['s100'])
    x100 = np.array(agg['ternary_xavier']['s100'])
    f100 = np.array(agg['fp32_glorot']['s100'])
    wr_ox  = np.mean(o100 < x100)
    wr_of  = np.mean(o100 < f100)
    wr_xf  = np.mean(x100 < f100)
    print(f"    orbit vs xavier:  {wr_ox:.0%}  ({np.sum(o100<x100)}/{N_SEEDS} seeds orbit faster)")
    print(f"    orbit vs fp32:    {wr_of:.0%}  ({np.sum(o100<f100)}/{N_SEEDS} seeds orbit faster than fp32)")
    print(f"    xavier vs fp32:   {wr_xf:.0%}  ({np.sum(x100<f100)}/{N_SEEDS} seeds xavier faster than fp32)")

    o_acc = np.array(agg['ternary_orbit']['acc']).mean()
    x_acc = np.array(agg['ternary_xavier']['acc']).mean()
    f_acc = np.array(agg['fp32_glorot']['acc']).mean()
    print(f"\n  Final accuracy:  fp32={f_acc:.4f}  xavier={x_acc:.4f}  orbit={o_acc:.4f}")
    print(f"  Orbit accuracy gap vs fp32: {o_acc - f_acc:+.4f}")
    print(f"  Orbit accuracy gap vs xavier: {o_acc - x_acc:+.4f}")

    if wr_ox > 0.6 and o_acc >= x_acc - 0.005:
        verdict = "ORBIT WINS: faster and no accuracy cost"
    elif wr_ox > 0.6:
        verdict = "ORBIT FASTER but accuracy tradeoff"
    elif wr_ox < 0.4:
        verdict = "XAVIER FASTER: orbit structure does not help"
    else:
        verdict = "NO CONSISTENT WINNER: within noise"
    print(f"\n  Verdict: {verdict}")
    print(f"{'='*70}")

    # ── Plot ───────────────────────────────────────────────────────────────────
    COLORS = {'fp32_glorot': '#00e5ff', 'ternary_xavier': '#ff9800', 'ternary_orbit': '#c060ff'}
    fig, axes = plt.subplots(1, 3, figsize=(16, 4))
    fig.suptitle(
        f'Ternary Weight Quantization: Orbit vs Random vs FP32\n'
        f'{N_SEEDS} seeds | {N} Gaussians d={D} sep={SEP}σ | H={H}',
        fontsize=10)

    axes[0].set_title('Steps to 100% accuracy')
    axes[1].set_title('Steps to 99% accuracy')
    axes[2].set_title('Final accuracy distribution')
    for cond in conditions:
        a = agg[cond]; c = COLORS[cond]
        axes[0].hist(a['s100'], bins=15, color=c, alpha=0.6, label=cond)
        axes[1].hist(a['s99'],  bins=15, color=c, alpha=0.6, label=cond)
        axes[2].hist(a['acc'],  bins=10, color=c, alpha=0.6, label=cond)

    for ax in axes:
        ax.legend(fontsize=8); ax.grid(alpha=0.15)
    axes[0].set_xlabel('Steps'); axes[1].set_xlabel('Steps'); axes[2].set_xlabel('Accuracy')

    plt.tight_layout()
    plt.savefig('ternary_orbit.png', dpi=140, bbox_inches='tight')
    print('\n  Plot saved: ternary_orbit.png')


if __name__ == '__main__':
    run()
