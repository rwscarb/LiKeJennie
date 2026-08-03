#!/usr/bin/env python3
"""
poc_penrose_tribar.py — Tribar PoC v2

Hypothesis: the 3-cycle structure of the ×2 mod 9 orbit [1,2,4,8,7,5] produces
inter-cycle edges (the Penrose tribar arms) that act as long-range skip connections
in a multi-scale GNN. Adding these edges should improve classification over a pure
within-cycle message-passing baseline.

The orbit runs CYCLES=3 repetitions (period M=6, STEPS=18 nodes per strand).
Nodes at position p, p+M, p+2M across cycles form triangles. The triangle edges:

  Arm A (gold)   : cycle 0 → cycle 1  (possible, forward) — fires at boundary 0→1
  Arm B (cyan)   : cycle 1 → cycle 2  (possible, forward) — fires at boundary 1→2
  Arm C (orange) : cycle 2 → cycle 0  (impossible, return) — fires after cycle 2

Key fix from v1: each arm fires at its specific cycle boundary only.
Key fix from v2: ReLU applied after each within-cycle permutation step.

Root cause of D≡E in v1 and v2: PERM^M = I (the orbit permutation has period
exactly M=6, so 6 linear permutation steps compose back to the identity). Without
nonlinearity, h after cycle 0 = h after cycle 1 = h after cycle 2 = h_embed.
Every arm fires on the same vector, making D and E structurally identical.
ReLU(h @ PERM) breaks this: the reordering + zero-clamping accumulates across
steps, so each cycle produces a genuinely different hidden state.

Six conditions:

  A  baseline       within-cycle orbit permutation only (no inter-cycle edges)
  B  tribar_AB      Arm A + Arm B skip connections (both possible arms)
  C  tribar_ABC     Arm A + Arm B + Arm C (impossible arm included — control)
  D  tribar_A       Arm A only (first fold, fires at boundary 0→1)
  E  tribar_B       Arm B only (second fold, fires at boundary 1→2)
  F  tribar_C       Arm C only (impossible arm only — pathological control)

Prediction: B > D > E > A > C > F
  - Arm A fires earlier (after cycle 0), when hidden state is less saturated
  - Arm B fires later (after cycle 1), signal still useful but more mixed
  - Arm C fires last and points backwards — gate should learn to suppress
  - Both possible arms together remains the best overall configuration
"""

import torch
import torch.nn as nn
import torch.optim as optim
import torchvision
import torchvision.transforms as transforms
import numpy as np
from torch.utils.data import DataLoader
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import time

# ── Config ────────────────────────────────────────────────────────────────────
SEEDS   = 15
EPOCHS  = 5
BATCH   = 256
LR      = 1e-3
K       = 6          # features per orbit node
N       = 9 * K      # 54 hidden dim
CYCLES  = 3          # orbit cycles (matches HELIX visualization)
M       = 6          # orbit period

# ── Orbit structure ───────────────────────────────────────────────────────────
ORBIT  = [1, 2, 4, 8, 7, 5]
VALUES = list(range(1, 10))


def build_orbit_perm():
    """Within-cycle orbit permutation matrix (N × N)."""
    fwd = {}
    for i, v in enumerate(VALUES):
        t = (v * 2) % 9 or 9
        fwd[i] = VALUES.index(t)
    recv = [None] * 9
    for src, dst in fwd.items():
        recv[dst] = src

    P = torch.zeros(N, N)
    for j in range(9):
        src = recv[j]
        for k in range(K):
            P[src * K + k, j * K + k] = 1.0
    return P


def build_orbit_mask():
    """
    Diagonal mask that passes orbit-active node features, zeros the fixed points (3,6,9).
    Used as the inter-cycle arm skip: h += gate * (h @ mask).
    All three arms share this mask structure — they differ only in WHEN they fire
    (at which cycle boundary), which means they operate on different hidden states.
    """
    orbit_indices = [VALUES.index(v) for v in ORBIT]
    mask = torch.zeros(N, N)
    for idx in orbit_indices:
        for k in range(K):
            mask[idx * K + k, idx * K + k] = 1.0
    return mask


PERM       = build_orbit_perm()
ORBIT_MASK = build_orbit_mask()

# Arm definitions: (name, cycle_boundary_after_which_arm_fires, initial_gate_sign)
# Arm C gate initialized negative to encode its "impossible/backward" directionality
ARM_DEFS = {
    'A': (0,  +0.1),   # fires after cycle 0 completes
    'B': (1,  +0.1),   # fires after cycle 1 completes
    'C': (2,  -0.1),   # fires after cycle 2 (impossible return, negative init)
}


# ── Model ─────────────────────────────────────────────────────────────────────

