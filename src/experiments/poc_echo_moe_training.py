"""
ruby PoC 2 — Echo-Pair Init: MoE Training Comparison (PyTorch)
Requires: torch >= 2.0

Tests the hypothesis:
  Echo-pair gate init maintains higher routing entropy longer,
  reducing expert collapse without an auxiliary routing loss.

Run:  python3 poc_echo_moe_training.py
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
SEED   = 42
torch.manual_seed(SEED)


# ── Init strategies ────────────────────────────────────────────────────────────

def glorot_init_(tensor):
    nn.init.xavier_uniform_(tensor)


def echo_pair_init_(tensor, nil_frac=0.33):
    """In-place echo-pair init. Non-nil weights appear in ±pairs."""
    with torch.no_grad():
        fan_in, fan_out = tensor.shape if tensor.dim() == 2 else (tensor.numel(), 1)
        limit  = np.sqrt(6.0 / (fan_in + fan_out))
        flat   = tensor.view(-1)
        n      = flat.numel()
        n_pair = int(n * (1 - nil_frac)) // 2  # always even
        n_act  = 2 * n_pair
        mags   = torch.empty(n_pair).uniform_(0.0, limit)
        vals   = torch.cat([mags, -mags])       # exactly n_act elements
        idx    = torch.randperm(n)[:n_act]
        flat.zero_()
        flat[idx] = vals[torch.randperm(n_act)]


# ── Sparse MoE layer ───────────────────────────────────────────────────────────

class SparseMoE(nn.Module):
    """
    Top-k sparse MoE with a gating network.
    n_experts experts, route each token to top_k.
    """
    def __init__(self, d_model, n_experts=8, top_k=2, d_ff=256, init='glorot'):
        super().__init__()
        self.n_experts = n_experts
        self.top_k     = top_k
        self.gate      = nn.Linear(d_model, n_experts, bias=False)
        self.experts   = nn.ModuleList([
            nn.Sequential(nn.Linear(d_model, d_ff), nn.ReLU(), nn.Linear(d_ff, d_model))
            for _ in range(n_experts)
        ])
        self._apply_init(init)

    def _apply_init(self, mode):
        if mode == 'glorot':
            glorot_init_(self.gate.weight)
        elif mode == 'echo_pair':
            echo_pair_init_(self.gate.weight)

    def forward(self, x):
        # x: (batch, d_model)
        logits  = self.gate(x)                          # (B, E)
        probs   = F.softmax(logits, dim=-1)             # (B, E)
        topk_v, topk_i = probs.topk(self.top_k, dim=-1)
        topk_v  = topk_v / topk_v.sum(dim=-1, keepdim=True)  # renorm

        out = torch.zeros_like(x)
        for k in range(self.top_k):
            expert_ids = topk_i[:, k]          # (B,)
            weights    = topk_v[:, k]          # (B,)
            for e in range(self.n_experts):
                mask = (expert_ids == e)
                if mask.any():
                    out[mask] += weights[mask, None] * self.experts[e](x[mask])
        return out, probs


class SimpleClassifier(nn.Module):
    def __init__(self, d_model=64, n_classes=10, n_experts=8, init='glorot'):
        super().__init__()
        self.embed = nn.Linear(d_model, d_model)
        self.moe   = SparseMoE(d_model, n_experts=n_experts, init=init)
        self.head  = nn.Linear(d_model, n_classes)

    def forward(self, x):
        x, probs = self.moe(F.relu(self.embed(x)))
        return self.head(x), probs


# ── Metrics ────────────────────────────────────────────────────────────────────

def routing_entropy(probs):
    """Mean per-sample routing entropy. Max = ln(n_experts)."""
    return -(probs * (probs + 1e-9).log()).sum(dim=-1).mean().item()


def expert_load(probs, n_experts):
    """Fraction of tokens assigned to each expert (top-1)."""
    top1 = probs.argmax(dim=-1)
    return torch.bincount(top1, minlength=n_experts).float() / len(top1)


# ── Training loop ──────────────────────────────────────────────────────────────

def train(init_name, n_steps=500, batch=128, d_model=64, n_classes=10, n_experts=8):
    torch.manual_seed(SEED)
    model = SimpleClassifier(d_model=d_model, n_classes=n_classes,
                             n_experts=n_experts, init=init_name).to(DEVICE)
    opt   = torch.optim.Adam(model.parameters(), lr=1e-3)

    log = {'step': [], 'loss': [], 'entropy': [], 'load_std': []}

    for step in range(n_steps):
        # Synthetic classification task
        X = torch.randn(batch, d_model, device=DEVICE)
        y = torch.randint(0, n_classes, (batch,), device=DEVICE)

        logits, probs = model(X)
        loss = F.cross_entropy(logits, y)
        opt.zero_grad(); loss.backward(); opt.step()

        if step % 10 == 0:
            with torch.no_grad():
                H     = routing_entropy(probs)
                load  = expert_load(probs, n_experts)
                lstd  = load.std().item()
            log['step'].append(step)
            log['loss'].append(loss.item())
            log['entropy'].append(H)
            log['load_std'].append(lstd)

    return log


def run():
    print("Training with Glorot gate init...")
    log_g = train('glorot')
    print("Training with Echo-Pair gate init...")
    log_e = train('echo_pair')

    max_H = np.log(8)
    print(f"\n{'='*55}")
    print(f"  Results after {log_g['step'][-1]} steps")
    print(f"  Max routing entropy (ln 8) = {max_H:.3f}")
    print(f"{'='*55}")
    for name, log in [('glorot', log_g), ('echo_pair', log_e)]:
        h_early = np.mean(log['entropy'][:5])
        h_late  = np.mean(log['entropy'][-5:])
        ls_late = np.mean(log['load_std'][-5:])
        print(f"  [{name:>10}]  entropy: {h_early:.3f} → {h_late:.3f}"
              f"   load_std(late): {ls_late:.3f}")
    print(f"{'='*55}")
    print()
    print("  Interpretation:")
    print("  - Higher entropy = more even routing (less collapse)")
    print("  - Lower load_std = experts more equally utilized")
    print("  - Echo-pair should start and stay closer to max entropy")

    # Plot
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4))
    fig.suptitle('Echo-Pair vs Glorot: MoE Gate Init Comparison', fontsize=12)

    ax1.plot(log_g['step'], log_g['entropy'], label='Glorot', color='#00e5ff', alpha=0.85)
    ax1.plot(log_e['step'], log_e['entropy'], label='Echo-Pair', color='#ff9800', alpha=0.85)
    ax1.axhline(max_H, color='#666', linestyle='--', alpha=0.5, label=f'max (ln 8={max_H:.2f})')
    ax1.set_xlabel('Step'); ax1.set_ylabel('Routing Entropy')
    ax1.set_title('Routing Entropy (higher = more even)')
    ax1.legend(); ax1.grid(alpha=0.15)

    ax2.plot(log_g['step'], log_g['load_std'], label='Glorot', color='#00e5ff', alpha=0.85)
    ax2.plot(log_e['step'], log_e['load_std'], label='Echo-Pair', color='#ff9800', alpha=0.85)
    ax2.set_xlabel('Step'); ax2.set_ylabel('Expert Load Std')
    ax2.set_title('Expert Load Imbalance (lower = more even)')
    ax2.legend(); ax2.grid(alpha=0.15)

    plt.tight_layout()
    plt.savefig('echo_pair_moe_comparison.png', dpi=140, bbox_inches='tight')
    print("\n  Plot saved: echo_pair_moe_comparison.png")


if __name__ == '__main__':
    run()
