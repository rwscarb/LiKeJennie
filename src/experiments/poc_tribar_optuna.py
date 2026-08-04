#!/usr/bin/env python3
"""
poc_penrose_optuna.py — Tribar PoC Optuna Study

Objective: maximize (D_tribar_A accuracy - A_baseline accuracy) at σ=0.7.
Finding configs where the early-fire skip genuinely helps under noise.

Search space:
  K         : features per orbit node [4, 6, 8, 12, 16]
  CYCLES    : number of orbit cycles [2, 3, 4, 5]
  LR        : learning rate [1e-4, 5e-3] log-uniform
  gate_init : arm A gate initialization [0.01, 0.5] uniform

Fixed: M=6 (orbit period), NOISE_SIGMA=0.7, EPOCHS=5, SEEDS=3, BATCH=256
"""

import torch
import torch.nn as nn
import torch.optim as optim
import torchvision
import torchvision.transforms as transforms
import numpy as np
from torch.utils.data import DataLoader
import optuna
import time

optuna.logging.set_verbosity(optuna.logging.WARNING)

SEEDS        = 3
EPOCHS       = 5
BATCH        = 256
M            = 6
NOISE_SIGMA  = 0.7
N_TRIALS     = 40
VALUES       = list(range(1, 10))
ORBIT        = [1, 2, 4, 8, 7, 5]

device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')


def build_orbit_perm(N, K):
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


def build_orbit_mask(N, K):
    orbit_indices = [VALUES.index(v) for v in ORBIT]
    mask = torch.zeros(N, N)
    for idx in orbit_indices:
        for k in range(K):
            mask[idx * K + k, idx * K + k] = 1.0
    return mask


class TribarNet(nn.Module):
    def __init__(self, K, CYCLES, gate_init=None, use_arm_A=False, noise_sigma=0.0):
        super().__init__()
        N = 9 * K
        self.use_arm_A   = use_arm_A
        self.noise_sigma = noise_sigma
        self.CYCLES      = CYCLES
        self.embed       = nn.Linear(784, N)
        perm             = build_orbit_perm(N, K)
        orbit_mask       = build_orbit_mask(N, K)
        self.register_buffer('perm', perm)
        self.register_buffer('orbit_mask', orbit_mask)
        if use_arm_A and gate_init is not None:
            self.gate_A = nn.Parameter(torch.tensor(gate_init))
        else:
            self.gate_A = None
        self.cycle_norm = nn.LayerNorm(N)
        self.relu        = nn.ReLU()
        self.clf         = nn.Sequential(nn.Linear(N, 64), nn.ReLU(), nn.Linear(64, 10))

    def forward(self, x):
        h = self.embed(x.view(x.size(0), -1))
        for cycle in range(self.CYCLES):
            for _ in range(M):
                h = self.relu(h @ self.perm)
                if self.noise_sigma > 0.0:
                    h = h + self.noise_sigma * torch.randn_like(h)
            if self.use_arm_A and self.gate_A is not None and cycle == 0:
                h = h + self.gate_A * (h @ self.orbit_mask)
            h = self.cycle_norm(h)
        return self.clf(h)


def run_model(model_fn, train_loader, test_loader):
    accs = []
    for seed in range(SEEDS):
        torch.manual_seed(seed)
        np.random.seed(seed)
        model     = model_fn().to(device)
        optimizer = optim.Adam(model.parameters(), lr=model.lr if hasattr(model, 'lr') else 1e-3)
        criterion = nn.CrossEntropyLoss()
        model.train()
        for _ in range(EPOCHS):
            for x, y in train_loader:
                x, y = x.to(device), y.to(device)
                optimizer.zero_grad()
                criterion(model(x), y).backward()
                optimizer.step()
        model.eval()
        correct = total = 0
        with torch.no_grad():
            for x, y in test_loader:
                x, y = x.to(device), y.to(device)
                correct += (model(x).argmax(1) == y).sum().item()
                total   += y.size(0)
        accs.append(correct / total)
    return float(np.mean(accs))


# Need to pass lr into model — use a wrapper
class TribarNetLR(TribarNet):
    def __init__(self, K, CYCLES, gate_init, use_arm_A, noise_sigma, lr):
        super().__init__(K, CYCLES, gate_init, use_arm_A, noise_sigma)
        self.lr = lr


