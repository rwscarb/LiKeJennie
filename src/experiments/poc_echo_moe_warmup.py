"""
ruby PoC 4 — Echo-Pair Init: Gate Warmup Experiment
Requires: torch >= 2.0

Motivation (PoC 3 finding):
  Echo-pair gate init already has NMI>0.65 at step 0 — routing is correct
  before training begins. But acc=0.059 < chance, because the gate locked in
  before experts could learn. Glorot's messier routing kept experts exposed to
  mixed data, letting them learn despite worse routing.

  Fix: freeze the gate for WARMUP_STEPS so experts learn cluster features first,
  then unfreeze so echo-pair's structural routing advantage can take over.

Conditions:
  A. glorot          — standard baseline (no warmup)
  B. echo_pair       — no warmup (reproduces PoC 3 failure mode)
  C. echo_pair_warm  — gate frozen for WARMUP_STEPS, then unlocked

Hypothesis: warmup recovers accuracy while preserving echo-pair's NMI lead.

Run:  python3 poc_echo_moe_warmup.py
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy.stats import entropy as scipy_entropy

DEVICE       = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"[device] {DEVICE}" + (f"  ({torch.cuda.get_device_name(0)})" if DEVICE == 'cuda' else "  (no CUDA)"))

SEED         = 42
N_EXPERTS    = 8
D_MODEL      = 64
D_HIDDEN     = 128
N_TRAIN      = 8000
N_TEST       = 2000
STEPS        = 5000
BATCH        = 512
WARMUP_STEPS = 500   # gate frozen; experts train solo
torch.manual_seed(SEED)
np.random.seed(SEED)


# ── Dataset ────────────────────────────────────────────────────────────────────

def make_gaussian_mixture(n_samples, n_clusters, d, separation=3.0, rng=None):
    if rng is None:
        rng = np.random.default_rng(SEED)
    centers = rng.normal(0, separation, size=(n_clusters, d))
    per     = n_samples // n_clusters
    Xs, ys  = [], []
    for k in range(n_clusters):
        Xs.append(rng.normal(centers[k], 1.0, size=(per, d)))
        ys.append(np.full(per, k))
    X = np.vstack(Xs).astype(np.float32)
    y = np.concatenate(ys).astype(np.int64)
    idx = rng.permutation(len(y))
    return torch.from_numpy(X[idx]), torch.from_numpy(y[idx])


# ── NMI ────────────────────────────────────────────────────────────────────────

def nmi(labels_true, labels_pred, n_classes):
    lt = labels_true.cpu().numpy()
    lp = labels_pred.cpu().numpy()
    n  = len(lt)
    joint = np.zeros((n_classes, n_classes))
    for t, p in zip(lt, lp):
        joint[t, p] += 1
    joint /= n
    p_t = joint.sum(axis=1)
    p_p = joint.sum(axis=0)
    mi = 0.0
    for i in range(n_classes):
        for j in range(n_classes):
            if joint[i, j] > 0 and p_t[i] > 0 and p_p[j] > 0:
                mi += joint[i, j] * np.log(joint[i, j] / (p_t[i] * p_p[j]))
    h_t = scipy_entropy(p_t + 1e-12)
    h_p = scipy_entropy(p_p + 1e-12)
    return 0.0 if (h_t + h_p) == 0 else 2 * mi / (h_t + h_p)


# ── Init strategies ────────────────────────────────────────────────────────────

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
        gate_logits = self.gate(x)
        gate_probs  = F.softmax(gate_logits, dim=-1)
        top1_idx    = gate_probs.argmax(dim=-1)
        all_out = torch.stack([exp(x) for exp in self.experts], dim=1)  # (B, E, C)
        out = all_out[torch.arange(x.size(0), device=x.device), top1_idx]
        return out, gate_probs, top1_idx


# ── Training ───────────────────────────────────────────────────────────────────

def train(init_name, X_train, y_train, X_test, y_test, warmup=0):
    torch.manual_seed(SEED)
    model = GaussianMoE(D_MODEL, N_EXPERTS, N_EXPERTS, d_hidden=D_HIDDEN,
                        init=init_name).to(DEVICE)
    opt   = torch.optim.Adam(model.parameters(), lr=3e-4)
    log   = {'step': [], 'acc': [], 'nmi': [], 'entropy': [], 'gate_frozen': []}
    n     = len(X_train)

    for step in range(STEPS):
        gate_frozen = (warmup > 0) and (step < warmup)
        for p in model.gate.parameters():
            p.requires_grad_(not gate_frozen)

        idx = torch.randperm(n, device=DEVICE)[:BATCH]
        xb, yb = X_train[idx], y_train[idx]
        logits, probs, _ = model(xb)
        loss = F.cross_entropy(logits, yb)
        opt.zero_grad(); loss.backward(); opt.step()

        if step % 50 == 0:
            model.eval()
            with torch.no_grad():
                logits_t, probs_t, routing_t = model(X_test)
                acc   = (logits_t.argmax(1) == y_test).float().mean().item()
                score = nmi(y_test, routing_t, N_EXPERTS)
                H     = -(probs_t * (probs_t + 1e-9).log()).sum(dim=-1).mean().item()
            log['step'].append(step)
            log['acc'].append(acc)
            log['nmi'].append(score)
            log['entropy'].append(H)
            log['gate_frozen'].append(gate_frozen)
            model.train()

    # restore gate grad for safety
    for p in model.gate.parameters():
        p.requires_grad_(True)
    return log


# ── Run ────────────────────────────────────────────────────────────────────────

def run():
    print("Generating Mixture of Gaussians dataset...")
    X_tr, y_tr = make_gaussian_mixture(N_TRAIN, N_EXPERTS, D_MODEL)
    X_te, y_te = make_gaussian_mixture(N_TEST,  N_EXPERTS, D_MODEL,
                                        rng=np.random.default_rng(99))
    X_tr, y_tr = X_tr.to(DEVICE), y_tr.to(DEVICE)
    X_te, y_te = X_te.to(DEVICE), y_te.to(DEVICE)
    print(f"  {N_TRAIN} train / {N_TEST} test  |  {N_EXPERTS} clusters  |  "
          f"d={D_MODEL}  sep=3.0σ  steps={STEPS}  warmup={WARMUP_STEPS}\n")

    conditions = [
        ('glorot',         'glorot',    0),
        ('echo_pair',      'echo_pair', 0),
        ('echo_pair_warm', 'echo_pair', WARMUP_STEPS),
    ]
    logs = {}
    for label, init, warmup in conditions:
        print(f"Training [{label}]...")
        logs[label] = train(init, X_tr, y_tr, X_te, y_te, warmup=warmup)

    # ── Summary ────────────────────────────────────────────────────────────────
    print(f"\n{'='*65}")
    print(f"  Gate Warmup Experiment  ({N_EXPERTS} clusters, device={DEVICE})")
    print(f"  Warmup: gate frozen for first {WARMUP_STEPS} steps")
    print(f"{'='*65}")
    rows = []
    for label, _, _ in conditions:
        log = logs[label]
        nmi_f = np.mean(log['nmi'][-5:])
        acc_f = np.mean(log['acc'][-5:])
        h0    = log['entropy'][0]
        rows.append((label, nmi_f, acc_f, h0))
        print(f"  [{label:>16}]  NMI={nmi_f:.3f}  acc={acc_f:.3f}  init_H={h0:.3f}")

    g_nmi  = rows[0][1];  g_acc  = rows[0][2]
    ep_nmi = rows[1][1];  ep_acc = rows[1][2]
    ew_nmi = rows[2][1];  ew_acc = rows[2][2]

    print(f"\n  vs glorot baseline:")
    print(f"    echo_pair (no warm):  ΔNMI={ep_nmi-g_nmi:+.3f}  Δacc={ep_acc-g_acc:+.3f}")
    print(f"    echo_pair (warmup):   ΔNMI={ew_nmi-g_nmi:+.3f}  Δacc={ew_acc-g_acc:+.3f}")

    if ew_nmi > ep_nmi and ew_acc > ep_acc:
        verdict = "WARMUP WINS: higher NMI AND accuracy — hypothesis confirmed"
    elif ew_nmi >= ep_nmi and ew_acc > ep_acc:
        verdict = "WARMUP HELPS ACC: NMI held, acc recovered"
    elif ew_acc > ep_acc:
        verdict = "ACC RECOVERED: accuracy up, NMI tradeoff"
    else:
        verdict = "NO CLEAR WINNER: warmup did not help"
    print(f"\n  Verdict: {verdict}")
    print(f"{'='*65}")

    # ── Plot ───────────────────────────────────────────────────────────────────
    COLORS = {'glorot': '#00e5ff', 'echo_pair': '#ff9800', 'echo_pair_warm': '#c060ff'}
    fig, axes = plt.subplots(1, 3, figsize=(16, 4))
    fig.suptitle(
        f'Echo-Pair Gate Warmup: MoE on {N_EXPERTS} Gaussians  '
        f'(gate frozen first {WARMUP_STEPS} steps)',
        fontsize=11)

    for label, _, _ in conditions:
        log = logs[label]
        c   = COLORS[label]
        axes[0].plot(log['step'], log['nmi'],     label=label, color=c, alpha=0.85)
        axes[1].plot(log['step'], log['acc'],     label=label, color=c, alpha=0.85)
        axes[2].plot(log['step'], log['entropy'], label=label, color=c, alpha=0.85)

    axes[0].axvline(WARMUP_STEPS, color='#888', linestyle=':', alpha=0.5, label='gate unlocks')
    axes[1].axvline(WARMUP_STEPS, color='#888', linestyle=':', alpha=0.5, label='gate unlocks')
    axes[2].axvline(WARMUP_STEPS, color='#888', linestyle=':', alpha=0.5, label='gate unlocks')

    axes[0].set_title('NMI (routing vs true clusters)'); axes[0].set_ylabel('NMI')
    axes[1].set_title('Test Accuracy');                  axes[1].set_ylabel('Accuracy')
    axes[2].set_title('Gate Routing Entropy');           axes[2].set_ylabel('Entropy')
    axes[2].axhline(np.log(N_EXPERTS), color='#555', linestyle='--', alpha=0.4,
                    label=f'max H={np.log(N_EXPERTS):.2f}')

    for ax in axes:
        ax.set_xlabel('Step'); ax.legend(fontsize=8); ax.grid(alpha=0.15)

    plt.tight_layout()
    plt.savefig('echo_pair_warmup.png', dpi=140, bbox_inches='tight')
    print('\n  Plot saved: echo_pair_warmup.png')


if __name__ == '__main__':
    run()