class TribarNet(nn.Module):
    """
    3-cycle orbit GNN with optional Penrose tribar arm skip connections.

    arm_names: list of arm keys from ARM_DEFS to activate (e.g. ['A', 'B']).
    Each arm fires once, at its specific cycle boundary only.
    Gate scalars are learned; Arm C initialized negative.
    """
    def __init__(self, arm_names=None):
        super().__init__()
        self.arm_names  = arm_names or []
        self.arm_cycles = {name: ARM_DEFS[name][0] for name in self.arm_names}
        self.embed      = nn.Linear(784, N)
        self.register_buffer('perm', PERM)
        self.register_buffer('orbit_mask', ORBIT_MASK)
        self.gates = nn.ParameterDict({
            name: nn.Parameter(torch.tensor(ARM_DEFS[name][1]))
            for name in self.arm_names
        })
        self.relu = nn.ReLU()
        self.clf  = nn.Sequential(nn.Linear(N, 64), nn.ReLU(), nn.Linear(64, 10))

    def forward(self, x):
        # No relu on initial embed: h has mixed signs.
        # relu(h @ PERM) only fires when values go negative — which only happens when
        # h has negatives to begin with. If we relu here, h is non-negative, permuting
        # non-negative values stays non-negative, relu becomes a no-op, and PERM^6=I
        # collapses every cycle back to the same state (D≡E again).
        h = self.embed(x.view(x.size(0), -1))
        for cycle in range(CYCLES):
            for _ in range(M):
                h = self.relu(h @ self.perm)
            # fire arms whose boundary matches this cycle
            for name in self.arm_names:
                if self.arm_cycles[name] == cycle:
                    h = h + self.gates[name] * (h @ self.orbit_mask)
        return self.clf(h)


# ── Training ──────────────────────────────────────────────────────────────────

def count_params(model):
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


def train(model, loader, optimizer, criterion, device):
    model.train()
    for x, y in loader:
        x, y = x.to(device), y.to(device)
        optimizer.zero_grad()
        criterion(model(x), y).backward()
        optimizer.step()


def evaluate(model, loader, device):
    model.eval()
    correct = total = 0
    with torch.no_grad():
        for x, y in loader:
            x, y = x.to(device), y.to(device)
            correct += (model(x).argmax(1) == y).sum().item()
            total   += y.size(0)
    return correct / total


