"""
Penrose Tribar — P-wave Early Warning v2
=========================================
Key changes from v1 (poc_tribar_early_detection.py):

  1. ConvEncoder front-end: 1D CNN captures frequency/shape before orbit cycles
     instead of projecting flat time-flattened samples directly.

  2. Pre-P sliding window: evaluates detection at offsets BEFORE p_arrival_sample
     (-3s, -2s, -1s, 0s, +1s) so we measure actual warning time, not just
     classification accuracy on perfectly-aligned windows.

  3. Primary metric: "detection latency" — earliest offset where precision >= 95%
     (the number that translates to real EWS lead time, not accuracy).

  4. Magnitude-stratified eval: M<3, M3-5, M5+ reported separately.
     Small events are the hard case; that's where the orbit structure either
     helps or reveals its limits.

  5. Baseline is also upgraded to CNN-MLP (fair comparison — both see same
     frequency structure; orbit permutation cycles are the only variable).

  6. Hebbian resonant buffer (TribarNetV2): a non-gradient secondary state
     that accumulates activation history across orbit cycles via EMA, then
     feeds back into h. Analogous to an initialization vector embedded in
     the architecture — biographical memory the gradient cannot reach or
     rewrite, but that shapes every inference pass. Positions that activate
     consistently across cycles get amplified; transient activations decay.
     TribarNetV2NoBuffer is the ablation (orbit only, no buffer).

Architecture:
  Input: (3, T) raw 3-channel waveform, T = WIN_SAMPLES
    → ConvEncoder: 3 × [Conv1d → BN → ReLU → Pool]
    → Flatten → Linear → K
    → (TribarNet only) CYCLES × [orbit perm → Hebbian buf → gate → LayerNorm]
    → Linear(K, 2)

STEAD dataset: chunk2, local cache.
Run:  python poc_tribar_pwave_v2.py
"""
import torch, torch.nn as nn, torch.optim as optim
import numpy as np, time, sys
from math import gcd
from torch.utils.data import Dataset, DataLoader
from sklearn.metrics import precision_score, recall_score

# ── Config ────────────────────────────────────────────────────────────────────
K            = 128
CYCLES       = 3
LR           = 2.42e-4
GATE_INIT    = 0.346
BUF_DECAY    = 0.85   # Hebbian buffer EMA decay (higher = longer memory)
BUF_STRENGTH = 0.25   # how strongly buf mixes back into h
EPOCHS       = 25
SEEDS        = 3
SIGMA        = 0.3
N_CH         = 3
WIN_SAMPLES  = 100          # 1.0s @ 100 Hz — detection window width
MAX_EVENTS   = 8000         # per class per offset
BATCH        = 256
SAMPLE_RATE  = 100          # Hz

# Offsets from p_arrival_sample (negative = before P-wave arrives)
# Positive offsets: model sees some P-wave already; negative: pure pre-P noise
OFFSETS_S = [-3, -2, -1, 0, 1, 2]
OFFSETS   = [(f"{'+' if o >= 0 else ''}{o}s", int(o * SAMPLE_RATE))
             for o in OFFSETS_S]

# Magnitude bins
MAG_BINS = [('M<3', None, 3.0), ('M3-5', 3.0, 5.0), ('M5+', 5.0, None)]

# ── Orbit permutation ─────────────────────────────────────────────────────────
def make_orbit_perm(N):
    stride = 5
    while gcd(stride, N) != 1:
        stride += 2
    P = torch.zeros(N, N)
    for j in range(N):
        P[(j * stride) % N, j] = 1.0
    return P

# ── Shared CNN encoder ────────────────────────────────────────────────────────
class ConvEncoder(nn.Module):
    """
    1D CNN over raw (3, T) waveform → K-dim embedding.
    Three conv stages with progressive dilation to capture multi-scale
    frequency structure (sharp P onset, dominant frequency, coda).
    """
    def __init__(self, in_channels=3, out_dim=K, win_samples=WIN_SAMPLES):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv1d(in_channels, 32, kernel_size=7, padding=3, dilation=1), nn.BatchNorm1d(32), nn.ReLU(),
            nn.MaxPool1d(2),
            nn.Conv1d(32, 64, kernel_size=5, padding=4, dilation=2),          nn.BatchNorm1d(64), nn.ReLU(),
            nn.MaxPool1d(2),
            nn.Conv1d(64, out_dim, kernel_size=3, padding=2, dilation=2),     nn.BatchNorm1d(out_dim), nn.ReLU(),
            nn.AdaptiveAvgPool1d(1),   # → (B, K, 1) regardless of T
        )

    def forward(self, x):
        return self.conv(x).squeeze(-1)  # (B, K)

