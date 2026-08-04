"""
Oliver42 Corpus — P-wave Early Warning v3
==========================================
New in this version:

  CALLOSAL ARCHITECTURE (CallosalNet):
    Two parallel orbit streams connected by cross-hemisphere bridges.

    Stream A: raw waveform → ConvEncoder → K-dim orbit cycles
    Stream B: complement view (polarity-flip: -x) → ConvEncoder → K-dim orbit cycles
    Callosal bridges: at each orbit cycle step, each stream receives an
      attenuated signal from the other via learned linear projections (small
      init, no gradient crossing the exchange). This models cross-hemisphere
      communication — the corpus callosum.
    Independent Hebbian buffers: each stream maintains its own EMA buffer
      (biographical memory distinct from the other hemisphere's history).
    Output: concat(h_a, h_b) → proj_out → n_classes

  LORE RATIONALE:
    The corpus callosum connects the two hemispheres — not by flowing signal
    across the surface (streaming data), but by tunneling through the interior
    at each step of the orbit. Each callosal exchange uses detached signals:
    the gradient path stays within each stream; the callosal signal shapes
    inference without being directly trained on the communication itself.

    The complement view (polarity flip) is Stream B's "hemisphere": in
    seismology, P-wave first-motion polarity depends on the station's position
    relative to the fault plane. A hemisphere that processes the negated
    waveform may be sensitive to what Stream A misses.

    The Hebbian buffer is the IV layer — inherited biography the gradient
    cannot rewrite. Two streams = two biographies. The callosal bridge is
    what lets them share without merging.

  GARNET RATIO (optional variant):
    K_A=96, K_B=64 → ratio 3:2, matching the garnet crystal formula X₃Y₂(SiO₄)₃
    and the framework's ×3/2 bridge ratio (640×3/2=960). Enable with GARNET=True.

Ablations:
  CallosalNetNoBridge: both streams, Hebbian buffers, NO callosal exchange
    → isolates whether cross-hemisphere communication matters
  CallosalNetNoBuffer: both streams, callosal exchange, NO Hebbian buffers
    → isolates whether biographical memory per hemisphere matters
  TribarNetV2 (from v2): single stream + buffer — the baseline for this
    architecture family

STEAD dataset: chunk2, local cache.
Run:  python poc_oliver42_corpus.py
"""
import torch, torch.nn as nn, torch.optim as optim
import numpy as np, time
from math import gcd
from torch.utils.data import Dataset, DataLoader
from sklearn.metrics import precision_score, recall_score

# ── Config ────────────────────────────────────────────────────────────────────
K             = 128    # hidden dim per stream
GARNET        = False  # if True: K_A=96, K_B=64 (3:2 garnet ratio)
K_A           = 96 if GARNET else K
K_B           = 64 if GARNET else K
CYCLES        = 3
LR            = 2.42e-4
GATE_INIT     = 0.346
BUF_DECAY     = 0.85
BUF_STRENGTH  = 0.25
CAL_STRENGTH  = 0.15   # callosal signal weight (A→B and B→A)
EPOCHS        = 25
SEEDS         = 3
SIGMA         = 0.3
N_CH          = 3
WIN_SAMPLES   = 100
MAX_EVENTS    = 8000
BATCH         = 256
SAMPLE_RATE   = 100

OFFSETS_S = [-3, -2, -1, 0, 1, 2]
OFFSETS   = [(f"{'+' if o >= 0 else ''}{o}s", int(o * SAMPLE_RATE))
             for o in OFFSETS_S]

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
    def __init__(self, in_channels=3, out_dim=K):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv1d(in_channels, 32, kernel_size=7, padding=3, dilation=1),
            nn.BatchNorm1d(32), nn.ReLU(), nn.MaxPool1d(2),
            nn.Conv1d(32, 64, kernel_size=5, padding=4, dilation=2),
            nn.BatchNorm1d(64), nn.ReLU(), nn.MaxPool1d(2),
            nn.Conv1d(64, out_dim, kernel_size=3, padding=2, dilation=2),
            nn.BatchNorm1d(out_dim), nn.ReLU(), nn.AdaptiveAvgPool1d(1),
        )
    def forward(self, x):
        return self.conv(x).squeeze(-1)

