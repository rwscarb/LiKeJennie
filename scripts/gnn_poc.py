#!/usr/bin/env python3
"""
jennie21 GNN PoC v3
====================
v3 adds:
  1. Graph Attention Network (GAT) — per-neighbor attention weights
  2. Attention inspection — shows what the model learned to trust/ignore
  3. Noise robustness sweep — where each model breaks

Stack: GAT > R-GNN > GCN > Baseline.  Pure numpy.
"""
import numpy as np

# ── Orbit graph ───────────────────────────────────────────────────────────────
ORBIT  = np.array([1, 2, 4, 8, 7, 5])
N      = len(ORBIT)
LABELS = np.array([0, 1, 1, 0, 1, 0], dtype=np.float32)

A_cycle = np.zeros((N, N), np.float32)
for i in range(N): A_cycle[i,(i+1)%N] = A_cycle[(i+1)%N,i] = 1.0
A_echo  = np.zeros((N, N), np.float32)
for a, b in [(0,3),(1,4),(2,5)]: A_echo[a,b] = A_echo[b,a] = 1.0
A_self  = np.eye(N, dtype=np.float32)

MASKS   = [A_self>0, A_cycle>0, A_echo>0]

# For R-GNN / GCN (row-normed)
def row_norm(A):
    d = np.where(A.sum(1)==0, 1.0, A.sum(1))
    return (np.diag(1/d) @ A).astype(np.float32)
Ac, Ae = row_norm(A_cycle), row_norm(A_echo)
A_all   = A_self + A_cycle + A_echo
D_inv   = np.diag(1/np.sqrt(A_all.sum(1)))
A_hat   = (D_inv @ A_all @ D_inv).astype(np.float32)
A_unif  = np.full((N, N), 1/N, dtype=np.float32)

# ── Features (10-dim) ─────────────────────────────────────────────────────────
BASE_X = np.hstack([
    np.column_stack([ORBIT/9.0,
                     np.array([-1,-1,1,-1,1,-1],np.float32),
                     np.arange(N,dtype=np.float32)/N,
                     (ORBIT%3).astype(np.float32)/3.0]).astype(np.float32),
    np.eye(N, dtype=np.float32),
])  # [6, 10]
D_IN = BASE_X.shape[1]
H1, H2 = 12, 6

# ── Primitives ────────────────────────────────────────────────────────────────
relu    = lambda x: np.maximum(0.0, x)
d_relu  = lambda x: (x > 0).astype(np.float32)
sigmoid = lambda x: 1.0/(1.0+np.exp(-np.clip(x,-40,40)))
leaky   = lambda x: np.where(x>0, x, 0.2*x)
d_leaky = lambda x: np.where(x>0, 1.0, 0.2).astype(np.float32)
bce = lambda p,y: -np.mean(y*np.log(p+1e-7)+(1-y)*np.log(1-p+1e-7))

def softmax_rows(X):
    X = X - X.max(1, keepdims=True)
    e = np.exp(X); return (e / e.sum(1, keepdims=True)).astype(np.float32)

class Adam:
    def __init__(self, params, lr=3e-3):
        self.lr=lr; self.b1=0.9; self.b2=0.999; self.eps=1e-8; self.t=0
        self.m=[np.zeros_like(p) for p in params]
        self.v=[np.zeros_like(p) for p in params]
    def step(self, params, grads):
        self.t+=1; out=[]
        for i,(p,g) in enumerate(zip(params,grads)):
            self.m[i]=self.b1*self.m[i]+(1-self.b1)*g
            self.v[i]=self.b2*self.v[i]+(1-self.b2)*g*g
            mh=self.m[i]/(1-self.b1**self.t); vh=self.v[i]/(1-self.b2**self.t)
            out.append(p-self.lr*mh/(np.sqrt(vh)+self.eps))
        return out

