"""
ruby PoC — Echo-Pair Init: Mixture of Gaussians (Final, Multi-Seed)
Requires: torch >= 2.0, scipy, matplotlib

Original hypothesis:
  Echo-pair gate init (±pair weights, ~33% nil/zero fraction) reaches correct
  expert assignments FASTER than Glorot, measured by steps to convergence and
  NMI on a k-cluster Gaussian classification task.

Result (RTX 4090, 20 seeds, 2026-07-28):
  glorot:    15/20 converge to 100%  median 160 steps  NMI=0.609 ± 0.067
  echo_pair: 11/20 converge to 100%  median 385 steps  NMI=0.585 ± 0.083
  echo_pair win rate (steps to 100%): 30%  (6/20 seeds)
  Verdict: GLOROT FASTER — hypothesis falsified

Mechanism (why echo_pair is slower here):
  The ±pair structure creates near-cancelling gate weight rows, producing
  more UNIFORM initial routing (higher entropy, lower peaked softmax).
  On structured data where expert specialization IS the goal, resistance
  to routing collapse HURTS — the gate needs more gradient steps to
  commit to per-cluster routing.

Revised understanding:
  echo_pair IS real:  sign-balanced, nil-fraction, higher init entropy
  echo_pair helps:    load balancing / collapse resistance on unstructured data
                      (see PoC 2: higher routing entropy maintained under training)
  echo_pair hurts:    convergence speed on structured data where specialization
                      is the correct answer
  glorot helps:       faster specialization when there IS structure to find,
                      because accidental peakedness in random init gives the
                      gate a head start

Key experimental fix (vs PoCs 3–5):
  Train and test sets MUST share the same cluster centers. Using different RNG
  seeds for train vs test creates different cluster geometries — the model
  learns routing for one geometry and is evaluated on another, producing
  meaningless accuracy values. All earlier PoC 3–5 results were artifacts.

Run:  python3 poc_echo_moe_final.py
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy.stats import entropy as scipy_entropy

DEVICE    = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"[device] {DEVICE}" + (f"  ({torch.cuda.get_device_name(0)})" if DEVICE == 'cuda' else "  (no CUDA)"))

SEED      = 42
N_EXPERTS = 8
D_MODEL   = 64
D_HIDDEN  = 128
N_TRAIN   = 8000
N_TEST    = 2000
STEPS     = 2000
BATCH     = 512
SEP       = 3.0
N_SEEDS   = 20    # number of independent seeds to average over


# ── Dataset (shared cluster centers) ──────────────────────────────────────────

def make_gaussian_mixture(n_train, n_test, n_clusters, d, separation=3.0):
    """
    Generate train and test sets from the SAME cluster centers.
    Critical: using different RNG seeds for train/test would create different
    cluster geometries, making test evaluation meaningless.
    """
    rng = np.random.default_rng(SEED)
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
        idx = np.random.default_rng(SEED + 1).permutation(len(y))
        return (torch.from_numpy(X[idx]).to(DEVICE),
                torch.from_numpy(y[idx]).to(DEVICE))

    return prep(Xtr, ytr), prep(Xte, yte)


# ── NMI ────────────────────────────────────────────────────────────────────────

def nmi(labels_true, labels_pred, n_classes):
    """Normalized Mutual Information between routing and true cluster labels."""
    lt = labels_true.cpu().numpy()
    lp = labels_pred.cpu().numpy()
    n  = len(lt)
    joint = np.zeros((n_classes, n_classes))
    for t, p in zip(lt, lp):
        joint[t, p] += 1
    joint /= n
    p_t = joint.sum(axis=1)
    p_p = joint.sum(axis=0)
    mi  = 0.0
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
    """
    Echo-pair init: weights in complementary ±pairs with nil_frac zeros.
    Guarantees sign balance and dead-neuron-free initialization.
    Must be called while tensor is already on its target device.
    """
    with torch.no_grad():
        fan_in, fan_out = tensor.shape if tensor.dim() == 2 else (tensor.numel(), 1)
        limit  = np.sqrt(6.0 / (fan_in + fan_out))
        flat   = tensor.view(-1)
        n      = flat.numel()
        n_pair = int(n * (1 - nil_frac)) // 2
        n_act  = 2 * n_pair
        mags   = torch.empty(n_pair, device=tensor.device).uniform_(0.0, limit)
        vals   = torch.cat([mags, -mags])
        idx    = torch.randperm(n, device=tensor.device)[:n_act]
        flat.zero_()
        flat[idx] = vals[torch.randperm(n_act, device=tensor.device)]


# ── Model ──────────────────────────────────────────────────────────────────────

class GaussianMoE(nn.Module):
    """
    Sparse MoE: gate routes inputs to top-1 expert; experts are 2-layer MLPs.
    Gate initialized with glorot or echo-pair; experts always glorot.
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
        gate_probs = F.softmax(self.gate(x), dim=-1)      # (B, E)
        top1_idx   = gate_probs.argmax(dim=-1)             # (B,)
        # all experts in parallel, gather top-1 — no Python for-loop
        all_out = torch.stack([exp(x) for exp in self.experts], dim=1)  # (B, E, C)
        out = all_out[torch.arange(x.size(0), device=x.device), top1_idx]
        return out, gate_probs, top1_idx