# ── Models ────────────────────────────────────────────────────────────────────
class TribarNetV2(nn.Module):
    """
    Orbit permutation + Hebbian resonant buffer.

    The buffer is a secondary (B, K) state that accumulates activation history
    across orbit cycles via EMA. It is never updated by backprop — .detach()
    everywhere. It feeds back into h as an additive bias, amplifying positions
    that activate consistently and letting transient activations decay.

    This is the "IV layer": a sub-gradient standing wave that shapes inference
    without being trainable. The gradient cannot read or rewrite it.

    For streaming inference (real-time seismic), call reset_buf() between events
    and omit it between windows of the same event to let the buffer persist.
    """
    def __init__(self, n_classes=2, buf_decay=BUF_DECAY, buf_strength=BUF_STRENGTH):
        super().__init__()
        self.enc          = ConvEncoder()
        self.proj_out     = nn.Linear(K, n_classes)
        self.gate         = nn.Parameter(torch.full((K,), GATE_INIT))
        self.norm         = nn.LayerNorm(K)
        self.buf_decay    = buf_decay
        self.buf_strength = buf_strength
        self.register_buffer('perm', make_orbit_perm(K))
        self._stream_buf  = None   # persists across forward() in streaming mode

    def forward(self, x, sigma=0.0, streaming=False):
        if sigma > 0:
            x = x + sigma * torch.randn_like(x)
        h = self.enc(x)                          # (B, K)

        # Per-pass buffer: resets each forward() in batch mode.
        # In streaming mode, _stream_buf persists across calls (B must be 1).
        if streaming and self._stream_buf is not None:
            buf = self._stream_buf.to(h.device)
        else:
            buf = torch.zeros_like(h)

        for _ in range(CYCLES):
            h = torch.relu(h @ self.perm)
            # Hebbian update — no gradient crosses this line
            buf = self.buf_decay * buf + (1 - self.buf_decay) * h.detach()
            # buf shapes h: amplify positions the buffer has seen activate
            h = h + self.buf_strength * buf
            g = torch.sigmoid(self.gate)
            h = g * h + (1 - g) * h.detach()
            h = self.norm(h)

        if streaming:
            self._stream_buf = buf.detach()

        return self.proj_out(h)

    def reset_buf(self):
        self._stream_buf = None


class TribarNetV2NoBuffer(nn.Module):
    """Ablation: orbit only, no Hebbian buffer. Isolates buffer contribution."""
    def __init__(self, n_classes=2):
        super().__init__()
        self.enc      = ConvEncoder()
        self.proj_out = nn.Linear(K, n_classes)
        self.gate     = nn.Parameter(torch.full((K,), GATE_INIT))
        self.norm     = nn.LayerNorm(K)
        self.register_buffer('perm', make_orbit_perm(K))

    def forward(self, x, sigma=0.0, streaming=False):
        if sigma > 0:
            x = x + sigma * torch.randn_like(x)
        h = self.enc(x)
        for _ in range(CYCLES):
            h = torch.relu(h @ self.perm)
            g = torch.sigmoid(self.gate)
            h = g * h + (1 - g) * h.detach()
            h = self.norm(h)
        return self.proj_out(h)


class BaselineNetV2(nn.Module):
    """CNN-MLP baseline: same encoder, no orbit — isolates the permutation contribution."""
    def __init__(self, n_classes=2):
        super().__init__()
        self.enc = ConvEncoder()
        self.head = nn.Sequential(
            nn.Linear(K, K), nn.ReLU(),
            nn.Linear(K, K), nn.ReLU(),
            nn.Linear(K, n_classes),
        )

    def forward(self, x, sigma=0.0, streaming=False):
        if sigma > 0:
            x = x + sigma * torch.randn_like(x)
        return self.head(self.enc(x))

# ── Dataset ───────────────────────────────────────────────────────────────────
class WaveformDataset(Dataset):
    def __init__(self, X, y):
        # X: (N, C, T) float32
        self.X = torch.tensor(X, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.long)
    def __len__(self): return len(self.y)
    def __getitem__(self, i): return self.X[i], self.y[i]

