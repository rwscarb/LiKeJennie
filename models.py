"""
Model architectures: batched per-ISO MLP and shared MLP baseline.

Both include an RSM coupling layer on the directed source features:
a learnable per-node orthogonal (lossless) 3×3 mixer applied to the K
upwind source signals before the MLP. Parameterised as the matrix
exponential of a skew-symmetric matrix, which is always orthogonal.
Initialised to zero → identity at startup (pure pass-through).
"""
import torch
import torch.nn as nn
import torch.nn.functional as F


class BatchedISOModel(nn.Module):
    """
    N independent MLPs run in a single GPU kernel via einsum, with a
    per-ISO RSM coupling layer on the K directed source features.
    """

    def __init__(self, n, d_in, h1, h2, k_src=3, f_src=3):
        super().__init__()
        self.k = k_src
        self.f = f_src
        # RSM: per-ISO skew-symmetric param → matrix_exp → orthogonal mixer
        self.S = nn.Parameter(torch.zeros(n, k_src, k_src))
        self.W1 = nn.Parameter(torch.empty(n, d_in, h1))
        self.b1 = nn.Parameter(torch.zeros(n, h1))
        self.W2 = nn.Parameter(torch.empty(n, h1, h2))
        self.b2 = nn.Parameter(torch.zeros(n, h2))
        self.Wo = nn.Parameter(torch.empty(n, h2))
        self.bo = nn.Parameter(torch.zeros(n))
        for i in range(n):
            nn.init.kaiming_normal_(self.W1.data[i], nonlinearity="relu")
            nn.init.kaiming_normal_(self.W2.data[i], nonlinearity="relu")
        nn.init.kaiming_normal_(self.Wo, nonlinearity="relu")

    def _rsm_Q(self):
        A = self.S - self.S.transpose(-2, -1)  # skew-symmetric
        return torch.linalg.matrix_exp(A)       # [N, K, K], orthogonal

    def forward(self, X):
        # X: [B, N, D_IN] — last k*f dims are directed source features
        B, N, D = X.shape
        d_own = D - self.k * self.f
        own = X[:, :, :d_own]                                            # [B, N, L*FEAT]
        src = X[:, :, d_own:].reshape(B, N, self.k, self.f)             # [B, N, K, F]
        Q = self._rsm_Q()                                                 # [N, K, K]
        src = torch.einsum("nkj,bnjf->bnkf", Q, src).reshape(B, N, self.k * self.f)
        X = torch.cat([own, src], dim=-1)                                 # [B, N, D_IN]
        H1 = F.relu(torch.einsum("bni,nij->bnj", X, self.W1) + self.b1)
        H2 = F.relu(torch.einsum("bni,nij->bnj", H1, self.W2) + self.b2)
        return (H2 * self.Wo).sum(-1) + self.bo                          # [B, N]


class MLP(nn.Module):
    """
    Shared MLP baseline — all ISOs share one set of weights — with a
    single shared RSM coupling layer on the directed source features.
    """

    def __init__(self, d_in, h1, h2, n_nodes, k_src=3, f_src=3):
        super().__init__()
        self.k = k_src
        self.f = f_src
        # Shared RSM: one K×K skew-symmetric matrix for all ISOs
        self.S = nn.Parameter(torch.zeros(k_src, k_src))
        self.W1 = nn.Parameter(torch.empty(d_in, h1))
        self.b1 = nn.Parameter(torch.zeros(h1))
        self.W2 = nn.Parameter(torch.empty(h1, h2))
        self.b2 = nn.Parameter(torch.zeros(h2))
        self.Wo = nn.Parameter(torch.empty(h2, 1))
        self.bo = nn.Parameter(torch.zeros(1))
        for w in (self.W1, self.W2, self.Wo):
            nn.init.kaiming_normal_(w, nonlinearity="relu")

    def _rsm_Q(self):
        A = self.S - self.S.T
        return torch.linalg.matrix_exp(A)  # [K, K], orthogonal

    def forward(self, X):
        # X: [..., D_IN] — last k*f dims are directed source features
        *leading, D = X.shape
        d_own = D - self.k * self.f
        own = X[..., :d_own]
        src = X[..., d_own:].reshape(*leading, self.k, self.f)  # [..., K, F]
        Q = self._rsm_Q()                                         # [K, K]
        src = torch.einsum("kj,...jf->...kf", Q, src).reshape(*leading, self.k * self.f)
        X = torch.cat([own, src], dim=-1)
        H1 = F.relu(X @ self.W1 + self.b1)
        H2 = F.relu(H1 @ self.W2 + self.b2)
        return (H2 @ self.Wo).squeeze(-1) + self.bo