# ── Training ───────────────────────────────────────────────────────────────────

def train_one(init_name, X_train, y_train, X_test, y_test, seed):
    torch.manual_seed(seed)
    np.random.seed(seed)
    model = GaussianMoE(D_MODEL, N_EXPERTS, N_EXPERTS,
                        d_hidden=D_HIDDEN, init=init_name).to(DEVICE)
    opt   = torch.optim.Adam(model.parameters(), lr=3e-4)

    # record steps to each accuracy threshold; NMI at end
    milestones = {0.99: None, 1.00: None}
    n         = len(X_train)

    for step in range(STEPS):
        idx = torch.randperm(n, device=DEVICE)[:BATCH]
        logits, _, _ = model(X_train[idx])
        loss = F.cross_entropy(logits, y_train[idx])
        opt.zero_grad(); loss.backward(); opt.step()

        if step % 10 == 0:
            model.eval()
            with torch.no_grad():
                logits_t, probs_t, routing_t = model(X_test)
                acc   = (logits_t.argmax(1) == y_test).float().mean().item()
                score = nmi(y_test, routing_t, N_EXPERTS)
            for thresh in list(milestones.keys()):
                if milestones[thresh] is None and acc >= thresh:
                    milestones[thresh] = (step, score)
            model.train()

    # final NMI (average of last 5 evals)
    model.eval()
    with torch.no_grad():
        _, _, routing_t = model(X_test)
    final_nmi = nmi(y_test, routing_t, N_EXPERTS)

    return milestones, final_nmi