# ── GAT single layer: forward + backward ──────────────────────────────────────
def gat_fwd(H, W, a, mask):
    """
    H [N,d], W [d,h], a [2h], mask [N,N] bool
    → out [N,h], attn [N,N], cache
    """
    d, h = W.shape
    Wh   = H @ W                         # [N, h]
    a_s, a_d = a[:h], a[h:]
    e_s  = Wh @ a_s                      # [N]
    e_d  = Wh @ a_d                      # [N]
    Epre = e_s[:,None] + e_d[None,:]     # [N, N]
    Eact = leaky(Epre)
    Einf = np.where(mask, Eact, -1e9)
    attn = softmax_rows(Einf)            # [N, N]
    out  = attn @ Wh                     # [N, h]
    return out, attn, (H, W, a, mask, Wh, a_s, a_d, Epre, Eact, attn)

def gat_bwd(d_out, cache):
    H, W, a, mask, Wh, a_s, a_d, Epre, Eact, attn = cache
    d, h = W.shape
    d_attn  = d_out @ Wh.T                                          # [N,N]
    d_Wh_a  = attn.T @ d_out                                        # [N,h]
    d_Einf  = attn*(d_attn - (d_attn*attn).sum(1, keepdims=True))  # [N,N] softmax bp
    d_Eact  = np.where(mask, d_Einf, 0.0)
    d_Epre  = d_Eact * d_leaky(Epre)
    d_e_s   = d_Epre.sum(1)                                         # [N]
    d_e_d   = d_Epre.sum(0)                                         # [N]
    d_a_s   = Wh.T @ d_e_s                                          # [h]
    d_a_d   = Wh.T @ d_e_d                                          # [h]
    d_a     = np.concatenate([d_a_s, d_a_d])
    d_Wh    = d_Wh_a + d_e_s[:,None]*a_s[None,:] + d_e_d[:,None]*a_d[None,:]
    d_W     = H.T @ d_Wh
    d_H     = d_Wh @ W.T
    return d_H, d_W, d_a

# ── Full 2-layer GAT model ────────────────────────────────────────────────────
# params: W1s,W1c,W1e, a1s,a1c,a1e, b1,
#         W2s,W2c,W2e, a2s,a2c,a2e, b2, Wo, bo

def gat_model_fwd(X, p):
    W1s,W1c,W1e,a1s,a1c,a1e,b1,W2s,W2c,W2e,a2s,a2c,a2e,b2,Wo,bo = p
    o1s,at1s,c1s = gat_fwd(X,   W1s, a1s, MASKS[0])
    o1c,at1c,c1c = gat_fwd(X,   W1c, a1c, MASKS[1])
    o1e,at1e,c1e = gat_fwd(X,   W1e, a1e, MASKS[2])
    Z1  = o1s + o1c + o1e + b1;  H1_ = relu(Z1)
    o2s,at2s,c2s = gat_fwd(H1_, W2s, a2s, MASKS[0])
    o2c,at2c,c2c = gat_fwd(H1_, W2c, a2c, MASKS[1])
    o2e,at2e,c2e = gat_fwd(H1_, W2e, a2e, MASKS[2])
    Z2  = o2s + o2c + o2e + b2;  H2_ = relu(Z2)
    logits = (H2_ @ Wo + bo).ravel()
    attn2 = {'self':at2s, 'cycle':at2c, 'echo':at2e}
    cache = (X, Z1, H1_, Z2, H2_, c1s,c1c,c1e, c2s,c2c,c2e)
    return sigmoid(logits), attn2, cache

def gat_model_bwd(pred, y, cache, p):
    X, Z1, H1_, Z2, H2_, c1s,c1c,c1e, c2s,c2c,c2e = cache
    *_, Wo, bo = p;  n = len(y)
    dL   = (pred - y) / n
    dWo  = H2_.T @ dL[:,None];  dbo = dL.sum(keepdims=True)
    dH2_ = dL[:,None] @ Wo.T
    dZ2  = dH2_ * d_relu(Z2);   db2 = dZ2.sum(0)
    dH1s, dW2s, da2s = gat_bwd(dZ2, c2s)
    dH1c, dW2c, da2c = gat_bwd(dZ2, c2c)
    dH1e, dW2e, da2e = gat_bwd(dZ2, c2e)
    dH1_ = dH1s + dH1c + dH1e
    dZ1  = dH1_ * d_relu(Z1);   db1 = dZ1.sum(0)
    _,dW1s,da1s = gat_bwd(dZ1, c1s)
    _,dW1c,da1c = gat_bwd(dZ1, c1c)
    _,dW1e,da1e = gat_bwd(dZ1, c1e)
    return [dW1s,dW1c,dW1e,da1s,da1c,da1e,db1,
            dW2s,dW2c,dW2e,da2s,da2c,da2e,db2, dWo,dbo]

