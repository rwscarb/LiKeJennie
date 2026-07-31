"""
Optuna hyperparameter optimisation: tunes wd, lr, h1, h2, and per-ISO mixing weights.
"""

import numpy as np
import torch

from config import N, D_IN, ISOS
from models import BatchedISOModel, MLP
from train import train_model, predict_model, rmse


def run_optuna(n_trials, Xs_tr, ys_tr, Xs_te, ys_te, device, verbose=False):
    try:
        import optuna
    except ImportError:
        print("  optuna not installed — run: pip install optuna")
        return None
    optuna.logging.set_verbosity(optuna.logging.WARNING)

    # Hold out last 20% of training as validation
    val_split = int(0.8 * len(Xs_tr))
    Xs_sub, ys_sub = Xs_tr[:val_split], ys_tr[:val_split]
    Xs_val, ys_val = Xs_tr[val_split:], ys_tr[val_split:]

    def objective(trial):
        wd = trial.suggest_float("wd", 1e-5, 1e-1, log=True)
        lr = trial.suggest_float("lr", 5e-5, 5e-3, log=True)
        h1 = trial.suggest_categorical("h1", [16, 32, 64])
        h2 = trial.suggest_categorical("h2", [8, 16, 32])

        torch.manual_seed(0)
        iso_m = BatchedISOModel(N, D_IN, h1, h2)
        train_model(
            iso_m,
            Xs_sub,
            ys_sub,
            epochs=400,
            lr=lr,
            weight_decay=wd / N,
            batch_size=64,
            device=device,
        )

        torch.manual_seed(0)
        mlp_m = MLP(D_IN, h1, h2, N)
        train_model(
            mlp_m, Xs_sub, ys_sub, epochs=400, lr=lr, batch_size=64, device=device
        )

        p_val = predict_model(iso_m, Xs_val, device=device)
        m_val = predict_model(mlp_m, Xs_val, device=device)

        alphas = np.array([trial.suggest_float(f"a{i}", 0.0, 1.0) for i in range(N)])
        e_val = alphas * p_val + (1.0 - alphas) * m_val
        return float(rmse(e_val, ys_val))

    study = optuna.create_study(
        direction="minimize", sampler=optuna.samplers.TPESampler(seed=0)
    )
    study.optimize(objective, n_trials=n_trials, show_progress_bar=True)

    best = study.best_params
    wd = best["wd"]
    lr = best["lr"]
    h1 = best["h1"]
    h2 = best["h2"]
    alphas = np.array([best[f"a{i}"] for i in range(N)])

    print(f"\n  Best trial: val RMSE={study.best_value:.4f}")
    print(f"  wd={wd:.2e}  lr={lr:.2e}  h1={h1}  h2={h2}")
    print(f"  mixing weights α (per-ISO → 1.0=per-ISO, 0.0=shared):")
    for i, iso in enumerate(ISOS):
        print(f"    {iso:>8}: {alphas[i]:.3f}")

    torch.manual_seed(0)
    print(f"\n  Retraining per-ISO model (full data, 2000 epochs) ...")
    iso_final = BatchedISOModel(N, D_IN, h1, h2)
    train_model(
        iso_final,
        Xs_tr,
        ys_tr,
        epochs=2000,
        lr=lr,
        weight_decay=wd / N,
        batch_size=64,
        device=device,
        verbose=verbose,
    )

    torch.manual_seed(0)
    print(f"\n  Retraining shared MLP (full data, 2000 epochs) ...")
    mlp_final = MLP(D_IN, h1, h2, N)
    train_model(
        mlp_final,
        Xs_tr,
        ys_tr,
        epochs=2000,
        lr=lr,
        batch_size=64,
        device=device,
        verbose=verbose,
    )

    p_te = predict_model(iso_final, Xs_te, device=device)
    m_te = predict_model(mlp_final, Xs_te, device=device)
    return iso_final, mlp_final, alphas, p_te, m_te
