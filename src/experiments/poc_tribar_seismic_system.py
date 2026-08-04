"""
Penrose Tribar — Seismic Early Warning System
==============================================
A deployable seismic P-wave detection system using the orbit permutation
architecture. Demonstrates real-time streaming detection with alert output.

Stages:
  1. TRAIN  — fit TribarNet on STEAD P-wave onset windows (1-second clips)
  2. SAVE   — persist model weights + config to disk
  3. STREAM — StreamDetector class: sliding window → confidence → alert

The core claim:
  P-wave onset (1 second of data) classified with ~88% accuracy.
  Alert fires before S-wave arrives → warning time = (P-S delay) - 1s.
  At 100km from epicenter: ~8-10s warning. At 200km: ~18-20s.

STEAD metadata used:
  p_arrival_sample  — P-wave onset (alarm window starts here)
  s_arrival_sample  — S-wave onset (deadline for alert)

Usage:
  python poc_tribar_seismic_system.py train   # train + save model
  python poc_tribar_seismic_system.py demo    # stream demo on held-out event
  python poc_tribar_seismic_system.py all     # both
"""
import sys, time, json
from pathlib import Path
from math import gcd

import torch, torch.nn as nn, torch.optim as optim
import numpy as np
from torch.utils.data import Dataset, DataLoader

# ── Config ────────────────────────────────────────────────────────────────────
CFG = dict(
    K            = 128,
    CYCLES       = 3,
    LR           = 2.42e-4,
    GATE         = 0.346,
    EPOCHS       = 25,
    SEEDS        = 1,          # production uses one well-trained seed
    SIGMA        = 0.3,        # ambient noise augmentation
    WIN_SAMPLES  = 100,        # 1.0s @ 100 Hz — P-wave onset window
    N_CH         = 3,
    MAX_EVENTS   = 8000,       # per class
    BATCH        = 512,
    THRESHOLD    = 0.72,       # alert fires when P(earthquake) > this
    MODEL_PATH   = '/root/tribar_seismic.pt',
    DATA_DIR     = '/tmp/seismo_data',
)
INPUT_DIM = CFG['WIN_SAMPLES'] * CFG['N_CH']
SAMPLE_RATE = 100  # Hz

# ── Orbit permutation ─────────────────────────────────────────────────────────
def make_orbit_perm(N):
    stride = 5
    while gcd(stride, N) != 1:
        stride += 2
    P = torch.zeros(N, N)
    for j in range(N):
        P[(j * stride) % N, j] = 1.0
    return P

# ── TribarNet ─────────────────────────────────────────────────────────────────
class TribarNet(nn.Module):
    def __init__(self, input_dim=INPUT_DIM, K=128, CYCLES=3, gate_init=0.346):
        super().__init__()
        self.CYCLES   = CYCLES
        self.proj_in  = nn.Linear(input_dim, K, bias=False)
        self.proj_out = nn.Linear(K, 2)
        self.gate     = nn.Parameter(torch.full((K,), gate_init))
        self.norm     = nn.LayerNorm(K)
        self.register_buffer('perm', make_orbit_perm(K))

    def forward(self, x, sigma=0.0):
        if sigma > 0 and self.training:
            x = x + sigma * torch.randn_like(x)
        h = torch.relu(self.proj_in(x))
        for _ in range(self.CYCLES):
            h = torch.relu(h @ self.perm)
            g = torch.sigmoid(self.gate)
            h = g * h + (1 - g) * h.detach()
            h = self.norm(h)
        return self.proj_out(h)

    def p_earthquake(self, waveform_3ch):
        """
        waveform_3ch: (3, T) numpy array, T >= WIN_SAMPLES
        Returns: float probability that this window contains a P-wave onset.
        """
        w = waveform_3ch[:, :CFG['WIN_SAMPLES']].astype(np.float32)
        std = w.std(axis=1, keepdims=True) + 1e-6
        x = torch.tensor((w / std).flatten()).unsqueeze(0)
        with torch.no_grad():
            logits = self(x)
            return torch.softmax(logits, dim=-1)[0, 1].item()

# ── Dataset ───────────────────────────────────────────────────────────────────
class OnsetDataset(Dataset):
    def __init__(self, X, y):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.long)
    def __len__(self): return len(self.y)
    def __getitem__(self, i): return self.X[i], self.y[i]