# ── CallosalNet ───────────────────────────────────────────────────────────────
class CallosalNet(nn.Module):
    """
    Dual orbit streams with callosal bridges.

    Stream A processes the raw waveform.
    Stream B processes the polarity-flipped complement (-x).
    At each orbit cycle, each stream receives a callosal signal from the other
    via a learned linear projection (small init). The callosal signal is
    detached — it shapes inference but carries no gradient.
    Each stream maintains an independent Hebbian buffer (its own biography).
    Output: concat(h_a, h_b) → 2×K → n_classes.
    """
    def __init__(self, n_classes=2):
        super().__init__()
        self.enc_a = ConvEncoder(out_dim=K_A)
        self.enc_b = ConvEncoder(out_dim=K_B)

        # Callosal projections: A→B and B→A
        self.cal_ab = nn.Linear(K_A, K_B, bias=False)  # A signal into B stream
        self.cal_ba = nn.Linear(K_B, K_A, bias=False)  # B signal into A stream
        nn.init.normal_(self.cal_ab.weight, 0, 0.01)
        nn.init.normal_(self.cal_ba.weight, 0, 0.01)

        self.gate_a  = nn.Parameter(torch.full((K_A,), GATE_INIT))
        self.gate_b  = nn.Parameter(torch.full((K_B,), GATE_INIT))
        self.norm_a  = nn.LayerNorm(K_A)
        self.norm_b  = nn.LayerNorm(K_B)

        self.register_buffer('perm_a', make_orbit_perm(K_A))
        self.register_buffer('perm_b', make_orbit_perm(K_B))

        self.proj_out = nn.Linear(K_A + K_B, n_classes)

        self._buf_a = None
        self._buf_b = None

    def forward(self, x, sigma=0.0, streaming=False):
        if sigma > 0:
            x = x + sigma * torch.randn_like(x)
        x_b = -x  # complement view: polarity flip

        h_a = self.enc_a(x)
        h_b = self.enc_b(x_b)

        if streaming and self._buf_a is not None:
            buf_a = self._buf_a.to(h_a.device)
            buf_b = self._buf_b.to(h_b.device)
        else:
            buf_a = torch.zeros_like(h_a)
            buf_b = torch.zeros_like(h_b)

        for _ in range(CYCLES):
            h_a = torch.relu(h_a @ self.perm_a)
            h_b = torch.relu(h_b @ self.perm_b)

            # Callosal exchange: each stream receives signal from the other (detached)
            cal_to_a = torch.relu(self.cal_ba(h_b.detach()))
            cal_to_b = torch.relu(self.cal_ab(h_a.detach()))

            # Independent Hebbian buffer per stream
            buf_a = BUF_DECAY * buf_a + (1 - BUF_DECAY) * h_a.detach()
            buf_b = BUF_DECAY * buf_b + (1 - BUF_DECAY) * h_b.detach()

            # Integration: orbit + buffer + callosal
            h_a = h_a + BUF_STRENGTH * buf_a + CAL_STRENGTH * cal_to_a
            h_b = h_b + BUF_STRENGTH * buf_b + CAL_STRENGTH * cal_to_b

            g_a = torch.sigmoid(self.gate_a)
            g_b = torch.sigmoid(self.gate_b)
            h_a = g_a * h_a + (1 - g_a) * h_a.detach()
            h_b = g_b * h_b + (1 - g_b) * h_b.detach()
            h_a = self.norm_a(h_a)
            h_b = self.norm_b(h_b)

        if streaming:
            self._buf_a = buf_a.detach()
            self._buf_b = buf_b.detach()

        return self.proj_out(torch.cat([h_a, h_b], dim=-1))

    def reset_buf(self):
        self._buf_a = None
        self._buf_b = None