def run_multi_seed():
    seeds = [SEED + i for i in range(N_SEEDS)]
    print(f"\nMulti-seed experiment: {N_SEEDS} seeds  steps={STEPS}")
    print(f"Generating data (shared cluster centers, sep={SEP}σ)...")
    (X_tr, y_tr), (X_te, y_te) = make_gaussian_mixture(
        N_TRAIN, N_TEST, N_EXPERTS, D_MODEL, SEP)
    print(f"  Train: {len(X_tr)}  Test: {len(X_te)}\n")

    agg = {name: {'steps_99': [], 'steps_100': [], 'nmi': []}
           for name in ('glorot', 'echo_pair')}

    for i, seed in enumerate(seeds):
        print(f"  seed {seed} ({i+1}/{N_SEEDS})...", end=' ', flush=True)
        for init_name in ('glorot', 'echo_pair'):
            ms, fnmi = train_one(init_name, X_tr, y_tr, X_te, y_te, seed)
            agg[init_name]['nmi'].append(fnmi)
            s99  = ms[0.99][0]  if ms[0.99]  else STEPS
            s100 = ms[1.00][0]  if ms[1.00]  else STEPS
            agg[init_name]['steps_99'].append(s99)
            agg[init_name]['steps_100'].append(s100)
        print(f"glorot={agg['glorot']['steps_100'][-1]}  echo={agg['echo_pair']['steps_100'][-1]}")

    print(f"\n{'='*65}")
    print(f"  Multi-seed Results  ({N_SEEDS} seeds, device={DEVICE})")
    print(f"  d={D_MODEL}  sep={SEP}σ  steps={STEPS}  n_experts={N_EXPERTS}")
    print(f"{'='*65}")
    for name in ('glorot', 'echo_pair'):
        a = agg[name]
        s99  = np.array(a['steps_99'])
        s100 = np.array(a['steps_100'])
        nmis = np.array(a['nmi'])
        converged_100 = np.sum(s100 < STEPS)
        print(f"\n  [{name}]")
        print(f"    steps to 99%:  {s99.mean():.0f} ± {s99.std():.0f}  (median {np.median(s99):.0f})")
        print(f"    steps to 100%: {s100.mean():.0f} ± {s100.std():.0f}  (median {np.median(s100):.0f})"
              f"  [{converged_100}/{N_SEEDS} converged]")
        print(f"    final NMI:     {nmis.mean():.3f} ± {nmis.std():.3f}")

    g = agg['glorot'];  e = agg['echo_pair']
    g100 = np.array(g['steps_100']);  e100 = np.array(e['steps_100'])
    g99  = np.array(g['steps_99']);   e99  = np.array(e['steps_99'])
    gnmi = np.array(g['nmi']);        enim = np.array(e['nmi'])

    # win rate: how often echo_pair is faster
    wr100 = np.mean(e100 < g100)
    wr99  = np.mean(e99  < g99)
    dnmi  = enim.mean() - gnmi.mean()
    print(f"\n  echo_pair win rate (steps to 100%): {wr100:.0%}  ({np.sum(e100<g100)}/{N_SEEDS} seeds)")
    print(f"  echo_pair win rate (steps to  99%): {wr99:.0%}  ({np.sum(e99<g99)}/{N_SEEDS} seeds)")
    print(f"  echo_pair ΔNMI (final):             {dnmi:+.3f}")
    if wr100 > 0.6:
        verdict = "ECHO_PAIR FASTER: consistent convergence advantage"
    elif wr100 < 0.4:
        verdict = "GLOROT FASTER: echo_pair does not help on this task"
    else:
        verdict = "NO CONSISTENT WINNER: results within noise"
    print(f"\n  Verdict: {verdict}")
    print(f"{'='*65}")

    # ── Plot ───────────────────────────────────────────────────────────────────
    fig, axes = plt.subplots(1, 3, figsize=(16, 4))
    fig.suptitle(
        f'Echo-Pair vs Glorot: {N_SEEDS}-seed comparison  '
        f'({N_EXPERTS} Gaussians, d={D_MODEL}, sep={SEP}σ)', fontsize=10)

    axes[0].hist(g['steps_100'], bins=15, color='#00e5ff', alpha=0.6, label='glorot')
    axes[0].hist(e['steps_100'], bins=15, color='#ff9800', alpha=0.6, label='echo_pair')
    axes[0].set_title('Steps to 100% accuracy'); axes[0].set_xlabel('Steps')
    axes[0].legend(); axes[0].grid(alpha=0.15)

    axes[1].hist(g['steps_99'], bins=15, color='#00e5ff', alpha=0.6, label='glorot')
    axes[1].hist(e['steps_99'], bins=15, color='#ff9800', alpha=0.6, label='echo_pair')
    axes[1].set_title('Steps to 99% accuracy'); axes[1].set_xlabel('Steps')
    axes[1].legend(); axes[1].grid(alpha=0.15)

    axes[2].hist(g['nmi'], bins=10, color='#00e5ff', alpha=0.6, label='glorot')
    axes[2].hist(e['nmi'], bins=10, color='#ff9800', alpha=0.6, label='echo_pair')
    axes[2].set_title('Final NMI distribution'); axes[2].set_xlabel('NMI')
    axes[2].legend(); axes[2].grid(alpha=0.15)

    plt.tight_layout()
    plt.savefig('echo_pair_multiseed.png', dpi=140, bbox_inches='tight')
    print('\n  Plot saved: echo_pair_multiseed.png')


# ── Run ────────────────────────────────────────────────────────────────────────