def init_gat(seed=0):
    rng = np.random.default_rng(seed)
    he  = lambda fi,sh: rng.normal(0, np.sqrt(2/fi), sh).astype(np.float32)
    sm  = lambda sh:    rng.normal(0, 0.01, sh).astype(np.float32)
    return [he(D_IN,(D_IN,H1)),he(D_IN,(D_IN,H1)),he(D_IN,(D_IN,H1)),
            sm((2*H1,)),       sm((2*H1,)),       sm((2*H1,)),
            np.zeros(H1,np.float32),
            he(H1,(H1,H2)),   he(H1,(H1,H2)),   he(H1,(H1,H2)),
            sm((2*H2,)),      sm((2*H2,)),      sm((2*H2,)),
            np.zeros(H2,np.float32),
            he(H2,(H2,1)), np.zeros(1,np.float32)]

def train_gat(epochs=400, lr=3e-3, noise=0.5, n_samples=64, seed=0):
    rng=np.random.default_rng(seed); params=init_gat(seed)
    opt=Adam(params,lr=lr); log=[]
    for _ in range(epochs):
        el=0.0
        for _ in range(n_samples):
            X=BASE_X+rng.normal(0,noise,BASE_X.shape).astype(np.float32)
            pred,_,cache=gat_model_fwd(X,params)
            el+=bce(pred,LABELS)
            grads=gat_model_bwd(pred,LABELS,cache,params)
            params=opt.step(params,grads)
        log.append(el/n_samples)
    return params, log

# ── R-GNN (v2, kept for comparison) ──────────────────────────────────────────
def rgnn_fwd(X, p):
    Ws1,Wc1,We1,b1,Ws2,Wc2,We2,b2,Wo,bo = p
    Z1=X@Ws1+(Ac@X)@Wc1+(Ae@X)@We1+b1; H1_=relu(Z1)
    Z2=H1_@Ws2+(Ac@H1_)@Wc2+(Ae@H1_)@We2+b2; H2_=relu(Z2)
    return sigmoid((H2_@Wo+bo).ravel()), (Z1,H1_,Z2,H2_)

def rgnn_bwd(X, p, cache, pred, y):
    Ws1,Wc1,We1,b1,Ws2,Wc2,We2,b2,Wo,bo=p; Z1,H1_,Z2,H2_=cache; n=len(y)
    dL=(pred-y)/n; dWo=H2_.T@dL[:,None]; dbo=dL.sum(keepdims=True)
    dH2=dL[:,None]@Wo.T; dZ2=dH2*d_relu(Z2)
    dWs2=H1_.T@dZ2; dWc2=(Ac@H1_).T@dZ2; dWe2=(Ae@H1_).T@dZ2; db2=dZ2.sum(0)
    dH1=dZ2@Ws2.T+Ac.T@(dZ2@Wc2.T)+Ae.T@(dZ2@We2.T)
    dZ1=dH1*d_relu(Z1)
    dWs1=X.T@dZ1; dWc1=(Ac@X).T@dZ1; dWe1=(Ae@X).T@dZ1; db1=dZ1.sum(0)
    return [dWs1,dWc1,dWe1,db1,dWs2,dWc2,dWe2,db2,dWo,dbo]

def init_rgnn(seed=0):
    rng=np.random.default_rng(seed)
    he=lambda fi,sh: rng.normal(0,np.sqrt(2/fi),sh).astype(np.float32)
    return [he(D_IN,(D_IN,H1)),he(D_IN,(D_IN,H1)),he(D_IN,(D_IN,H1)),np.zeros(H1,np.float32),
            he(H1,(H1,H2)),   he(H1,(H1,H2)),   he(H1,(H1,H2)),   np.zeros(H2,np.float32),
            he(H2,(H2,1)), np.zeros(1,np.float32)]