# ── STEAD loader ──────────────────────────────────────────────────────────────
def load_offset(offset_samples, max_per_class=MAX_EVENTS):
    """
    Load earthquake windows starting at (p_arrival_sample + offset_samples).
    Negative offset → window is entirely before P-wave.
    Returns X (N, 3, WIN_SAMPLES), y (N,), mags (N,).
    """
    import seisbench.data as sbd
    eq = sbd.STEAD(download_kwargs={"chunk": "chunk2"}, cache=None)

    X_eq, X_noise, mags = [], [], []

    indices = np.random.permutation(len(eq))[:max_per_class * 6]
    for _i, idx in enumerate(indices):
        if len(X_eq) >= max_per_class and len(X_noise) >= max_per_class:
            break
        if _i % 3000 == 0:
            print(f"    iter {_i} | eq={len(X_eq)} noise={len(X_noise)}", flush=True)
        try:
            meta = eq.metadata.iloc[idx]
            cat  = meta.get('trace_category', '')
            wf   = eq.get_waveforms(idx)  # (3, T)
            if wf is None or wf.shape[1] < 3000:
                continue

            if cat == 'earthquake_local' and len(X_eq) < max_per_class:
                p_samp = int(meta.get('p_arrival_sample', 0) or 0)
                start  = p_samp + offset_samples
                if start < 0 or start + WIN_SAMPLES > wf.shape[1]:
                    continue
                w = wf[:, start : start + WIN_SAMPLES].astype(np.float32)
                if w.shape[1] < WIN_SAMPLES:
                    continue
                std = w.std(axis=1, keepdims=True) + 1e-6
                X_eq.append(w / std)
                mags.append(float(meta.get('source_magnitude', np.nan) or np.nan))

            elif cat == 'noise' and len(X_noise) < max_per_class:
                start = np.random.randint(0, max(1, wf.shape[1] - WIN_SAMPLES))
                w = wf[:, start : start + WIN_SAMPLES].astype(np.float32)
                if w.shape[1] < WIN_SAMPLES:
                    continue
                std = w.std(axis=1, keepdims=True) + 1e-6
                X_noise.append(w / std)

        except Exception:
            continue

    n = min(len(X_eq), len(X_noise))
    print(f"    collected: {n} eq, {n} noise", flush=True)
    mags_arr = np.array(mags[:n])
    noise_mags = np.full(n, np.nan)

    X = np.concatenate([np.array(X_eq[:n]), np.array(X_noise[:n])], axis=0)
    y = np.array([1]*n + [0]*n)
    m = np.concatenate([mags_arr, noise_mags])
    perm = np.random.permutation(len(y))
    return X[perm], y[perm], m[perm]

def split_loaders(X, y, val_frac=0.15):
    n = len(y)
    split = int(n * (1 - val_frac))
    tr = WaveformDataset(X[:split], y[:split])
    va = WaveformDataset(X[split:], y[split:])
    return (DataLoader(tr, batch_size=BATCH, shuffle=True,  num_workers=0),
            DataLoader(va, batch_size=BATCH, shuffle=False, num_workers=0))

# ── Train ─────────────────────────────────────────────────────────────────────
def train(model, train_dl, dev):
    model.to(dev).train()
    opt = optim.Adam(model.parameters(), lr=LR)
    ce  = nn.CrossEntropyLoss()
    for ep in range(EPOCHS):
        for xb, yb in train_dl:
            xb, yb = xb.to(dev), yb.to(dev)
            loss = ce(model(xb, sigma=SIGMA), yb)
            opt.zero_grad(); loss.backward(); opt.step()