def run_model_lr(model_fn, train_loader, test_loader, lr):
    accs = []
    for seed in range(SEEDS):
        torch.manual_seed(seed)
        np.random.seed(seed)
        model     = model_fn().to(device)
        optimizer = optim.Adam(model.parameters(), lr=lr)
        criterion = nn.CrossEntropyLoss()
        model.train()
        for _ in range(EPOCHS):
            for x, y in train_loader:
                x, y = x.to(device), y.to(device)
                optimizer.zero_grad()
                criterion(model(x), y).backward()
                optimizer.step()
        model.eval()
        correct = total = 0
        with torch.no_grad():
            for x, y in test_loader:
                x, y = x.to(device), y.to(device)
                correct += (model(x).argmax(1) == y).sum().item()
                total   += y.size(0)
        accs.append(correct / total)
    return float(np.mean(accs))


def main():
    print(f'device: {device}')
    print(f'sigma={NOISE_SIGMA}  seeds={SEEDS}  epochs={EPOCHS}  trials={N_TRIALS}')
    print(f'objective: D_tribar_A - A_baseline (maximize gap)\n')

    tf = transforms.Compose([transforms.ToTensor(), transforms.Normalize((0.1307,), (0.3081,))])
    train_set    = torchvision.datasets.MNIST('./data', train=True,  download=True, transform=tf)
    test_set     = torchvision.datasets.MNIST('./data', train=False, download=True, transform=tf)
    train_loader = DataLoader(train_set, batch_size=BATCH, shuffle=True,  num_workers=2, pin_memory=True)
    test_loader  = DataLoader(test_set,  batch_size=BATCH, shuffle=False, num_workers=2, pin_memory=True)

    trial_count = [0]

    def objective(trial):
        K         = trial.suggest_categorical('K', [4, 6, 8, 12, 16])
        CYCLES    = trial.suggest_int('CYCLES', 2, 5)
        lr        = trial.suggest_float('lr', 1e-4, 5e-3, log=True)
        gate_init = trial.suggest_float('gate_init', 0.01, 0.5)

        baseline_fn = lambda: TribarNet(K, CYCLES, gate_init=None, use_arm_A=False, noise_sigma=NOISE_SIGMA)
        tribar_fn   = lambda: TribarNet(K, CYCLES, gate_init=gate_init, use_arm_A=True, noise_sigma=NOISE_SIGMA)

        t0       = time.time()
        acc_base = run_model_lr(baseline_fn, train_loader, test_loader, lr)
        acc_d    = run_model_lr(tribar_fn,   train_loader, test_loader, lr)
        gap      = acc_d - acc_base
        elapsed  = time.time() - t0

        trial_count[0] += 1
        print(f'trial {trial_count[0]:3d}/{N_TRIALS}  K={K:2d}  CYCLES={CYCLES}  '
              f'lr={lr:.2e}  gate={gate_init:.3f}  '
              f'base={acc_base*100:.2f}%  D={acc_d*100:.2f}%  '
              f'gap={gap*100:+.2f}%  ({elapsed:.0f}s)', flush=True)
        return gap

    study = optuna.create_study(direction='maximize',
                                sampler=optuna.samplers.TPESampler(seed=42))
    study.optimize(objective, n_trials=N_TRIALS)

    best = study.best_trial
    print(f'\n{"="*60}')
    print(f'BEST TRIAL #{best.number}')
    print(f'  gap  = {best.value*100:+.3f}%')
    print(f'  K    = {best.params["K"]}')
    print(f'  CYCLES = {best.params["CYCLES"]}')
    print(f'  lr   = {best.params["lr"]:.4e}')
    print(f'  gate = {best.params["gate_init"]:.4f}')

    # Top 5
    trials_sorted = sorted(study.trials, key=lambda t: t.value, reverse=True)
    print(f'\nTop 5:')
    for t in trials_sorted[:5]:
        print(f'  #{t.number:3d}  gap={t.value*100:+.3f}%  '
              f'K={t.params["K"]}  CYCLES={t.params["CYCLES"]}  '
              f'lr={t.params["lr"]:.2e}  gate={t.params["gate_init"]:.3f}')

    # Parameter importance
    try:
        importance = optuna.importance.get_param_importances(study)
        print(f'\nParameter importance:')
        for param, imp in importance.items():
            print(f'  {param:<12} {imp:.3f}')
    except Exception:
        pass

    print('\nDONE')


if __name__ == '__main__':
    main()