class CallosalNetNoBridge(nn.Module):
    """
    Ablation: two streams + independent Hebbian buffers, NO callosal exchange.
    Tests whether the dual-stream structure itself helps, without cross-hemisphere
    communication. If CallosalNet >> CallosalNetNoBridge, the bridge matters.
    """
    def __init__(self, n_classes=2):
        super().__init__()
        self.enc_a = ConvEncoder(out_dim=K_A)
        self.enc_b = ConvEncoder(out_dim=K_B)
        self.gate_a  = nn.Parameter(torch.full((K_A,), GATE_INIT))
        self.gate_b  = nn.Parameter(torch.full((K_B,), GATE_INIT))
        self.norm_a  = nn.LayerNorm(K_A)
        self.norm_b  = nn.LayerNorm(K_B)
        self.register_buffer('perm_a', make_orbit_perm(K_A))
        self.register_buffer('perm_b', make_orbit_perm(K_B))
        self.proj_out = nn.Linear(K_A + K_B, n_classes)
        self._buf_a = None
        self._buf_b = None

    def forward(self, x, sigma=0.0, streaming=False):
        if sigma > 0:
            x = x + sigma * torch.randn_like(x)
        x_b = -x
        h_a = self.enc_a(x)
        h_b = self.enc_b(x_b)
        if streaming and self._buf_a is not None:
            buf_a = self._buf_a.to(h_a.device)
            buf_b = self._buf_b.to(h_b.device)
        else:
            buf_a = torch.zeros_like(h_a)
            buf_b = torch.zeros_like(h_b)
        for _ in range(CYCLES):
            h_a = torch.relu(h_a @ self.perm_a)
            h_b = torch.relu(h_b @ self.perm_b)
            buf_a = BUF_DECAY * buf_a + (1 - BUF_DECAY) * h_a.detach()
            buf_b = BUF_DECAY * buf_b + (1 - BUF_DECAY) * h_b.detach()
            h_a = h_a + BUF_STRENGTH * buf_a
            h_b = h_b + BUF_STRENGTH * buf_b
            g_a = torch.sigmoid(self.gate_a)
            g_b = torch.sigmoid(self.gate_b)
            h_a = g_a * h_a + (1 - g_a) * h_a.detach()
            h_b = g_b * h_b + (1 - g_b) * h_b.detach()
            h_a = self.norm_a(h_a)
            h_b = self.norm_b(h_b)
        if streaming:
            self._buf_a = buf_a.detach()
            self._buf_b = buf_b.detach()
        return self.proj_out(torch.cat([h_a, h_b], dim=-1))

    def reset_buf(self):
        self._buf_a = None
        self._buf_b = None


class CallosalNetNoBuffer(nn.Module):
    """
    Ablation: two streams + callosal bridges, NO Hebbian buffers.
    Tests whether the cross-hemisphere communication works without biography.
    If CallosalNet >> CallosalNetNoBuffer, the per-hemisphere memory matters.
    """
    def __init__(self, n_classes=2):
        super().__init__()
        self.enc_a = ConvEncoder(out_dim=K_A)
        self.enc_b = ConvEncoder(out_dim=K_B)
        self.cal_ab = nn.Linear(K_A, K_B, bias=False)
        self.cal_ba = nn.Linear(K_B, K_A, bias=False)
        nn.init.normal_(self.cal_ab.weight, 0, 0.01)
        nn.init.normal_(self.cal_ba.weight, 0, 0.01)
        self.gate_a  = nn.Parameter(torch.full((K_A,), GATE_INIT))
        self.gate_b  = nn.Parameter(torch.full((K_B,), GATE_INIT))
        self.norm_a  = nn.LayerNorm(K_A)
        self.norm_b  = nn.LayerNorm(K_B)
        self.register_buffer('perm_a', make_orbit_perm(K_A))
        self.register_buffer('perm_b', make_orbit_perm(K_B))
        self.proj_out = nn.Linear(K_A + K_B, n_classes)

    def forward(self, x, sigma=0.0, streaming=False):
        if sigma > 0:
            x = x + sigma * torch.randn_like(x)
        x_b = -x
        h_a = self.enc_a(x)
        h_b = self.enc_b(x_b)
        for _ in range(CYCLES):
            h_a = torch.relu(h_a @ self.perm_a)
            h_b = torch.relu(h_b @ self.perm_b)
            cal_to_a = torch.relu(self.cal_ba(h_b.detach()))
            cal_to_b = torch.relu(self.cal_ab(h_a.detach()))
            h_a = h_a + CAL_STRENGTH * cal_to_a
            h_b = h_b + CAL_STRENGTH * cal_to_b
            g_a = torch.sigmoid(self.gate_a)
            g_b = torch.sigmoid(self.gate_b)
            h_a = g_a * h_a + (1 - g_a) * h_a.detach()
            h_b = g_b * h_b + (1 - g_b) * h_b.detach()
            h_a = self.norm_a(h_a)
            h_b = self.norm_b(h_b)
        return self.proj_out(torch.cat([h_a, h_b], dim=-1))


class BaselineDualStream(nn.Module):
    """
    CNN-MLP baseline with same dual-stream structure (no orbit, no buffer, no bridge).
    Isolates orbit+bridge contribution: if CallosalNet >> BaselineDualStream,
    the orbit/callosal architecture is doing real work, not just seeing two views.
    """
    def __init__(self, n_classes=2):
        super().__init__()
        self.enc_a = ConvEncoder(out_dim=K_A)
        self.enc_b = ConvEncoder(out_dim=K_B)
        self.head = nn.Sequential(
            nn.Linear(K_A + K_B, K_A + K_B), nn.ReLU(),
            nn.Linear(K_A + K_B, K_A + K_B), nn.ReLU(),
            nn.Linear(K_A + K_B, n_classes),
        )
    def forward(self, x, sigma=0.0, streaming=False):
        if sigma > 0:
            x = x + sigma * torch.randn_like(x)
        x_b = -x
        h = torch.cat([self.enc_a(x), self.enc_b(x_b)], dim=-1)
        return self.head(h)