def train_rgnn(epochs=400, lr=3e-3, noise=0.5, n_samples=64, seed=0):
    rng=np.random.default_rng(seed); params=init_rgnn(seed)
    opt=Adam(params,lr=lr); log=[]
    for _ in range(epochs):
        el=0.0
        for _ in range(n_samples):
            X=BASE_X+rng.normal(0,noise,BASE_X.shape).astype(np.float32)
            pred,cache=rgnn_fwd(X,params); el+=bce(pred,LABELS)
            grads=rgnn_bwd(X,params,cache,pred,LABELS)
            params=opt.step(params,grads)
        log.append(el/n_samples)
    return params, log

# ── GCN baseline (single adjacency) ──────────────────────────────────────────
def gcn_fwd(X,p,adj):
    W1,b1,W2,b2,Wo,bo=p; Z1=adj@X@W1+b1; H1_=relu(Z1)
    Z2=adj@H1_@W2+b2; H2_=relu(Z2)
    return sigmoid((H2_@Wo+bo).ravel()), (Z1,H1_,Z2,H2_)

def gcn_bwd(X,p,cache,pred,y,adj):
    W1,b1,W2,b2,Wo,bo=p; Z1,H1_,Z2,H2_=cache; n=len(y)
    dL=(pred-y)/n; dWo=H2_.T@dL[:,None]; dbo=dL.sum(keepdims=True)
    dH2=dL[:,None]@Wo.T; dZ2=dH2*d_relu(Z2); dW2=(adj@H1_).T@dZ2; db2=dZ2.sum(0)
    dH1=adj.T@dZ2@W2.T; dZ1=dH1*d_relu(Z1); dW1=(adj@X).T@dZ1; db1=dZ1.sum(0)
    return [dW1,db1,dW2,db2,dWo,dbo]

def init_gcn(seed=0):
    rng=np.random.default_rng(seed)
    he=lambda fi,sh: rng.normal(0,np.sqrt(2/fi),sh).astype(np.float32)
    return [he(D_IN,(D_IN,H1)),np.zeros(H1,np.float32),
            he(H1,(H1,H2)),np.zeros(H2,np.float32),he(H2,(H2,1)),np.zeros(1,np.float32)]

def train_gcn(adj, epochs=400, lr=3e-3, noise=0.5, n_samples=64, seed=0):
    rng=np.random.default_rng(seed); params=init_gcn(seed)
    opt=Adam(params,lr=lr); log=[]
    for _ in range(epochs):
        el=0.0
        for _ in range(n_samples):
            X=BASE_X+rng.normal(0,noise,BASE_X.shape).astype(np.float32)
            pred,cache=gcn_fwd(X,params,adj); el+=bce(pred,LABELS)
            grads=gcn_bwd(X,params,cache,pred,LABELS,adj)
            params=opt.step(params,grads)
        log.append(el/n_samples)
    return params, log

# ── Eval helpers ──────────────────────────────────────────────────────────────
def ev(fwd_fn, params, noise=0.5, n=500, seed=7777, **kw):
    rng=np.random.default_rng(seed); nh=np.zeros(N); gh=0
    for _ in range(n):
        X=BASE_X+rng.normal(0,noise,BASE_X.shape).astype(np.float32)
        pred=fwd_fn(X, params, **kw)
        if isinstance(pred, tuple): pred=pred[0]
        c=(pred>0.5)==LABELS; nh+=c; gh+=int(c.all())
    return nh/n, gh/n

