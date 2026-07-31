"""
Feature engineering: directed cross-ISO sources and sliding-window dataset construction.
"""

import numpy as np

from config import N, ISO_COORDS, L, FEAT, TOP_K_SOURCES


def compute_directed_sources(
    X_train, top_k=TOP_K_SOURCES, max_lag=6, asymmetry_ratio=1.15
):
    """
    For each node i, find top_k (source j, lag h) pairs where j genuinely leads i:
      corr(i[t], j[t-h]) > asymmetry_ratio * corr(j[t], i[t-h])
    Filters out contemporaneous synoptic pairs where neither ISO truly leads.
    Falls back to best available if fewer than top_k directed sources found.
    """
    T = len(X_train)
    corr = {}
    for a in range(N):
        for b in range(N):
            if a == b:
                continue
            for h in range(1, max_lag + 1):
                xa = X_train[h:, a]
                xb = X_train[: T - h, b]
                xa_c = xa - xa.mean()
                xb_c = xb - xb.mean()
                denom = np.linalg.norm(xa_c) * np.linalg.norm(xb_c)
                corr[(a, b, h)] = (
                    float(np.dot(xa_c, xb_c) / denom) if denom > 0 else 0.0
                )

    sources = []
    for i in range(N):
        lon_i = ISO_COORDS[i][1]
        directed, fallback = [], []
        for j in range(N):
            if j == i:
                continue
            lon_j = ISO_COORDS[j][1]
            # Geographic constraint: source must be west of target (prevailing westerlies).
            # Allow up to 5° east tolerance for north-south neighbours (BPA/CAISO).
            if lon_j > lon_i + 5.0:
                continue
            for h in range(1, max_lag + 1):
                r_fwd = corr[(i, j, h)]
                r_bwd = corr[(j, i, h)]
                fallback.append((r_fwd, j, h))
                if r_fwd > 0 and r_fwd > asymmetry_ratio * max(r_bwd, 1e-6):
                    directed.append((r_fwd, j, h))
        directed.sort(reverse=True)
        fallback.sort(reverse=True)
        chosen = directed[:top_k]
        used = {(j, h) for _, j, h in chosen}
        for r, j, h in fallback:
            if len(chosen) >= top_k:
                break
            if (j, h) not in used:
                chosen.append((r, j, h))
                used.add((j, h))
        sources.append([(j, h) for _, j, h in chosen[:top_k]])
    return sources


def make_dataset(X, W, directed_sources):
    """
    X:               [T, N]    — normalised generation
    W:               [T, N, 3] — weather (speed_norm, cos_dir, sin_dir)
    directed_sources: N lists of (j, h) from compute_directed_sources

    Feature per node: [own lags: L*FEAT] + [top-K upwind weather: K*3]
    Returns Xs [T-L, N, D_IN], ys [T-L, N]
    """
    T = len(X)
    K = TOP_K_SOURCES
    XW = np.concatenate([X[:, :, None], W], axis=2)  # [T, N, FEAT]
    samples = []
    for t in range(T - L):
        own = XW[t : t + L].transpose(1, 0, 2).reshape(N, L * FEAT)  # [N, L*FEAT]
        directed = np.zeros((N, K * 3), dtype=np.float32)
        for i in range(N):
            for k, (j, h) in enumerate(directed_sources[i]):
                t_src = t + L - h
                if t_src >= 0:
                    directed[i, k * 3 : (k + 1) * 3] = W[t_src, j]
        samples.append(np.concatenate([own, directed], axis=1))
    return np.array(samples, dtype=np.float32), X[L:].astype(np.float32)