# ── STEAD: load P-wave onset windows ─────────────────────────────────────────
def load_onset_windows(max_per_class=CFG['MAX_EVENTS'], hold_out=False):
    """
    hold_out=True: return a list of (waveform, p_sample, s_sample, label)
    tuples for streaming demo — raw waveforms, not flattened vectors.
    """
    import seisbench.data as sbd
    eq = sbd.STEAD(download_kwargs={"chunk": "chunk2"}, cache=None)
    ws = CFG['WIN_SAMPLES']
    X_eq, X_noise, held = [], [], []

    indices = np.random.permutation(len(eq))[:max_per_class * 5]
    for _i, idx in enumerate(indices):
        if len(X_eq) >= max_per_class and len(X_noise) >= max_per_class:
            if not hold_out: break
            if len(held) >= 20: break
        if _i % 3000 == 0:
            print(f"    iter {_i} | eq={len(X_eq)} noise={len(X_noise)} held={len(held)}", flush=True)
        try:
            meta = eq.metadata.iloc[idx]
            cat  = meta.get('trace_category', '')
            wf   = eq.get_waveforms(idx)
            if wf is None or wf.shape[1] < 3000:
                continue

            if cat == 'earthquake_local':
                p_samp = int(meta.get('p_arrival_sample', 0) or 0)
                s_samp = int(meta.get('s_arrival_sample', 0) or 0)
                if p_samp + ws > wf.shape[1]:
                    p_samp = max(0, wf.shape[1] - ws)
                w = wf[:, p_samp : p_samp + ws].astype(np.float32)
                if w.shape[1] < ws: continue
                std = w.std(axis=1, keepdims=True) + 1e-6

                if len(X_eq) < max_per_class:
                    X_eq.append((w / std).flatten())
                elif hold_out and len(held) < 20 and s_samp > p_samp + ws:
                    held.append(dict(wf=wf, p=p_samp, s=s_samp, label=1))

            elif cat == 'noise' and len(X_noise) < max_per_class:
                start = np.random.randint(0, max(1, wf.shape[1] - ws))
                w = wf[:, start : start + ws].astype(np.float32)
                if w.shape[1] < ws: continue
                std = w.std(axis=1, keepdims=True) + 1e-6
                X_noise.append((w / std).flatten())

        except Exception:
            continue

    n = min(len(X_eq), len(X_noise))
    print(f"    collected: {n} eq, {n} noise | held-out: {len(held)}", flush=True)
    X = np.array(X_eq[:n] + X_noise[:n])
    y = np.array([1]*n + [0]*n)
    perm = np.random.permutation(len(y))
    return X[perm], y[perm], held

# ── Training ──────────────────────────────────────────────────────────────────
def train(model, loaders, dev):
    model.to(dev)
    opt = optim.Adam(model.parameters(), lr=CFG['LR'])
    ce  = nn.CrossEntropyLoss()
    train_dl, val_dl = loaders
    best_acc, best_state = 0, None
    for epoch in range(CFG['EPOCHS']):
        model.train()
        for xb, yb in train_dl:
            xb, yb = xb.to(dev), yb.to(dev)
            loss   = ce(model(xb, sigma=CFG['SIGMA']), yb)
            opt.zero_grad(); loss.backward(); opt.step()
        model.eval()
        correct = total = 0
        with torch.no_grad():
            for xb, yb in val_dl:
                xb, yb = xb.to(dev), yb.to(dev)
                correct += (model(xb).argmax(1) == yb).sum().item()
                total   += len(yb)
        acc = correct / total * 100
        if acc > best_acc:
            best_acc = acc
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
    model.load_state_dict(best_state)
    return best_acc

def get_loaders(X, y):
    split = int(len(y) * 0.85)
    tr = OnsetDataset(X[:split], y[:split])
    va = OnsetDataset(X[split:], y[split:])
    return (DataLoader(tr, batch_size=CFG['BATCH'], shuffle=True,  num_workers=0),
            DataLoader(va, batch_size=CFG['BATCH'], shuffle=False, num_workers=0))

# ── StreamDetector ────────────────────────────────────────────────────────────
class StreamDetector:
    """
    Sliding-window P-wave detector for continuous 3-channel seismic streams.

    Usage:
        det = StreamDetector(model)
        for chunk in stream:           # chunk: (3, chunk_size) array
            alert = det.push(chunk)
            if alert:
                print(f"P-WAVE DETECTED  conf={alert['confidence']:.2f}")
                print(f"  estimated warning: {alert['warning_s']:.1f}s before S-wave")
    """
    def __init__(self, model, threshold=CFG['THRESHOLD'], step=10):
        self.model     = model
        self.threshold = threshold
        self.step      = step            # samples to advance per inference call
        self.ws        = CFG['WIN_SAMPLES']
        self._buf      = np.zeros((3, self.ws * 2), dtype=np.float32)
        self._buf_ptr  = 0
        self._alerted  = False
        self._alert_sample = None

    def push(self, chunk_3ch):
        """
        chunk_3ch: (3, N) numpy array — new samples from the stream.
        Returns: dict with alert info, or None.
        """
        n = chunk_3ch.shape[1]
        # Extend buffer
        self._buf = np.roll(self._buf, -n, axis=1)
        self._buf[:, -n:] = chunk_3ch
        self._buf_ptr += n

        # Only classify once we have a full window
        if self._buf_ptr < self.ws:
            return None

        # Slide at step intervals
        if self._buf_ptr % self.step != 0:
            return None

        window = self._buf[:, -self.ws:]
        conf   = self.model.p_earthquake(window)

        if conf >= self.threshold and not self._alerted:
            self._alerted      = True
            self._alert_sample = self._buf_ptr
            # P-S travel time difference at 100km ≈ 10s; at 200km ≈ 20s
            # Without distance estimate, we report the window size as minimum
            warning_s = (self.ws / SAMPLE_RATE)  # already consumed
            return dict(
                confidence  = conf,
                sample      = self._buf_ptr,
                warning_s   = warning_s,
                message     = f"⚠ P-WAVE DETECTED  conf={conf:.2f}  "
                              f"({self.ws/SAMPLE_RATE:.1f}s window consumed)",
            )
        return None

    def reset(self):
        self._buf      = np.zeros_like(self._buf)
        self._buf_ptr  = 0
        self._alerted  = False
        self._alert_sample = None