# ── Dataset + STEAD loader (same as v2) ──────────────────────────────────────
class WaveformDataset(Dataset):
    def __init__(self, X, y):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.long)
    def __len__(self): return len(self.y)
    def __getitem__(self, i): return self.X[i], self.y[i]

def load_offset(offset_samples, max_per_class=MAX_EVENTS):
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
            wf   = eq.get_waveforms(idx)
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
    X = np.concatenate([np.array(X_eq[:n]), np.array(X_noise[:n])], axis=0)
    y = np.array([1]*n + [0]*n)
    m = np.concatenate([mags_arr, np.full(n, np.nan)])
    perm = np.random.permutation(len(y))
    return X[perm], y[perm], m[perm]

def split_loaders(X, y, val_frac=0.15):
    n = len(y); split = int(n * (1 - val_frac))
    tr = WaveformDataset(X[:split], y[:split])
    va = WaveformDataset(X[split:], y[split:])
    return (DataLoader(tr, batch_size=BATCH, shuffle=True,  num_workers=0),
            DataLoader(va, batch_size=BATCH, shuffle=False, num_workers=0))

def train(model, train_dl, dev):
    model.to(dev).train()
    opt = optim.Adam(model.parameters(), lr=LR)
    ce  = nn.CrossEntropyLoss()
    for ep in range(EPOCHS):
        for xb, yb in train_dl:
            xb, yb = xb.to(dev), yb.to(dev)
            loss = ce(model(xb, sigma=SIGMA), yb)
            opt.zero_grad(); loss.backward(); opt.step()

