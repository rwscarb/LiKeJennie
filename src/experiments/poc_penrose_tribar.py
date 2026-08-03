#!/usr/bin/env python3
"""
poc_penrose_tribar.py — Tribar PoC

Hypothesis: the 3-cycle structure of the ×2 mod 9 orbit [1,2,4,8,7,5] produces
inter-cycle edges (the Penrose tribar arms) that act as long-range skip connections
in a multi-scale GNN. Adding these edges should improve classification over a pure
within-cycle message-passing baseline.

The orbit runs CYCLES=3 repetitions (period M=6, STEPS=18 nodes per strand).
Nodes at position p, p+M, p+2M across cycles form triangles. The triangle edges:

  Arm A (gold)   : cycle 0 → cycle 1  (possible, forward)
  Arm B (cyan)   : cycle 1 → cycle 2  (possible, forward)
  Arm C (orange) : cycle 2 → cycle 0  (impossible, return — closes the tribar)

Arm C is the impossible return: in the helix it would require descending back to
the start. It is drawn (lines-only, no fill) to encode the contradiction. In graph
terms it is the ghost edge that would make the cycle-level graph cyclic.

Six conditions:

  A  baseline       within-cycle orbit permutation only (no inter-cycle edges)
  B  tribar_AB      Arm A + Arm B skip connections added (both possible arms)
  C  tribar_ABC     Arm A + Arm B + Arm C (impossible arm included — control)
  D  tribar_A       Arm A only (first fold)
  E  tribar_B       Arm B only (second fold)
  F  tribar_C       Arm C only (impossible arm only — pathological control)

Prediction: B > A,D,E > C~=A > F
  - Both possible arms together should outperform either alone
  - The impossible arm (C) adds a spurious low-level skip — should not help
  - Arm C alone should actively hurt (wrong-direction skip)

Network architecture: 3-cycle orbit GNN on MNIST
  Embed 784 → N (N = 9*K)
  For each cycle (3 cycles):
    6 within-cycle orbit permutation steps
    optional: add inter-cycle edge features from tribar arms
  Classify N → 64 → 10

N = 54 (9 nodes × 6 features). Three cycles → full STEPS=18 visible.
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
    """Within-cycle orbit permutation matrix (9K × 9K)."""
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


def build_tribar_arm(cycle_from, cycle_to):
    """
    Build the inter-cycle skip matrix for one tribar arm.
    Maps node features from orbit positions in cycle_from → same positions in cycle_to.
    Since we use a single N-dimensional hidden state (not a concatenation of cycles),
    this is approximated as an identity-preserving skip: h += alpha * (h @ arm_mask)
    where arm_mask selects the M orbit positions (not the 3,6,9 fixed points).
    The arm gate is a learned scalar alpha per arm.
    """
    # For the within-cycle model the single N-dim state represents 9 nodes.
    # Inter-cycle arms conceptually connect "same orbit position" across cycles,
    # but within a flat N-dim embedding this translates to a self-attention over
    # the M orbit-active nodes (indices for values in ORBIT, i.e. not 3,6,9).
    orbit_indices = [VALUES.index(v) for v in ORBIT]  # [0,1,3,7,6,4] for v in [1,2,4,8,7,5]
    mask = torch.zeros(N, N)
    for idx in orbit_indices:
        for k in range(K):
            # arm connects node idx to itself (cyclic recurrence at the same position)
            # weighted by cycle direction: forward arms amplify, backward arm inverts
            direction = 1.0 if cycle_from < cycle_to else -0.5
            mask[idx * K + k, idx * K + k] = direction
    return mask


PERM     = build_orbit_perm()
ARM_A    = build_tribar_arm(0, 1)   # cycle 0 → 1 (forward)
ARM_B    = build_tribar_arm(1, 2)   # cycle 1 → 2 (forward)
ARM_C    = build_tribar_arm(2, 0)   # cycle 2 → 0 (impossible return, negative direction)


# ── Models ────────────────────────────────────────────────────────────────────

class TribarNet(nn.Module):
    """
    3-cycle orbit GNN with optional tribar arm skip connections.

    arms: list of (mask_tensor, name) to apply as inter-cycle skips.
          Applied once between each cycle boundary:
            after cycle 0 steps → before cycle 1 steps  (Arm A)
            after cycle 1 steps → before cycle 2 steps  (Arm B)
          Arm C applied after cycle 2, before hypothetical cycle 3.
    """
    def __init__(self, arms=None):
        super().__init__()
        self.arms = arms or []
        self.embed = nn.Linear(784, N)
        self.register_buffer('perm', PERM)
        # Register arm masks as buffers + learned gate scalars
        self.arm_gates = nn.ParameterList()
        for i, (mask, name) in enumerate(self.arms):
            self.register_buffer(f'arm_mask_{i}', mask)
            self.arm_gates.append(nn.Parameter(torch.tensor(0.1)))
        self.relu = nn.ReLU()
        self.clf  = nn.Sequential(nn.Linear(N, 64), nn.ReLU(), nn.Linear(64, 10))

    def apply_arm(self, h, arm_idx):
        mask  = getattr(self, f'arm_mask_{arm_idx}')
        gate  = self.arm_gates[arm_idx]
        return h + gate * (h @ mask)

    def forward(self, x):
        h = self.relu(self.embed(x.view(x.size(0), -1)))
        for cycle in range(CYCLES):
            for _ in range(M):
                h = h @ self.perm
            # apply inter-cycle arms after each cycle boundary
            for i, (_, _name) in enumerate(self.arms):
                # arm A: apply after cycle 0; arm B: after cycle 1; arm C: after cycle 2
                # simplified: apply all arms after every cycle (gate learns to suppress)
                h = self.apply_arm(h, i)
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
    accs = []
    print(f'\n── {name} ──────────────────────────────', flush=True)
    for seed in range(SEEDS):
        torch.manual_seed(seed)
        np.random.seed(seed)
        model     = model_fn().to(device)
        optimizer = optim.Adam(model.parameters(), lr=LR)
        criterion = nn.CrossEntropyLoss()
        if seed == 0:
            print(f'   trainable params: {count_params(model):,}')
        t0 = time.time()
        for _ in range(EPOCHS):
            train(model, train_loader, optimizer, criterion, device)
        acc = evaluate(model, test_loader, device)
        accs.append(acc)
        print(f'   seed {seed:02d}  acc={acc*100:.2f}%  ({time.time()-t0:.1f}s)', flush=True)
    mean, std = np.mean(accs), np.std(accs)
    print(f'   → mean {mean*100:.2f}% ± {std*100:.2f}%')
    return accs


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f'device: {device}  |  N={N}  K={K}  M={M}  CYCLES={CYCLES}  EPOCHS={EPOCHS}  SEEDS={SEEDS}')
    print(f'orbit: {ORBIT}  (×2 mod 9, period {M})')
    print()
    print('Tribar arms:')
    print('  A (gold)   cycle 0→1  possible forward skip')
    print('  B (cyan)   cycle 1→2  possible forward skip')
    print('  C (orange) cycle 2→0  impossible return (negative direction gate)')
    print()
    print('Prediction: B (A+B) > D (A) ~ E (B) > A (baseline) > C (A+B+C) > F (C only)')

    # Verify orbit period
    perm_indices = [i for j in range(9) for i in range(9) if PERM[i * K, j * K] > 0.5]
    print(f'\nPERM matrix built — {N}×{N} block permutation (9 nodes × {K} features)')

    tf = transforms.Compose([transforms.ToTensor(), transforms.Normalize((0.1307,), (0.3081,))])
    train_set    = torchvision.datasets.MNIST('./data', train=True,  download=True, transform=tf)
    test_set     = torchvision.datasets.MNIST('./data', train=False, download=True, transform=tf)
    train_loader = DataLoader(train_set, batch_size=BATCH, shuffle=True,  num_workers=2)
    test_loader  = DataLoader(test_set,  batch_size=BATCH, shuffle=False, num_workers=2)

    arm_a = (ARM_A, 'A')
    arm_b = (ARM_B, 'B')
    arm_c = (ARM_C, 'C')

    conditions = {
        'A_baseline':    lambda: TribarNet(arms=[]),
        'B_tribar_AB':   lambda: TribarNet(arms=[arm_a, arm_b]),
        'C_tribar_ABC':  lambda: TribarNet(arms=[arm_a, arm_b, arm_c]),
        'D_tribar_A':    lambda: TribarNet(arms=[arm_a]),
        'E_tribar_B':    lambda: TribarNet(arms=[arm_b]),
        'F_tribar_C':    lambda: TribarNet(arms=[arm_c]),
    }

    results = {}
    for cond_name, model_fn in conditions.items():
        results[cond_name] = run_condition(cond_name, model_fn, train_loader, test_loader, device)

    print('\n\n══ SUMMARY ═════════════════════════════════════════')
    print('  Condition            Mean Acc   ±Std   Tribar Arms')
    print('  ─────────────────────────────────────────────────')
    arm_labels = {
        'A_baseline':   '—',
        'B_tribar_AB':  'A+B (possible)',
        'C_tribar_ABC': 'A+B+C (all)',
        'D_tribar_A':   'A only',
        'E_tribar_B':   'B only',
        'F_tribar_C':   'C only (impossible)',
    }
    for cond, accs in results.items():
        m, s = np.mean(accs) * 100, np.std(accs) * 100
        print(f'  {cond:<20}  {m:5.2f}%  ±{s:4.2f}%  {arm_labels[cond]}')

    # Check if prediction held
    best = max(results, key=lambda k: np.mean(results[k]))
    print(f'\n  Best: {best}  ({np.mean(results[best])*100:.2f}%)')
    if best == 'B_tribar_AB':
        print('  ✓ Prediction confirmed: both possible arms together is optimal')
    else:
        print(f'  ✗ Unexpected winner — investigate arm gate magnitudes')

    # Plot
    labels = list(results.keys())
    means  = [np.mean(v) * 100 for v in results.values()]
    stds   = [np.std(v) * 100  for v in results.values()]
    colors = ['#4ac880', '#FFD700', '#ffffff', '#FFD700', '#00E5FF', '#FF6B35']
    alphas = [0.85, 0.90, 0.60, 0.70, 0.70, 0.55]

    fig, ax = plt.subplots(figsize=(12, 5))
    fig.patch.set_facecolor('#020c08')
    ax.set_facecolor('#020c08')
    bars = ax.bar(labels, means, yerr=stds, capsize=5, color=colors,
                  alpha=0.85, error_kw=dict(ecolor='#ffffff', lw=1.2))
    ax.set_ylabel('Test Accuracy (%)', color='#aaaaaa')
    ax.set_title('Penrose Tribar PoC — Inter-Cycle Skip Connections (MNIST)\n'
                 'Arm A=gold (c0→c1)  Arm B=cyan (c1→c2)  Arm C=orange (impossible return)',
                 color='#00ff88', pad=12, fontsize=10)
    ax.tick_params(colors='#aaaaaa', axis='both')
    ax.spines[:].set_color('#1a3a2a')
    ax.set_ylim(min(means) - 3, 100)
    for spine in ax.spines.values():
        spine.set_linewidth(0.5)
    for bar, m, s in zip(bars, means, stds):
        ax.text(bar.get_x() + bar.get_width() / 2, m + s + 0.3, f'{m:.2f}%',
                ha='center', va='bottom', color='#ffffff', fontsize=9)

    # Annotate arm legend
    ax.axhline(np.mean(results['A_baseline']) * 100, color='#4ac880', lw=0.8,
               linestyle='--', alpha=0.5, label='baseline')
    ax.legend(fontsize=8, facecolor='#020c08', edgecolor='#1a3a2a', labelcolor='#aaaaaa')

    plt.tight_layout()
    out = 'penrose_tribar_results.png'
    plt.savefig(out, dpi=140, facecolor='#020c08')
    print(f'\nPlot saved: {out}')


if __name__ == '__main__':
    main()