# ── Demo: simulate streaming over held-out events ────────────────────────────
def run_demo(model, held_out):
    if not held_out:
        print("No held-out events available for demo.")
        return

    print(f"\n── Streaming demo ({len(held_out)} held-out events) ──")
    print(f"   Window: {CFG['WIN_SAMPLES']/SAMPLE_RATE:.1f}s  "
          f"Threshold: {CFG['THRESHOLD']}  Step: 10 samples (0.1s)\n")

    CHUNK = 10  # push 10 samples at a time (0.1s chunks)
    detected = 0
    for ev in held_out:
        wf     = ev['wf']         # (3, T)
        p_samp = ev['p']
        s_samp = ev['s']
        ps_gap = (s_samp - p_samp) / SAMPLE_RATE

        det = StreamDetector(model)
        alert = None

        # Feed from trace start; alert expected around p_samp
        for start in range(0, wf.shape[1] - CHUNK, CHUNK):
            chunk = wf[:, start : start + CHUNK].astype(np.float32)
            result = det.push(chunk)
            if result:
                alert = result
                alert['samples_before_s'] = s_samp - (start + CHUNK)
                alert['warning_time_s']   = alert['samples_before_s'] / SAMPLE_RATE
                break

        status = "✓ DETECTED" if alert else "✗ MISSED"
        if alert: detected += 1
        print(f"  {status}  P-S gap: {ps_gap:.1f}s  ", end='')
        if alert:
            print(f"conf={alert['confidence']:.2f}  "
                  f"warning={alert['warning_time_s']:.1f}s before S-wave")
        else:
            print()

    print(f"\n  Detection rate: {detected}/{len(held_out)} "
          f"({100*detected/len(held_out):.0f}%)")

# ── Entrypoint ────────────────────────────────────────────────────────────────
def cmd_train():
    dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"device: cuda={torch.cuda.is_available()}")
    print(f"K={CFG['K']}  CYCLES={CFG['CYCLES']}  sigma={CFG['SIGMA']}")
    print(f"window: {CFG['WIN_SAMPLES']/SAMPLE_RATE:.1f}s ({CFG['WIN_SAMPLES']} samples)\n")

    torch.manual_seed(42); np.random.seed(42)
    print("Loading STEAD onset windows...", flush=True)
    X, y, held_out = load_onset_windows(hold_out=True)
    loaders = get_loaders(X, y)

    model = TribarNet(INPUT_DIM, CFG['K'], CFG['CYCLES'], CFG['GATE'])
    t0 = time.time()
    acc = train(model, loaders, dev)
    print(f"\nBest val acc: {acc:.2f}%  ({time.time()-t0:.0f}s)", flush=True)

    torch.save({'state_dict': model.state_dict(), 'cfg': CFG}, CFG['MODEL_PATH'])
    print(f"Model saved → {CFG['MODEL_PATH']}")
    return model, held_out

def cmd_demo(model=None, held_out=None):
    if model is None:
        ckpt  = torch.load(CFG['MODEL_PATH'], map_location='cpu')
        model = TribarNet(INPUT_DIM, CFG['K'], CFG['CYCLES'], CFG['GATE'])
        model.load_state_dict(ckpt['state_dict'])
        model.eval()
        print(f"Loaded model from {CFG['MODEL_PATH']}")
        # Need held-out events — load a small set
        print("Loading held-out events from STEAD...", flush=True)
        _, _, held_out = load_onset_windows(max_per_class=1, hold_out=True)
    run_demo(model, held_out)

if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if mode == 'train':
        cmd_train()
    elif mode == 'demo':
        cmd_demo()
    else:  # 'all'
        model, held_out = cmd_train()
        model.eval()
        cmd_demo(model, held_out)