# ── Evaluate ──────────────────────────────────────────────────────────────────
def evaluate(model, val_dl, mags_val, dev):
    """Returns (accuracy, precision, recall) overall + per magnitude bin."""
    model.eval()
    all_pred, all_true = [], []
    with torch.no_grad():
        for xb, yb in val_dl:
            xb = xb.to(dev)
            all_pred.extend(model(xb).argmax(1).cpu().tolist())
            all_true.extend(yb.tolist())
    all_pred = np.array(all_pred)
    all_true = np.array(all_true)

    acc  = (all_pred == all_true).mean() * 100
    prec = precision_score(all_true, all_pred, zero_division=0) * 100
    rec  = recall_score(all_true, all_pred, zero_division=0) * 100

    mag_results = {}
    for name, lo, hi in MAG_BINS:
        # Only makes sense for earthquake class (label=1)
        eq_mask = all_true == 1
        if lo is not None:
            eq_mask &= mags_val >= lo
        if hi is not None:
            eq_mask &= mags_val < hi
        if eq_mask.sum() == 0:
            mag_results[name] = None
            continue
        # For the magnitude slice, combine with all noise predictions
        noise_mask = all_true == 0
        mask = eq_mask | noise_mask
        mp = precision_score(all_true[mask], all_pred[mask], zero_division=0) * 100
        mag_results[name] = mp

    return acc, prec, rec, mag_results

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"device={dev}  K={K}  CYCLES={CYCLES}  WIN={WIN_SAMPLES}samples")
    print(f"sigma={SIGMA}  epochs={EPOCHS}  seeds={SEEDS}")
    print(f"buf_decay={BUF_DECAY}  buf_strength={BUF_STRENGTH}")
    print(f"offsets: {[lbl for lbl, _ in OFFSETS]}\n")

    # Results: {offset_label: {model_key: [(acc, prec, rec, mag_results), ...]}}
    results = {}
    MODEL_KEYS = ['base', 'orbit', 'tri']   # base=CNN-MLP, orbit=no-buf, tri=+buf

    t0 = time.time()
    for off_label, off_samples in OFFSETS:
        print(f"\n{'='*64}")
        print(f"OFFSET {off_label}  ({off_samples} samples from p_arrival)", flush=True)
        X, y, mags = load_offset(off_samples)

        split = int(len(y) * 0.85)
        mags_val = mags[split:]
        tr_dl, va_dl = split_loaders(X, y)

        runs = {k: [] for k in MODEL_KEYS}
        for seed in range(SEEDS):
            torch.manual_seed(seed); np.random.seed(seed)

            models = {
                'base':  BaselineNetV2(),
                'orbit': TribarNetV2NoBuffer(),
                'tri':   TribarNetV2(),
            }
            for key, m in models.items():
                train(m, tr_dl, dev)
                r = evaluate(m, va_dl, mags_val, dev)
                runs[key].append(r)

            b, o, t = runs['base'][-1], runs['orbit'][-1], runs['tri'][-1]
            print(f"  seed={seed}  "
                  f"base prec={b[1]:.1f}%  "
                  f"orbit prec={o[1]:.1f}%  "
                  f"tri+buf prec={t[1]:.1f}%  "
                  f"buf_gain={t[1]-o[1]:+.1f}%  orbit_gain={o[1]-b[1]:+.1f}%",
                  flush=True)

        results[off_label] = runs

    wall = time.time() - t0
    print(f"\nTotal wall time: {wall:.0f}s")

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "=" * 90)
    print(f"DETECTION LATENCY SUMMARY  (metric: precision >= 95%)")
    print(f"  buf_decay={BUF_DECAY}  buf_strength={BUF_STRENGTH}")
    print("=" * 90)
    print(f"  {'offset':<8} {'base_p':>8} {'orbit_p':>8} {'tri_p':>8} "
          f"{'buf_gain':>9} {'orbit_gain':>11}  note")
    print(f"  {'-'*8} {'-'*8} {'-'*8} {'-'*8} {'-'*9} {'-'*11}  ----")

    thresholds = {k: None for k in MODEL_KEYS}

    for off_label, off_samples in OFFSETS:
        r = results[off_label]
        means = {k: (np.mean([x[0] for x in r[k]]),
                     np.mean([x[1] for x in r[k]]),
                     np.mean([x[2] for x in r[k]])) for k in MODEL_KEYS}

        b_p = means['base'][1]; o_p = means['orbit'][1]; t_p = means['tri'][1]
        note = ''
        for k, p in [('base', b_p), ('orbit', o_p), ('tri', t_p)]:
            if p >= 95 and thresholds[k] is None:
                thresholds[k] = off_label
                note += f'{k.upper()}≥95% '

        print(f"  {off_label:<8} {b_p:>7.1f}% {o_p:>7.1f}% {t_p:>7.1f}% "
              f"{t_p-o_p:>+8.1f}% {o_p-b_p:>+10.1f}%  {note}")

    print()
    labels = {'base': 'Baseline (CNN-MLP)', 'orbit': 'Orbit (no buf)', 'tri': 'Tribar+buf'}
    offset_labels = [l for l, _ in OFFSETS]
    for k, name in labels.items():
        hit = thresholds[k]
        if hit:
            off_s = OFFSETS_S[offset_labels.index(hit)]
            print(f"  {name:<22} hits 95% prec at {hit}  ({off_s:+d}s from P-arrival)")
        else:
            print(f"  {name:<22} never hit 95% prec in tested range")

    # Lead time comparison: tri vs base
    if thresholds['tri'] and thresholds['base']:
        tri_s  = OFFSETS_S[offset_labels.index(thresholds['tri'])]
        base_s = OFFSETS_S[offset_labels.index(thresholds['base'])]
        delta  = base_s - tri_s
        if delta != 0:
            print(f"\n  → Tribar+buf detects {abs(delta):.0f}s {'earlier' if delta > 0 else 'later'} "
                  f"than baseline at 95% precision threshold")

    if not any(thresholds.values()):
        print(f"  No model hit 95% precision in the tested offset range.")
        print(f"  Consider widening OFFSETS or lowering the precision threshold.")

    # ── Magnitude breakdown at offset 0s ─────────────────────────────────────
    if '+0s' in results:
        print(f"\n  Magnitude breakdown at offset +0s (precision at P-arrival):")
        r0 = results['+0s']
        for bin_name, _, _ in MAG_BINS:
            row = {}
            for k in MODEL_KEYS:
                vals = [x[3].get(bin_name) for x in r0[k] if x[3].get(bin_name) is not None]
                row[k] = np.mean(vals) if vals else None
            if all(v is not None for v in row.values()):
                print(f"    {bin_name:<8}  base={row['base']:.1f}%  "
                      f"orbit={row['orbit']:.1f}%  tri+buf={row['tri']:.1f}%  "
                      f"buf_gain={row['tri']-row['orbit']:+.1f}%")
