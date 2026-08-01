#!/usr/bin/env python3
"""
poc_orbit_gnn.py — Narcissus PoC

Hypothesis: the orbit {1,2,4,8,7,5} under ×2 mod 9 has period 6.
A GNN with 6 message-passing steps on this graph computes the identity.
Therefore layers 1-6 are structurally determined — layer 7 is where learning lives.

Four conditions:
  A  xavier         7 fully trainable layers (baseline MLP)
  B  orbit_init     layers 1-6 initialized to orbit permutation matrix, trainable
  C  orbit_frozen   layers 1-6 FROZEN at orbit perm, only embed+classifier train
  D  orbit_relu     same as C but with ReLU after each frozen permutation step

Network:  Linear(784→N) → [6 orbit layers] → Linear(N→64) → ReLU → Linear(64→10)
N = 9*K = 72  (9 orbit nodes × 8 features each)

Runs SEEDS seeds. Reports accuracy, trainable param counts, and ternary weight balance of
the first trainable layer (as a nod to the TRIB experiment).
  E  rand_frozen    6 layers FROZEN at a RANDOM permutation (critical control: is it orbit specifically?)
  F  orbit_inject   6 frozen orbit layers + skip: data re-injected at layer 3 (mid-orbit)
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
import time, sys, os

# ── Config ────────────────────────────────────────────────────────────────────
SEEDS   = 20
EPOCHS  = 5
BATCH   = 256
LR      = 1e-3
K       = 8          # features per orbit node
N       = 9 * K      # 72 total hidden dim

# ── Orbit permutation ─────────────────────────────────────────────────────────
# Values at node indices 0-8: [1,2,3,4,5,6,7,8,9]
# ×2 mod 9 forward map: v → 2v mod 9 (using 9 instead of 0)
VALUES = list(range(1, 10))

def build_recv():
    """recv[j] = i means node j receives message from node i (where i → j under ×2 mod 9)."""
    fwd = {}
    for i, v in enumerate(VALUES):
        t = (v * 2) % 9 or 9
        fwd[i] = VALUES.index(t)
    recv = [None] * 9
    for src, dst in fwd.items():
        recv[dst] = src
    return recv

RECV = build_recv()   # RECV[j] = source node for node j

def orbit_perm_matrix(K):
    """Build (9K × 9K) block permutation matrix P.
    (h @ P)[b, j*K+k] = h[b, RECV[j]*K+k]  — cycles node features along ×2 edges.
    P[src*K+k, dst*K+k] = 1 where dst = fwd[src].
    Equivalently: P[row, row] form so that h@P permutes the node blocks.
    """
    # We want h @ P where (h@P)[:,j*K:(j+1)*K] = h[:,RECV[j]*K:(RECV[j]+1)*K]
    # Column j*K+k receives from row RECV[j]*K+k → P[RECV[j]*K+k, j*K+k] = 1
    N = 9 * K
    P = torch.zeros(N, N)
    for j in range(9):
        src = RECV[j]
        for k in range(K):
            P[src * K + k, j * K + k] = 1.0   # h @ P: col j*K+k gets row src*K+k
    return P

PERM_MAT = orbit_perm_matrix(K)   # pre-build once

# ── Models ────────────────────────────────────────────────────────────────────

class XavierNet(nn.Module):
    """Condition A: 7 fully trainable layers (embed + 5 hidden + classify)."""
    def __init__(self):
        super().__init__()
        layers = [nn.Linear(784, N), nn.ReLU()]
        for _ in range(5):
            layers += [nn.Linear(N, N), nn.ReLU()]
        self.trunk = nn.Sequential(*layers)
        self.clf   = nn.Sequential(nn.Linear(N, 64), nn.ReLU(), nn.Linear(64, 10))
    def forward(self, x):
        return self.clf(self.trunk(x.view(x.size(0), -1)))


class OrbitInitNet(nn.Module):
    """Condition B: layers 1-6 initialized to orbit permutation matrix, then trained freely."""
    def __init__(self):
        super().__init__()
        self.embed  = nn.Linear(784, N)
        self.layers = nn.ModuleList([nn.Linear(N, N, bias=False) for _ in range(6)])
        P = orbit_perm_matrix(K)
        for layer in self.layers:
            with torch.no_grad():
                layer.weight.copy_(P.T)   # nn.Linear computes x @ W.T, so W = P.T
        self.relu  = nn.ReLU()
        self.clf   = nn.Sequential(nn.Linear(N, 64), nn.ReLU(), nn.Linear(64, 10))
    def forward(self, x):
        h = self.relu(self.embed(x.view(x.size(0), -1)))
        for layer in self.layers:
            h = self.relu(layer(h))
        return self.clf(h)


class OrbitFrozenNet(nn.Module):
    """Conditions C & D: 6 frozen permutation layers, only embed+clf trainable."""
    def __init__(self, use_relu=False):
        super().__init__()
        self.use_relu = use_relu
        self.embed    = nn.Linear(784, N)
        self.register_buffer('perm', orbit_perm_matrix(K))
        self.relu     = nn.ReLU()
        self.clf      = nn.Sequential(nn.Linear(N, 64), nn.ReLU(), nn.Linear(64, 10))
    def forward(self, x):
        h = self.relu(self.embed(x.view(x.size(0), -1)))
        for _ in range(6):
            h = h @ self.perm           # permute node blocks (h @ P)
            if self.use_relu:
                h = self.relu(h)
        return self.clf(h)


class RandFrozenNet(nn.Module):
    """Condition E: 6 frozen RANDOM permutation layers (control — not orbit-specific).
    Built per-instance so each seed gets the same random perm (seeded before construction).
    """
    def __init__(self):
        super().__init__()
        self.embed = nn.Linear(784, N)
        # Build a random block permutation: shuffle 9 node indices, tile across K
        node_perm = torch.randperm(9)
        P = torch.zeros(N, N)
        for j in range(9):
            src = node_perm[j].item()
            for k in range(K):
                P[src * K + k, j * K + k] = 1.0
        self.register_buffer('perm', P)
        self.relu = nn.ReLU()
        self.clf  = nn.Sequential(nn.Linear(N, 64), nn.ReLU(), nn.Linear(64, 10))
    def forward(self, x):
        h = self.relu(self.embed(x.view(x.size(0), -1)))
        for _ in range(6):
            h = h @ self.perm
        return self.clf(h)


class OrbitInjectNet(nn.Module):
    """Condition F: 6 frozen orbit layers + skip connection at layer 3 (mid-orbit).
    Data embedding is added again at the halfway point of the orbit cycle.
    """
    def __init__(self):
        super().__init__()
        self.embed  = nn.Linear(784, N)
        self.inject = nn.Linear(784, N, bias=False)  # second projection for mid-point injection
        self.register_buffer('perm', orbit_perm_matrix(K))
        self.relu   = nn.ReLU()
        self.clf    = nn.Sequential(nn.Linear(N, 64), nn.ReLU(), nn.Linear(64, 10))
    def forward(self, x):
        xf = x.view(x.size(0), -1)
        h  = self.relu(self.embed(xf))
        for i in range(6):
            h = h @ self.perm
            if i == 2:   # after layer 3 (0-indexed: i=2 → third step)
                h = h + self.inject(xf)   # inject data at mid-orbit
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
        for epoch in range(EPOCHS):
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
    print(f'device: {device}  |  N={N}  K={K}  EPOCHS={EPOCHS}  SEEDS={SEEDS}')

    # Verify orbit period
    perm_idx = [RECV[j] for j in range(9)]
    def apply_perm(lst, p): return [lst[p[i]] for i in range(len(p))]
    state = list(range(9))
    for step in range(1, 13):
        state = apply_perm(state, perm_idx)
        if state == list(range(9)):
            print(f'Orbit period verified: {step} steps → identity')
            break

    tf = transforms.Compose([transforms.ToTensor(), transforms.Normalize((0.1307,), (0.3081,))])
    train_set = torchvision.datasets.MNIST('./data', train=True,  download=True, transform=tf)
    test_set  = torchvision.datasets.MNIST('./data', train=False, download=True, transform=tf)
    train_loader = DataLoader(train_set, batch_size=BATCH, shuffle=True,  num_workers=2)
    test_loader  = DataLoader(test_set,  batch_size=BATCH, shuffle=False, num_workers=2)

    results = {}
    results['A_xavier']        = run_condition('A  xavier',        XavierNet,                             train_loader, test_loader, device)
    results['B_orbit_init']    = run_condition('B  orbit_init',    OrbitInitNet,                          train_loader, test_loader, device)
    results['C_orbit_frozen']  = run_condition('C  orbit_frozen',  lambda: OrbitFrozenNet(use_relu=False),train_loader, test_loader, device)
    results['D_orbit_relu']    = run_condition('D  orbit_relu',    lambda: OrbitFrozenNet(use_relu=True), train_loader, test_loader, device)
    results['E_rand_frozen']   = run_condition('E  rand_frozen',   RandFrozenNet,                         train_loader, test_loader, device)
    results['F_orbit_inject']  = run_condition('F  orbit_inject',  OrbitInjectNet,                        train_loader, test_loader, device)

    print('\n\n══ SUMMARY ═════════════════════════════════════════')
    for cond, accs in results.items():
        print(f'  {cond:<20}  {np.mean(accs)*100:.2f}% ± {np.std(accs)*100:.2f}%  (n={SEEDS})')

    # Plot
    labels = list(results.keys())
    means  = [np.mean(v)*100 for v in results.values()]
    stds   = [np.std(v)*100  for v in results.values()]
    colors = ['#00e5ff', '#00ff88', '#ff9800', '#ff4081', '#aa44ff', '#ffee00']

    fig, ax = plt.subplots(figsize=(11, 5))
    fig.patch.set_facecolor('#020c08')
    ax.set_facecolor('#020c08')
    bars = ax.bar(labels, means, yerr=stds, capsize=5, color=colors, alpha=0.85, error_kw=dict(ecolor='#ffffff', lw=1.2))
    ax.set_ylabel('Test Accuracy (%)', color='#aaaaaa')
    ax.set_title('Narcissus PoC — Orbit GNN vs Baseline (MNIST)', color='#00ff88', pad=12)
    ax.tick_params(colors='#aaaaaa', axis='both')
    ax.spines[:].set_color('#1a3a2a')
    ax.set_ylim(min(means) - 3, 100)
    for spine in ax.spines.values(): spine.set_linewidth(0.5)
    for bar, m, s in zip(bars, means, stds):
        ax.text(bar.get_x() + bar.get_width()/2, m + s + 0.3, f'{m:.2f}%',
                ha='center', va='bottom', color='#ffffff', fontsize=9)
    plt.tight_layout()
    plt.savefig('orbit_gnn_results2.png', dpi=140, facecolor='#020c08')
    print('\nPlot saved: orbit_gnn_results2.png')

if __name__ == '__main__':
    main()