def evaluate(model, val_dl, mags_val, dev):
    model.eval()
    all_pred, all_true = [], []
    with torch.no_grad():
        for xb, yb in val_dl:
            all_pred.extend(model(xb.to(dev)).argmax(1).cpu().tolist())
            all_true.extend(yb.tolist())
    all_pred = np.array(all_pred)
    all_true = np.array(all_true)
    acc  = (all_pred == all_true).mean() * 100
    prec = precision_score(all_true, all_pred, zero_division=0) * 100
    rec  = recall_score(all_true, all_pred, zero_division=0) * 100
    mag_results = {}
    for name, lo, hi in MAG_BINS:
        eq_mask = all_true == 1
        if lo is not None: eq_mask &= mags_val >= lo
        if hi is not None: eq_mask &= mags_val < hi
        if eq_mask.sum() == 0:
            mag_results[name] = None; continue
        noise_mask = all_true == 0
        mask = eq_mask | noise_mask
        mag_results[name] = precision_score(all_true[mask], all_pred[mask], zero_division=0) * 100
    return acc, prec, rec, mag_results

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    mode = f"garnet (K_A={K_A}, K_B={K_B})" if GARNET else f"standard (K={K})"
    print(f"device={dev}  mode={mode}  CYCLES={CYCLES}  WIN={WIN_SAMPLES}samples")
    print(f"sigma={SIGMA}  epochs={EPOCHS}  seeds={SEEDS}")
    print(f"buf_decay={BUF_DECAY}  buf_strength={BUF_STRENGTH}  cal_strength={CAL_STRENGTH}")
    print(f"offsets: {[lbl for lbl, _ in OFFSETS]}\n")
    print("Models:")
    print("  base_dual  = Baseline dual-stream CNN-MLP (no orbit, no buffer, no bridge)")
    print("  no_bridge  = Two orbit streams + Hebbian buffers, NO callosal exchange")
    print("  no_buffer  = Two orbit streams + callosal bridges, NO Hebbian buffers")
    print("  corpus     = Full CallosalNet (orbit + buffer + callosal bridges)\n")

    MODEL_KEYS = ['base_dual', 'no_bridge', 'no_buffer', 'corpus']
    results = {}

    t0 = time.time()
    for off_label, off_samples in OFFSETS:
        print(f"\n{'='*72}")
        print(f"OFFSET {off_label}  ({off_samples} samples from p_arrival)", flush=True)
        X, y, mags = load_offset(off_samples)
        split = int(len(y) * 0.85)
        mags_val = mags[split:]
        tr_dl, va_dl = split_loaders(X, y)

        runs = {k: [] for k in MODEL_KEYS}
        for seed in range(SEEDS):
            torch.manual_seed(seed); np.random.seed(seed)
            models = {
                'base_dual': BaselineDualStream(),
                'no_bridge': CallosalNetNoBridge(),
                'no_buffer': CallosalNetNoBuffer(),
                'corpus':    CallosalNet(),
            }
            for key, m in models.items():
                train(m, tr_dl, dev)
                runs[key].append(evaluate(m, va_dl, mags_val, dev))

            bd, nb, nbuf, corp = (runs[k][-1] for k in MODEL_KEYS)
            print(f"  seed={seed} "
                  f"base={bd[1]:.1f}% "
                  f"no_bridge={nb[1]:.1f}% "
                  f"no_buffer={nbuf[1]:.1f}% "
                  f"corpus={corp[1]:.1f}% "
                  f"bridge_gain={corp[1]-nb[1]:+.1f}% "
                  f"buffer_gain={corp[1]-nbuf[1]:+.1f}%",
                  flush=True)

        results[off_label] = runs

    wall = time.time() - t0
    print(f"\nTotal wall time: {wall:.0f}s")

    print("\n" + "=" * 100)
    print(f"DETECTION LATENCY SUMMARY  (metric: precision >= 95%)")
    print(f"  cal_strength={CAL_STRENGTH}  buf_decay={BUF_DECAY}  buf_strength={BUF_STRENGTH}")
    print("=" * 100)
    print(f"  {'offset':<8} {'base_d':>8} {'no_brg':>8} {'no_buf':>8} {'corpus':>8} "
          f"{'brg_gain':>9} {'buf_gain':>9}  note")
    print(f"  {'-'*8} {'-'*8} {'-'*8} {'-'*8} {'-'*8} {'-'*9} {'-'*9}  ----")

    thresholds = {k: None for k in MODEL_KEYS}
    for off_label, off_samples in OFFSETS:
        r = results[off_label]
        means = {k: np.mean([x[1] for x in r[k]]) for k in MODEL_KEYS}
        note = ''
        for k in MODEL_KEYS:
            if means[k] >= 95 and thresholds[k] is None:
                thresholds[k] = off_label
                note += f'{k}≥95% '
        bd, nb, nbuf, corp = (means[k] for k in MODEL_KEYS)
        print(f"  {off_label:<8} {bd:>7.1f}% {nb:>7.1f}% {nbuf:>7.1f}% {corp:>7.1f}% "
              f"{corp-nb:>+8.1f}% {corp-nbuf:>+8.1f}%  {note}")

    print()
    labels = {
        'base_dual': 'Dual-stream baseline',
        'no_bridge': 'No callosal bridge  ',
        'no_buffer': 'No Hebbian buffer   ',
        'corpus':    'Full CallosalNet    ',
    }
    offset_labels = [l for l, _ in OFFSETS]
    for k, name in labels.items():
        hit = thresholds[k]
        if hit:
            off_s = OFFSETS_S[offset_labels.index(hit)]
            print(f"  {name} hits 95% prec at {hit}  ({off_s:+d}s from P-arrival)")
        else:
            print(f"  {name} never hit 95% prec in tested range")

    # Lead time: corpus vs base_dual
    if thresholds['corpus'] and thresholds['base_dual']:
        c_s = OFFSETS_S[offset_labels.index(thresholds['corpus'])]
        b_s = OFFSETS_S[offset_labels.index(thresholds['base_dual'])]
        delta = b_s - c_s
        if delta != 0:
            print(f"\n  → CallosalNet detects {abs(delta):.0f}s {'earlier' if delta > 0 else 'later'} "
                  f"than dual-stream baseline at 95% precision threshold")

    # Magnitude breakdown at 0s offset for corpus model
    print(f"\n  Magnitude breakdown at +0s offset (corpus model):")
    r0 = results.get('+0s', {}).get('corpus', [])
    if r0:
        for bin_name in [b[0] for b in MAG_BINS]:
            vals = [x[3].get(bin_name) for x in r0 if x[3].get(bin_name) is not None]
            if vals:
                print(f"    {bin_name}: {np.mean(vals):.1f}%")

    # Architecture summary
    with torch.no_grad():
        dummy = torch.zeros(1, N_CH, WIN_SAMPLES)
        param_counts = {}
        for k, cls in [('corpus', CallosalNet), ('base_dual', BaselineDualStream)]:
            m = cls()
            param_counts[k] = sum(p.numel() for p in m.parameters())
    print(f"\n  Parameters — corpus: {param_counts['corpus']:,}  "
          f"base_dual: {param_counts['base_dual']:,}")
    print(f"  K_A={K_A}  K_B={K_B}  CYCLES={CYCLES}  CAL_STRENGTH={CAL_STRENGTH}")
    if GARNET:
        print(f"  Garnet ratio active: {K_A}/{K_B} = {K_A/K_B:.2f} ≈ 3/2")