def run_condition(name, model_fn, train_loader, test_loader, device):
    accs, gates_log = [], []
    print(f'\n── {name} ──────────────────────────────', flush=True)
    for seed in range(SEEDS):
        torch.manual_seed(seed)
        np.random.seed(seed)
        model     = model_fn().to(device)
        optimizer = optim.Adam(model.parameters(), lr=LR)
        criterion = nn.CrossEntropyLoss()
        if seed == 0:
            print(f'   trainable params: {count_params(model):,}')
            if model.gates:
                inits = {k: f'{v.item():+.3f}' for k, v in model.gates.items()}
                print(f'   gate inits: {inits}')
        t0 = time.time()
        for _ in range(EPOCHS):
            train(model, train_loader, optimizer, criterion, device)
        acc = evaluate(model, test_loader, device)
        accs.append(acc)
        if model.gates:
            learned = {k: f'{v.item():+.4f}' for k, v in model.gates.items()}
            gates_log.append(learned)
        print(f'   seed {seed:02d}  acc={acc*100:.2f}%  ({time.time()-t0:.1f}s)', flush=True)
    mean, std = np.mean(accs), np.std(accs)
    print(f'   → mean {mean*100:.2f}% ± {std*100:.2f}%')
    if gates_log:
        # average learned gate values across seeds
        gate_keys = list(gates_log[0].keys())
        for k in gate_keys:
            vals = [float(g[k]) for g in gates_log]
            print(f'   gate {k}: mean={np.mean(vals):+.4f} ± {np.std(vals):.4f}')
    return accs


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f'device: {device}  |  N={N}  K={K}  M={M}  CYCLES={CYCLES}  EPOCHS={EPOCHS}  SEEDS={SEEDS}')
    print(f'orbit: {ORBIT}  (×2 mod 9, period {M})')
    print()
    print('Arm firing boundaries:')
    print('  A (gold)   after cycle 0  gate_init=+0.1')
    print('  B (cyan)   after cycle 1  gate_init=+0.1')
    print('  C (orange) after cycle 2  gate_init=-0.1  (impossible return)')
    print()
    print('Prediction: B_tribar_AB > D_tribar_A > E_tribar_B > A_baseline > C_tribar_ABC > F_tribar_C')

    tf = transforms.Compose([transforms.ToTensor(), transforms.Normalize((0.1307,), (0.3081,))])
    train_set    = torchvision.datasets.MNIST('./data', train=True,  download=True, transform=tf)
    test_set     = torchvision.datasets.MNIST('./data', train=False, download=True, transform=tf)
    train_loader = DataLoader(train_set, batch_size=BATCH, shuffle=True,  num_workers=2)
    test_loader  = DataLoader(test_set,  batch_size=BATCH, shuffle=False, num_workers=2)

    conditions = {
        'A_baseline':   (lambda: TribarNet(arm_names=[]),            '—'),
        'B_tribar_AB':  (lambda: TribarNet(arm_names=['A', 'B']),    'A+B (possible)'),
        'C_tribar_ABC': (lambda: TribarNet(arm_names=['A', 'B', 'C']),'A+B+C (all)'),
        'D_tribar_A':   (lambda: TribarNet(arm_names=['A']),          'A only, fires boundary 0→1'),
        'E_tribar_B':   (lambda: TribarNet(arm_names=['B']),          'B only, fires boundary 1→2'),
        'F_tribar_C':   (lambda: TribarNet(arm_names=['C']),          'C only (impossible)'),
    }

    results = {}
    for cond_name, (model_fn, _label) in conditions.items():
        results[cond_name] = run_condition(cond_name, model_fn, train_loader, test_loader, device)

    print('\n\n══ SUMMARY ═════════════════════════════════════════')
    print('  Condition            Mean Acc   ±Std   Tribar Arms')
    print('  ─────────────────────────────────────────────────')
    for cond, (_, label) in conditions.items():
        m, s = np.mean(results[cond]) * 100, np.std(results[cond]) * 100
        print(f'  {cond:<20}  {m:5.2f}%  ±{s:4.2f}%  {label}')

    best = max(results, key=lambda k: np.mean(results[k]))
    print(f'\n  Best: {best}  ({np.mean(results[best])*100:.2f}%)')
    if best == 'B_tribar_AB':
        print('  ✓ Prediction confirmed: both possible arms together is optimal')
    else:
        print(f'  ✗ Unexpected winner — check gate values above')

    # Check D != E (the v1 bug)
    d_accs = results['D_tribar_A']
    e_accs = results['E_tribar_B']
    if d_accs == e_accs:
        print('\n  ⚠ D and E are still identical — boundary firing not working')
    else:
        diff = abs(np.mean(d_accs) - np.mean(e_accs)) * 100
        print(f'\n  ✓ D vs E differ by {diff:.3f}% — boundary firing is working')

    # Plot
    labels = list(results.keys())
    means  = [np.mean(v) * 100 for v in results.values()]
    stds   = [np.std(v) * 100  for v in results.values()]
    colors = ['#4ac880', '#FFD700', '#aaaaaa', '#FFD700', '#00E5FF', '#FF6B35']

    fig, ax = plt.subplots(figsize=(12, 5))
    fig.patch.set_facecolor('#020c08')
    ax.set_facecolor('#020c08')
    bars = ax.bar(labels, means, yerr=stds, capsize=5, color=colors,
                  alpha=0.85, error_kw=dict(ecolor='#ffffff', lw=1.2))
    ax.set_ylabel('Test Accuracy (%)', color='#aaaaaa')
    ax.set_title(
        'Penrose Tribar PoC v2 — Inter-Cycle Skip Connections (MNIST)\n'
        'Arm A=gold (boundary 0→1)  Arm B=cyan (boundary 1→2)  Arm C=orange (impossible return)\n'
        'v2 fix: each arm fires at its specific cycle boundary only',
        color='#00ff88', pad=12, fontsize=9)
    ax.tick_params(colors='#aaaaaa', axis='both')
    ax.spines[:].set_color('#1a3a2a')
    ax.set_ylim(min(means) - 0.5, max(means) + 0.5)
    for spine in ax.spines.values():
        spine.set_linewidth(0.5)
    for bar, m, s in zip(bars, means, stds):
        ax.text(bar.get_x() + bar.get_width() / 2, m + s + 0.02, f'{m:.2f}%',
                ha='center', va='bottom', color='#ffffff', fontsize=9)
    ax.axhline(np.mean(results['A_baseline']) * 100, color='#4ac880', lw=0.8,
               linestyle='--', alpha=0.5, label='baseline')
    ax.legend(fontsize=8, facecolor='#020c08', edgecolor='#1a3a2a', labelcolor='#aaaaaa')

    plt.tight_layout()
    out = 'penrose_tribar_results_v3.png'
    plt.savefig(out, dpi=140, facecolor='#020c08')
    print(f'\nPlot saved: {out}')


if __name__ == '__main__':
    main()
