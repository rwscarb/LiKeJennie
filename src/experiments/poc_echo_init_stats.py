"""
ruby PoC 1 — Echo-Pair Init: Statistical Properties
Runs on NumPy only. Compares Glorot vs Echo-Pair initialization.

Echo-pair hypothesis:
  - Guaranteed sign balance within any weight matrix
  - Dead neuron probability at init → 0
  - Routing entropy (for MoE gate) starts higher and is more stable
"""

import numpy as np

RNG = np.random.default_rng(42)


# ── Init strategies ────────────────────────────────────────────────────────────

def glorot_init(fan_in, fan_out, rng=RNG):
    """Standard Xavier/Glorot uniform init."""
    limit = np.sqrt(6.0 / (fan_in + fan_out))
    return rng.uniform(-limit, limit, size=(fan_in, fan_out))


def echo_pair_init(fan_in, fan_out, nil_frac=0.33, rng=RNG):
    """
    Echo-pair init: weights in complementary ±pairs, with nil_frac zeros.
    Guarantees: for every active weight w, there exists a partner -w.
    Nil slots (zero weights) represent the pruned / absent connections.
    """
    W = np.zeros((fan_in, fan_out))
    n_total   = fan_in * fan_out
    n_active  = int(n_total * (1 - nil_frac))
    n_pairs   = n_active // 2

    # Same magnitude scale as Glorot for fair comparison
    limit = np.sqrt(6.0 / (fan_in + fan_out))
    mags  = rng.uniform(0.0, limit, size=n_pairs)
    vals  = np.concatenate([mags, -mags])  # the echo pairs

    idx = rng.permutation(n_total)[:n_active]
    W.flat[idx] = vals[rng.permutation(n_active)]
    return W


# ── Metrics ────────────────────────────────────────────────────────────────────

def sign_balance(W):
    """Fraction of columns where pos_count / neg_count is in [0.5, 2.0]."""
    balanced = 0
    for col in W.T:
        pos = np.sum(col > 0)
        neg = np.sum(col < 0)
        if neg == 0 or pos == 0:
            ratio = 0.0
        else:
            ratio = min(pos, neg) / max(pos, neg)
        if ratio >= 0.5:
            balanced += 1
    return balanced / W.shape[1]


def dead_neuron_frac(W, threshold=0.01):
    """
    Fraction of output neurons whose total input weight magnitude is < threshold.
    Dead at init → likely dead neuron (no gradient signal).
    """
    col_norms = np.linalg.norm(W, axis=0)
    return np.mean(col_norms < threshold)


def routing_entropy(gate_W, n_samples=1000, rng=RNG):
    """
    Simulate MoE routing entropy at init.
    gate_W: (input_dim, n_experts) — the gating weight matrix.
    Returns mean routing entropy over n_samples random inputs.
    """
    fan_in = gate_W.shape[0]
    X = rng.normal(0, 1, size=(n_samples, fan_in))
    logits = X @ gate_W                          # (n_samples, n_experts)
    logits -= logits.max(axis=1, keepdims=True)  # numerical stability
    probs   = np.exp(logits)
    probs  /= probs.sum(axis=1, keepdims=True)   # softmax
    entropy = -np.sum(probs * np.log(probs + 1e-9), axis=1)
    return entropy.mean(), entropy.std()


# ── Run comparison ─────────────────────────────────────────────────────────────

def compare(fan_in=128, fan_out=16, n_experts=8, trials=20):
    print(f"\n{'='*62}")
    print(f"  Echo-Pair vs Glorot Init — {trials} trials")
    print(f"  Weight shape: ({fan_in}, {fan_out})  |  MoE experts: {n_experts}")
    print(f"{'='*62}\n")

    metrics = {
        'glorot':    {'balance': [], 'dead': [], 'h_mean': [], 'h_std': []},
        'echo_pair': {'balance': [], 'dead': [], 'h_mean': [], 'h_std': []},
    }

    for _ in range(trials):
        Wg = glorot_init(fan_in, fan_out)
        We = echo_pair_init(fan_in, fan_out)

        metrics['glorot']['balance'].append(sign_balance(Wg))
        metrics['glorot']['dead'].append(dead_neuron_frac(Wg))

        metrics['echo_pair']['balance'].append(sign_balance(We))
        metrics['echo_pair']['dead'].append(dead_neuron_frac(We))

        # MoE routing entropy (gate matrix: fan_in → n_experts)
        Gg = glorot_init(fan_in, n_experts)
        Ge = echo_pair_init(fan_in, n_experts)
        hg_mean, hg_std = routing_entropy(Gg)
        he_mean, he_std = routing_entropy(Ge)
        metrics['glorot']['h_mean'].append(hg_mean)
        metrics['glorot']['h_std'].append(hg_std)
        metrics['echo_pair']['h_mean'].append(he_mean)
        metrics['echo_pair']['h_std'].append(he_std)

    max_entropy = np.log(n_experts)

    for name, m in metrics.items():
        b  = np.mean(m['balance'])
        d  = np.mean(m['dead'])
        hm = np.mean(m['h_mean'])
        hs = np.mean(m['h_std'])
        print(f"  [{name:>10}]")
        print(f"    Sign-balanced columns : {b*100:.1f}%  (want → 100%)")
        print(f"    Dead neurons at init  : {d*100:.1f}%  (want → 0%)")
        print(f"    Routing entropy       : {hm:.3f} ± {hs:.3f}  "
              f"(max = ln({n_experts}) = {max_entropy:.3f})")
        print()

    print(f"  Nil weight fraction in echo_pair: ~33% (structured sparsity)")
    print(f"  Nil = the absent orbit value (6); pruned connections by design.")
    print(f"\n{'='*62}")


if __name__ == '__main__':
    compare()
    print()
    print("  Interpretation:")
    print("  - Higher sign-balance → better gradient flow symmetry at init")
    print("  - Lower dead fraction → fewer neurons dead before training starts")
    print("  - Higher routing entropy → MoE experts start more evenly loaded")
    print("  - Echo-pair is a structural prior; Glorot is a probabilistic prior.")
    print("  - Echo-pair should reduce need for auxiliary routing loss in MoE.")
