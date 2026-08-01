"""
ruby PoC 3 — Echo-Pair Init: Structured MoE on Mixture of Gaussians
Requires: torch >= 2.0

Hypothesis:
  On data with genuine cluster structure (one Gaussian per expert),
  echo-pair gate init reaches correct expert assignments FASTER than Glorot,
  measured by NMI between learned routing and true cluster labels.

The key difference from the random-data test (PoC 2):
  - There IS a right answer here: expert k should route cluster k
  - We measure convergence to that answer, not just entropy
  - If echo-pair's "faster specialization" is real learning, NMI rises faster

Run:  python3 poc_echo_moe_gaussian.py
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy.stats import entropy as scipy_entropy

DEVICE     = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"[device] {DEVICE}" + (f"  ({torch.cuda.get_device_name(0)})" if DEVICE == 'cuda' else "  (no CUDA)"))
SEED       = 42
N_EXPERTS  = 8
D_MODEL    = 64
N_TRAIN    = 8000   # 1000 samples per cluster
N_TEST     = 2000
STEPS      = 10000
BATCH      = 512
D_HIDDEN   = 128    # expert hidden dim (MLP experts)
torch.manual_seed(SEED)
np.random.seed(SEED)


# ── Dataset ────────────────────────────────────────────────────────────────────

def make_gaussian_mixture(n_samples, n_clusters, d, separation=4.0, rng=None):
    """
    n_samples points from n_clusters Gaussians in R^d.
    Centers placed on a scaled identity basis (well-separated).
    Returns X (n_samples, d), y (n_samples,) — true cluster labels.
    """
    if rng is None:
        rng = np.random.default_rng(SEED)
    centers = rng.normal(0, separation, size=(n_clusters, d))
    per     = n_samples // n_clusters
    Xs, ys  = [], []
    for k in range(n_clusters):
        X = rng.normal(centers[k], 1.0, size=(per, d))
        Xs.append(X); ys.append(np.full(per, k))
    X = np.vstack(Xs).astype(np.float32)
    y = np.concatenate(ys).astype(np.int64)
    idx = rng.permutation(len(y))
    return torch.from_numpy(X[idx]), torch.from_numpy(y[idx])


# ── NMI (Normalized Mutual Information) ───────────────────────────────────────

def nmi(labels_true, labels_pred, n_classes):
    """Normalized Mutual Information between two label arrays."""
    labels_true = labels_true.cpu().numpy()
    labels_pred = labels_pred.cpu().numpy()
    n = len(labels_true)

    # Joint distribution
    joint = np.zeros((n_classes, n_classes))
    for t, p in zip(labels_true, labels_pred):
        joint[t, p] += 1
    joint /= n

    p_t = joint.sum(axis=1)
    p_p = joint.sum(axis=0)

    # Mutual information
    mi = 0.0
    for i in range(n_classes):
        for j in range(n_classes):
            if joint[i, j] > 0 and p_t[i] > 0 and p_p[j] > 0:
                mi += joint[i, j] * np.log(joint[i, j] / (p_t[i] * p_p[j]))

    h_t = scipy_entropy(p_t + 1e-12)
    h_p = scipy_entropy(p_p + 1e-12)
    return 0.0 if (h_t + h_p) == 0 else 2 * mi / (h_t + h_p)


# ── Init strategies (same as PoC 2) ───────────────────────────────────────────

def glorot_init_(tensor):
    nn.init.xavier_uniform_(tensor)


def echo_pair_init_(tensor, nil_frac=0.33):
    with torch.no_grad():
        fan_in, fan_out = tensor.shape if tensor.dim() == 2 else (tensor.numel(), 1)
        limit  = np.sqrt(6.0 / (fan_in + fan_out))
        flat   = tensor.view(-1)
        n      = flat.numel()
        n_pair = int(n * (1 - nil_frac)) // 2
        n_act  = 2 * n_pair
        mags   = torch.empty(n_pair).uniform_(0.0, limit)
        vals   = torch.cat([mags, -mags])
        idx    = torch.randperm(n)[:n_act]
        flat.zero_()
        flat[idx] = vals[torch.randperm(n_act)]


# ── Model ──────────────────────────────────────────────────────────────────────

class GaussianMoE(nn.Module):
    """
    Sparse MoE for cluster classification.
    Gate routes inputs to top-1 expert; experts are 2-layer MLPs.
    """
    def __init__(self, d_in, n_experts, n_classes, d_hidden=128, init='glorot'):
        super().__init__()
        self.n_experts = n_experts
        self.gate      = nn.Linear(d_in, n_experts, bias=False)
        self.experts   = nn.ModuleList([
            nn.Sequential(
                nn.Linear(d_in, d_hidden), nn.ReLU(),
                nn.Linear(d_hidden, n_classes)
            ) for _ in range(n_experts)
        ])
        if init == 'echo_pair':
            echo_pair_init_(self.gate.weight)
        else:
            glorot_init_(self.gate.weight)

    def forward(self, x):
        gate_logits = self.gate(x)                            # (B, E)
        gate_probs  = F.softmax(gate_logits, dim=-1)          # (B, E)
        top1_idx    = gate_probs.argmax(dim=-1)               # (B,)

        # Run all experts in parallel, gather top-1 per sample — no Python loop
        all_out = torch.stack([exp(x) for exp in self.experts], dim=1)  # (B, E, C)
        out = all_out[torch.arange(x.size(0), device=x.device), top1_idx]  # (B, C)
        return out, gate_probs, top1_idx


# ── Training ───────────────────────────────────────────────────────────────────

def train(init_name, X_train, y_train, X_test, y_test):
    torch.manual_seed(SEED)
    model = GaussianMoE(D_MODEL, N_EXPERTS, N_EXPERTS, d_hidden=D_HIDDEN, init=init_name).to(DEVICE)
    opt   = torch.optim.Adam(model.parameters(), lr=3e-4)

    log = {'step': [], 'acc': [], 'nmi': [], 'entropy': []}
    n   = len(X_train)

    for step in range(STEPS):
        idx = torch.randperm(n, device=DEVICE)[:BATCH]
        xb, yb = X_train[idx], y_train[idx]

        logits, probs, _ = model(xb)
        loss = F.cross_entropy(logits, yb)
        opt.zero_grad(); loss.backward(); opt.step()

        if step % 10 == 0:
            model.eval()
            with torch.no_grad():
                logits_t, probs_t, routing_t = model(X_test)
                acc = (logits_t.argmax(1) == y_test).float().mean().item()
                score = nmi(y_test, routing_t, N_EXPERTS)
                H = -(probs_t * (probs_t + 1e-9).log()).sum(dim=-1).mean().item()
            log['step'].append(step)
            log['acc'].append(acc)
            log['nmi'].append(score)
            log['entropy'].append(H)
            model.train()

    return log


def run():
    print("Generating Mixture of Gaussians dataset...")
    X_tr, y_tr = make_gaussian_mixture(N_TRAIN, N_EXPERTS, D_MODEL, separation=3.0)
    X_te, y_te = make_gaussian_mixture(N_TEST,  N_EXPERTS, D_MODEL, separation=3.0,
                                        rng=np.random.default_rng(99))

    X_tr, y_tr = X_tr.to(DEVICE), y_tr.to(DEVICE)
    X_te, y_te = X_te.to(DEVICE), y_te.to(DEVICE)
    print(f"  Train: {len(X_tr)} samples  Test: {len(X_te)} samples")
    print(f"  {N_EXPERTS} clusters, d={D_MODEL}, separation=3.0σ, steps={STEPS}, experts=MLP({D_HIDDEN})\n")

    print("Training Glorot init...")
    log_g = train('glorot',    X_tr, y_tr, X_te, y_te)
    print("Training Echo-Pair init...")
    log_e = train('echo_pair', X_tr, y_tr, X_te, y_te)

    # ── Summary ────────────────────────────────────────────────────────────────
    def first_above(log, key, thresh, default=STEPS):
        """Step at which metric first crosses threshold."""
        for s, v in zip(log['step'], log[key]):
            if v >= thresh: return s
        return default

    nmi_thresh = 0.65
    acc_thresh = 0.70
    g_nmi50 = first_above(log_g, 'nmi', nmi_thresh)
    e_nmi50 = first_above(log_e, 'nmi', nmi_thresh)
    g_acc80 = first_above(log_g, 'acc', acc_thresh)
    e_acc80 = first_above(log_e, 'acc', acc_thresh)

    max_H = np.log(N_EXPERTS)
    g_nmi_final = np.mean(log_g['nmi'][-5:])
    e_nmi_final = np.mean(log_e['nmi'][-5:])
    g_acc_final = np.mean(log_g['acc'][-5:])
    e_acc_final = np.mean(log_e['acc'][-5:])

    print(f"\n{'='*60}")
    print(f"  MoE on Mixture of Gaussians ({N_EXPERTS} clusters, device={DEVICE})")
    print(f"{'='*60}")
    for name, log, nmi_f, acc_f in [
        ('glorot',    log_g, g_nmi_final, g_acc_final),
        ('echo_pair', log_e, e_nmi_final, e_acc_final),
    ]:
        print(f"  [{name:>10}]  NMI={nmi_f:.3f}  acc={acc_f:.3f}  init_H={log['entropy'][0]:.3f}")
    nmi_delta = e_nmi_final - g_nmi_final
    acc_delta = e_acc_final - g_acc_final
    print(f"\n  Echo-pair Δ NMI : {nmi_delta:+.3f}  ({'better' if nmi_delta > 0 else 'worse'})")
    print(f"  Echo-pair Δ acc : {acc_delta:+.3f}  ({'better' if acc_delta > 0 else 'worse'})")
    print(f"\n  Steps to NMI>{nmi_thresh}:")
    print(f"    glorot:    {g_nmi50 if g_nmi50 < STEPS else 'never'}")
    print(f"    echo_pair: {e_nmi50 if e_nmi50 < STEPS else 'never'}")
    print(f"{'='*60}")

    # ── Plot ───────────────────────────────────────────────────────────────────
    fig, axes = plt.subplots(1, 3, figsize=(15, 4))
    fig.suptitle(f'Echo-Pair vs Glorot: MoE on Mixture of {N_EXPERTS} Gaussians',
                 fontsize=12)

    axes[0].plot(log_g['step'], log_g['nmi'], label='Glorot',    color='#00e5ff', alpha=0.85)
    axes[0].plot(log_e['step'], log_e['nmi'], label='Echo-Pair', color='#ff9800', alpha=0.85)
    axes[0].axhline(nmi_thresh, color='#888', linestyle='--', alpha=0.5,
                    label=f'NMI={nmi_thresh}')
    axes[0].set_xlabel('Step'); axes[0].set_ylabel('NMI (routing vs true clusters)')
    axes[0].set_title('Expert Assignment Quality\n(NMI — higher = better)')
    axes[0].legend(); axes[0].grid(alpha=0.15)

    axes[1].plot(log_g['step'], log_g['acc'], label='Glorot',    color='#00e5ff', alpha=0.85)
    axes[1].plot(log_e['step'], log_e['acc'], label='Echo-Pair', color='#ff9800', alpha=0.85)
    axes[1].axhline(acc_thresh, color='#888', linestyle='--', alpha=0.5,
                    label=f'acc={acc_thresh}')
    axes[1].set_xlabel('Step'); axes[1].set_ylabel('Test Accuracy')
    axes[1].set_title('Classification Accuracy\n(higher = better)')
    axes[1].legend(); axes[1].grid(alpha=0.15)

    axes[2].plot(log_g['step'], log_g['entropy'], label='Glorot',    color='#00e5ff', alpha=0.85)
    axes[2].plot(log_e['step'], log_e['entropy'], label='Echo-Pair', color='#ff9800', alpha=0.85)
    axes[2].axhline(max_H, color='#666', linestyle='--', alpha=0.5,
                    label=f'max ln({N_EXPERTS})={max_H:.2f}')
    axes[2].set_xlabel('Step'); axes[2].set_ylabel('Routing Entropy')
    axes[2].set_title('Gate Routing Entropy\n(tracks specialization)')
    axes[2].legend(); axes[2].grid(alpha=0.15)

    plt.tight_layout()
    plt.savefig('echo_pair_gaussian.png', dpi=140, bbox_inches='tight')
    print('\n  Plot saved: echo_pair_gaussian.png')
    print('\n  Key: if echo_pair reaches NMI>0.5 faster → it finds cluster')
    print('       assignments faster = "faster specialization" is real learning')


if __name__ == '__main__':
    run()