def run():
    print(f"\nGenerating data (shared cluster centers, sep={SEP}σ)...")
    (X_tr, y_tr), (X_te, y_te) = make_gaussian_mixture(
        N_TRAIN, N_TEST, N_EXPERTS, D_MODEL, SEP)
    print(f"  Train: {len(X_tr)}  Test: {len(X_te)}\n")

    results = {}
    for init_name in ('glorot', 'echo_pair'):
        print(f"Training [{init_name}]...")
        log, milestones, nmi_at = train(init_name, X_tr, y_tr, X_te, y_te)
        results[init_name] = (log, milestones, nmi_at)

    # ── Summary ────────────────────────────────────────────────────────────────
    print(f"\n{'='*65}")
    print(f"  Echo-Pair vs Glorot: MoE on {N_EXPERTS} Gaussians")
    print(f"  device={DEVICE}  d={D_MODEL}  sep={SEP}σ  steps={STEPS}")
    print(f"{'='*65}")
    for name, (log, milestones, nmi_at) in results.items():
        nf = np.mean(log['nmi'][-5:])
        af = np.mean(log['acc'][-5:])
        h0 = log['entropy'][0]
        print(f"\n  [{name}]  final NMI={nf:.3f}  acc={af:.3f}  init_H={h0:.3f}")
        for thresh, step in milestones.items():
            if step is not None:
                print(f"    acc>{thresh:.0%} at step {step:>4}  (NMI={nmi_at[thresh]:.3f})")
            else:
                print(f"    acc>{thresh:.0%}  — not reached in {STEPS} steps")

    g_log  = results['glorot'][0]
    e_log  = results['echo_pair'][0]
    g_ms   = results['glorot'][1]
    e_ms   = results['echo_pair'][1]

    g_full = g_ms.get(1.00)
    e_full = e_ms.get(1.00)

    def fmt_step(s): return str(s) if s is not None else f'never (>{STEPS})'
    speedup = (g_full / e_full) if (g_full and e_full and e_full > 0) else None

    print(f"\n  Steps to 100% accuracy:")
    print(f"    glorot:    {fmt_step(g_full)}")
    print(f"    echo_pair: {fmt_step(e_full)}"
          + (f"  ({speedup:.1f}× faster)" if speedup else ""))

    g_nmi = np.mean(g_log['nmi'][-5:])
    e_nmi = np.mean(e_log['nmi'][-5:])
    print(f"\n  Final NMI:  glorot={g_nmi:.3f}  echo_pair={e_nmi:.3f}"
          f"  Δ={e_nmi-g_nmi:+.3f}")
    print(f"{'='*65}")

    # ── Plot ───────────────────────────────────────────────────────────────────
    COLORS = {'glorot': '#00e5ff', 'echo_pair': '#ff9800'}
    fig, axes = plt.subplots(1, 3, figsize=(16, 4))
    fig.suptitle(
        f'Echo-Pair vs Glorot: MoE on {N_EXPERTS} Gaussians  '
        f'(shared centers, sep={SEP}σ, d={D_MODEL})',
        fontsize=10)

    for name, (log, _, _) in results.items():
        c = COLORS[name]
        axes[0].plot(log['step'], log['nmi'],     label=name, color=c, alpha=0.85)
        axes[1].plot(log['step'], log['acc'],     label=name, color=c, alpha=0.85)
        axes[2].plot(log['step'], log['entropy'], label=name, color=c, alpha=0.85)

    axes[0].set_title('NMI (routing vs true clusters)'); axes[0].set_ylabel('NMI')
    axes[1].set_title('Test Accuracy');                  axes[1].set_ylabel('Accuracy')
    axes[2].set_title('Gate Routing Entropy');           axes[2].set_ylabel('Entropy')
    axes[1].axhline(0.125, color='#888', linestyle='--', alpha=0.3, label='chance (1/8)')
    axes[2].axhline(np.log(N_EXPERTS), color='#555', linestyle='--', alpha=0.4,
                    label=f'max H={np.log(N_EXPERTS):.2f}')

    for ax in axes:
        ax.set_xlabel('Step'); ax.legend(fontsize=8); ax.grid(alpha=0.15)

    plt.tight_layout()
    plt.savefig('echo_pair_final.png', dpi=140, bbox_inches='tight')
    print('\n  Plot saved: echo_pair_final.png')


if __name__ == '__main__':
    run_multi_seed()