gat_pred  = lambda X,p,**_: gat_model_fwd(X,p)[0]
rgnn_pred = lambda X,p,**_: rgnn_fwd(X,p)[0]
gcn_pred  = lambda X,p,adj: gcn_fwd(X,p,adj)[0]

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    np.set_printoptions(precision=3, suppress=True)

    print('=' * 66)
    print('  jennie21 GNN PoC v3 — GAT + R-GNN + noise sweep')
    print('=' * 66)

    NOISE, EPOCHS = 0.5, 400
    print(f'\n  Training all models (noise σ={NOISE}, {EPOCHS} epochs × 64) ...')
    print('  [GAT]   attention per edge type ...')
    gat_p, gat_l   = train_gat(epochs=EPOCHS, noise=NOISE, seed=0)
    print('  [R-GNN] relational fixed weights ...')
    rp,  rl        = train_rgnn(epochs=EPOCHS, noise=NOISE, seed=0)
    print('  [GCN]   orbit adj, single W ...')
    gp,  gl        = train_gcn(A_hat, epochs=EPOCHS, noise=NOISE, seed=0)
    print('  [BASE]  uniform ...')
    bp,  bl        = train_gcn(A_unif, epochs=EPOCHS, noise=NOISE, seed=0)

    gat_n,gat_g = ev(gat_pred,  gat_p, noise=NOISE)
    rn,rg       = ev(rgnn_pred, rp,    noise=NOISE)
    gn,gg       = ev(gcn_pred,  gp,    noise=NOISE, adj=A_hat)
    bn,bg       = ev(gcn_pred,  bp,    noise=NOISE, adj=A_unif)

    print(f'\n  {"─"*60}')
    print(f'  Model        Final loss   Node acc   Graph acc')
    print(f'  GAT          {gat_l[-1]:.4f}      {gat_n.mean()*100:5.1f}%     {gat_g*100:5.1f}%')
    print(f'  R-GNN        {rl[-1]:.4f}      {rn.mean()*100:5.1f}%     {rg*100:5.1f}%')
    print(f'  GCN (orbit)  {gl[-1]:.4f}      {gn.mean()*100:5.1f}%     {gg*100:5.1f}%')
    print(f'  Baseline     {bl[-1]:.4f}      {bn.mean()*100:5.1f}%     {bg*100:5.1f}%')

    # ── Attention weight inspection ───────────────────────────────────────────
    print(f'\n  {"─"*60}')
    print(f'  GAT layer-2 attention weights (clean features, per-neighbor):')
    print(f'  Each row = source node, each col = neighbor it attends to')
    _, attn2, _ = gat_model_fwd(BASE_X, gat_p)

    EDGE_LABELS = {
        (1,4): '2↔7 driver-driver', (4,1): '7↔2 driver-driver',
        (0,3): '1↔8 echo-echo',     (3,0): '8↔1 echo-echo',
        (2,5): '4↔5 driver-echo',   (5,2): '5↔4 driver-echo',
    }
    print(f'\n  Echo-edge attention weights (layer 2):')
    print(f'  {"edge":>22}  {"attn weight":>12}')
    for etype, mat in attn2.items():
        if etype != 'echo': continue
        for (i, j), label in EDGE_LABELS.items():
            if MASKS[2][i,j]:
                print(f'  {label:>22}  {mat[i,j]:.4f}')

    print(f'\n  Cycle-edge mean attention (layer 2): {attn2["cycle"][MASKS[1]].mean():.4f}')
    print(f'  Echo-edge  mean attention (layer 2): {attn2["echo"][MASKS[2]].mean():.4f}')
    print(f'  Self-loop  mean attention (layer 2): {attn2["self"][MASKS[0]].mean():.4f}')

    # ── Noise robustness sweep ────────────────────────────────────────────────
    print(f'\n  {"─"*60}')
    print(f'  Noise robustness sweep (training and eval each model fresh):')
    print(f'  {"noise σ":>8}  {"GAT graph%":>11}  {"R-GNN graph%":>13}  {"GCN graph%":>11}')
    for nv in [0.2, 0.5, 0.8, 1.2, 1.8]:
        gp2,_  = train_gat(epochs=300, noise=nv, seed=99)
        rp2,_  = train_rgnn(epochs=300, noise=nv, seed=99)
        cp2,_  = train_gcn(A_hat, epochs=300, noise=nv, seed=99)
        _,ga   = ev(gat_pred,  gp2, noise=nv, seed=8888)
        _,ra   = ev(rgnn_pred, rp2, noise=nv, seed=8888)
        _,ca   = ev(gcn_pred,  cp2, noise=nv, seed=8888, adj=A_hat)
        print(f'  {nv:>8.1f}  {ga*100:>9.1f}%  {ra*100:>11.1f}%  {ca*100:>9.1f}%')

    print(f'\n  Convergence (final 4 models, every 100 epochs):')
    for ep in range(99, EPOCHS, 100):
        print(f'  ep {ep+1:4d}  GAT={gat_l[ep]:.4f}  R-GNN={rl[ep]:.4f}  GCN={gl[ep]:.4f}  BASE={bl[ep]:.4f}')
