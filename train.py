"""
Training loop, inference, and RMSE utility.
"""

import time

import numpy as np
import torch
import torch.nn.functional as F

rmse = lambda p, y: float(np.sqrt(np.mean((p - y) ** 2)))


def train_model(
    model,
    Xs_tr,
    ys_tr,
    epochs=2000,
    lr=8e-4,
    batch_size=64,
    weight_decay=0.0,
    device="cpu",
    verbose=False,
):
    model.to(device).train()
    opt = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=weight_decay)
    Xs = torch.tensor(Xs_tr, dtype=torch.float32, device=device)
    ys = torch.tensor(ys_tr, dtype=torch.float32, device=device)
    T = len(Xs)
    log = []
    t0 = time.time()
    for ep in range(epochs):
        perm = torch.randperm(T, device=device)
        ep_loss, n_batches = 0.0, 0
        for start in range(0, T, batch_size):
            idx = perm[start : start + batch_size]
            opt.zero_grad()
            loss = F.mse_loss(model(Xs[idx]), ys[idx])
            loss.backward()
            opt.step()
            ep_loss += loss.item()
            n_batches += 1
        log.append(ep_loss / n_batches)
        if verbose and (ep + 1) % 100 == 0:
            print(f"    ep {ep+1:4d}  loss={log[-1]:.5f}")
    print(f"    done  loss={log[-1]:.5f}  ({time.time()-t0:.1f}s)")
    return log


def predict_model(model, Xs_te, device="cpu"):
    model.eval()
    with torch.no_grad():
        return (
            model(torch.tensor(Xs_te, dtype=torch.float32, device=device)).cpu().numpy()
        )
