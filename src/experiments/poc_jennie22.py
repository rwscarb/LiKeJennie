"""
poc_jennie22.py — Tribonacci → jennie22 bridge

jennie21 is built on:
  φ (golden ratio, 2-term Fibonacci recurrence), F₈=21 as anchor,
  mod-9 orbit {1,2,4,5,7,8}, balanced ternary {-1,0,+1}

jennie22 hypothesis:
  Tribonacci extends Fibonacci to 3-term recurrence.
  φ_T ≈ 1.8393 (Tribonacci constant).
  The 1:φ_T:φ_T² cascade discovered in 3-layer ternary networks
  connects the 3-term recurrence to the mod-9 orbit and BT balance.

Questions explored:
  1. What is the Tribonacci sequence's structure mod 9?
  2. Does it visit the same orbit {1,2,4,5,7,8}?
  3. Does the cascade ratio map cleanly to φ_T?
"""

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D
from collections import Counter

PHI   = (1 + np.sqrt(5)) / 2        # golden ratio ≈ 1.618
PHI_T = 1.8392867552141612           # Tribonacci constant

# ── Sequences ─────────────────────────────────────────────────────────────────

def fibonacci(n):
    a, b = 0, 1
    seq = [0]
    for _ in range(n - 1):
        a, b = b, a + b
        seq.append(a)
    return seq

def tribonacci(n):
    seq = [0, 1, 1]
    for _ in range(n - 3):
        seq.append(seq[-1] + seq[-2] + seq[-3])
    return seq[:n]

N = 200
FIB  = fibonacci(N)
TRIB = tribonacci(N)

# ── Mod-9 structure ───────────────────────────────────────────────────────────

MOD          = 9
ORBIT_VALUES = {1, 2, 4, 5, 7, 8}

fib_mod9  = [f % MOD for f in FIB]
trib_mod9 = [t % MOD for t in TRIB]

def fibonacci_period_mod9(seq):
    # Pisano: find next (0,1) pair after index 0
    for i in range(1, len(seq) - 1):
        if seq[i] == 0 and seq[i+1] == 1:
            return i
    return None

def tribonacci_period_mod9(seq):
    # Tribonacci Pisano: find next (0,1,1) triple after index 0
    for i in range(1, len(seq) - 2):
        if seq[i] == 0 and seq[i+1] == 1 and seq[i+2] == 1:
            return i
    return None

fib_period  = fibonacci_period_mod9(fib_mod9)
trib_period = tribonacci_period_mod9(trib_mod9)

fib_one_period  = fib_mod9[:fib_period]
trib_one_period = trib_mod9[:trib_period]

fib_orbit_frac  = sum(1 for v in fib_one_period  if v in ORBIT_VALUES) / len(fib_one_period)
trib_orbit_frac = sum(1 for v in trib_one_period if v in ORBIT_VALUES) / len(trib_one_period)

fib_counts  = Counter(fib_one_period)
trib_counts = Counter(trib_one_period)

# ── Cascade data ──────────────────────────────────────────────────────────────

# Empirical settled |W| from D (0.5×) variant, sep=1.5σ, 3-layer square network
D_cascade   = [0.110, 0.202, 0.351]
D_ratio     = [v / D_cascade[0] for v in D_cascade]
PHI_T_ratio = [PHI_T**i for i in range(3)]
PHI_ratio   = [PHI**i for i in range(3)]

# Empirical ternary balance (fraction +1/0/-1 per layer) from D variant
layer_balance = {
    'fc1': (+0.293, 0.419, 0.288),
    'fc2': (+0.333, 0.334, 0.332),
    'fc3': (+0.334, 0.333, 0.333),
}

# ── Plot ──────────────────────────────────────────────────────────────────────

BG    = '#0d0d1a'
ORANGE = '#ff9800'
PINK   = '#ff4081'
PURPLE = '#c060ff'
TEAL   = '#00e5ff'
GREEN  = '#00ff88'
YELLOW = '#ffe033'
GRAY   = '#888888'

def bar_color(v):
    if v in ORBIT_VALUES: return PINK
    elif v == 0:          return GRAY
    else:                 return PURPLE  # 3, 6

fig = plt.figure(figsize=(24, 11), facecolor=BG)
fig.suptitle(
    'jennie22 PoC  —  Tribonacci as Extension of Fibonacci\n'
    f'φ ≈ {PHI:.4f} (2-term)  →  φ_T ≈ {PHI_T:.4f} (3-term)  |  mod-9 orbit  |  ternary cascade attractor',
    fontsize=12, color='white', y=0.99)

def styled(ax, title):
    ax.set_facecolor('#111128')
    ax.tick_params(colors='#aaa', labelsize=7)
    for spine in ax.spines.values():
        spine.set_edgecolor('#333')
    ax.set_title(title, fontsize=8.5, color='white', pad=6)
    ax.grid(alpha=0.12, color='white')

# ── 1. Fibonacci helix ─────────────────────────────────────────────────────
ax1 = fig.add_subplot(2, 4, 1, projection='3d')
t = np.linspace(0, 5 * 2 * np.pi, 800)
r = PHI ** (t / (2 * np.pi))
ax1.plot(r * np.cos(t), r * np.sin(t), t / (2 * np.pi), color=ORANGE, lw=1.5, alpha=0.9)
ax1.set_facecolor(BG)
ax1.set_title(f'Fibonacci Helix\nφ ≈ {PHI:.4f}  (2-term)', fontsize=8.5, color='white')
ax1.tick_params(colors='#888', labelsize=6)

# ── 2. Tribonacci helix ────────────────────────────────────────────────────
ax2 = fig.add_subplot(2, 4, 2, projection='3d')
r_t = PHI_T ** (t / (2 * np.pi))
ax2.plot(r_t * np.cos(t), r_t * np.sin(t), t / (2 * np.pi), color=PINK, lw=1.5, alpha=0.9)
ax2.set_facecolor(BG)
ax2.set_title(f'Tribonacci Helix\nφ_T ≈ {PHI_T:.4f}  (3-term)', fontsize=8.5, color='white')
ax2.tick_params(colors='#888', labelsize=6)

# ── 3. Fibonacci mod 9 (one period) ───────────────────────────────────────
ax3 = fig.add_subplot(2, 4, 3)
styled(ax3, f'Fibonacci mod 9  (period = {fib_period})\npink=orbit  purple=axis  gray=zero')
colors3 = [bar_color(v) for v in fib_one_period]
ax3.bar(range(len(fib_one_period)), fib_one_period, color=colors3, alpha=0.85, width=0.8)
ax3.set_xlabel('index', color='#aaa', fontsize=7)
ax3.set_ylabel('value mod 9', color='#aaa', fontsize=7)
ax3.set_ylim(0, 9)
ax3.axhline(4.5, color='white', lw=0.4, alpha=0.3)

# ── 4. Tribonacci mod 9 (one period, first 60 shown) ──────────────────────
ax4 = fig.add_subplot(2, 4, 4)
styled(ax4, f'Tribonacci mod 9  (period = {trib_period})\npink=orbit  purple=axis  gray=zero')
show = min(len(trib_one_period), 60)
colors4 = [bar_color(v) for v in trib_one_period[:show]]
ax4.bar(range(show), trib_one_period[:show], color=colors4, alpha=0.85, width=0.8)
ax4.set_xlabel('index', color='#aaa', fontsize=7)
ax4.set_ylabel('value mod 9', color='#aaa', fontsize=7)
ax4.set_ylim(0, 9)
if len(trib_one_period) > show:
    ax4.set_title(ax4.get_title() + f'\n(showing first {show} of {trib_period})', fontsize=7.5, color='white')

# ── 5. Visit frequency: Fibonacci ─────────────────────────────────────────
ax5 = fig.add_subplot(2, 4, 5)
styled(ax5, f'Fibonacci mod 9\nvisit frequency per period ({fib_period} steps)\norbit fraction: {fib_orbit_frac:.1%}')
positions = list(range(MOD))
colors5 = [bar_color(i) for i in positions]
ax5.bar(positions, [fib_counts.get(i, 0) for i in positions], color=colors5, alpha=0.85)
ax5.set_xlabel('value (mod 9)', color='#aaa', fontsize=7)
ax5.set_ylabel('visits', color='#aaa', fontsize=7)
ax5.set_xticks(positions)

# ── 6. Visit frequency: Tribonacci ────────────────────────────────────────
ax6 = fig.add_subplot(2, 4, 6)
styled(ax6, f'Tribonacci mod 9\nvisit frequency per period ({trib_period} steps)\norbit fraction: {trib_orbit_frac:.1%}')
colors6 = [bar_color(i) for i in positions]
ax6.bar(positions, [trib_counts.get(i, 0) for i in positions], color=colors6, alpha=0.85)
ax6.set_xlabel('value (mod 9)', color='#aaa', fontsize=7)
ax6.set_ylabel('visits', color='#aaa', fontsize=7)
ax6.set_xticks(positions)

# ── 7. Cascade ratios ──────────────────────────────────────────────────────
ax7 = fig.add_subplot(2, 4, 7)
styled(ax7, 'Layer-wise |W| ratio at equilibrium\n3-layer ternary net  (D variant, sep=1.5σ)')
layers = [1, 2, 3]
ax7.plot(layers, D_ratio,     'o-',  color=PINK,   lw=2.5, ms=9, label='Empirical (D, 0.5×)')
ax7.plot(layers, PHI_T_ratio, 's--', color=YELLOW, lw=1.5, ms=7, label=f'φ_T^n  (1, {PHI_T:.3f}, {PHI_T**2:.3f})')
ax7.plot(layers, PHI_ratio,   '^--', color=ORANGE, lw=1.5, ms=7, label=f'φ^n  (1, {PHI:.3f}, {PHI**2:.3f})')
ax7.fill_between(layers, [v*0.93 for v in PHI_T_ratio], [v*1.07 for v in PHI_T_ratio],
                 color=YELLOW, alpha=0.08)
for i, (r, rpt) in enumerate(zip(D_ratio, PHI_T_ratio)):
    err = abs(r - rpt) / rpt * 100
    ax7.annotate(f'{err:.1f}% err', xy=(layers[i], r), xytext=(layers[i]+0.05, r+0.12),
                 fontsize=6.5, color='#ccc')
ax7.set_xticks(layers); ax7.set_xticklabels(['fc1', 'fc2', 'fc3'], color='#aaa')
ax7.set_ylabel('|W| ratio  (fc1 = 1)', color='#aaa', fontsize=7)
ax7.legend(fontsize=7, facecolor='#1a1a2e', labelcolor='white')

# ── 8. BT balance cascade ──────────────────────────────────────────────────
ax8 = fig.add_subplot(2, 4, 8)
styled(ax8, 'Ternary balance at equilibrium (D variant)\nfc1 plastic → fc2/fc3 balanced ternary')
layer_names = list(layer_balance.keys())
x = np.arange(3)
w = 0.25
for j, (lname, (pos, zer, neg)) in enumerate(layer_balance.items()):
    offset = (j - 1) * w
    ax8.bar(x + offset, [pos, zer, abs(neg)], w,
            color=[GREEN, GRAY, TEAL], alpha=0.55 + 0.2*j,
            label=lname if j == 0 else None)
ax8.axhline(1/3, color='white', lw=1.2, ls='--', alpha=0.5, label='Perfect BT (1/3)')
ax8.set_xticks(x); ax8.set_xticklabels(['+1', '0', '-1'], color='#aaa')
ax8.set_ylabel('fraction', color='#aaa', fontsize=7)
ax8.set_ylim(0, 0.55)
ax8.legend(['fc1', 'fc2', 'fc3', '1/3 BT'], fontsize=7, facecolor='#1a1a2e', labelcolor='white')

plt.tight_layout(rect=[0, 0, 1, 0.95])
out = 'jennie22_poc.png'
plt.savefig(out, dpi=140, bbox_inches='tight', facecolor=BG)

# ── Report ────────────────────────────────────────────────────────────────────

print(f"\n{'='*60}")
print(f"  jennie21 → jennie22  Bridge Report")
print(f"{'='*60}")
print(f"\n  φ   (Fibonacci, 2-term):   {PHI:.6f}")
print(f"  φ_T (Tribonacci, 3-term):  {PHI_T:.6f}")
print(f"\n  Fibonacci mod 9 period:    {fib_period}")
print(f"  Tribonacci mod 9 period:   {trib_period}")
print(f"\n  Fibonacci mod 9 (one period):")
print(f"  {fib_one_period}")
print(f"  orbit visits: {sum(1 for v in fib_one_period if v in ORBIT_VALUES)}/{fib_period}  ({fib_orbit_frac:.1%})")
print(f"\n  Tribonacci mod 9 (one period):")
if len(trib_one_period) <= 80:
    print(f"  {trib_one_period}")
else:
    print(f"  [{', '.join(str(v) for v in trib_one_period[:40])} ...]")
print(f"  orbit visits: {sum(1 for v in trib_one_period if v in ORBIT_VALUES)}/{trib_period}  ({trib_orbit_frac:.1%})")
print(f"\n  Cascade attractor:")
print(f"  Empirical |W|: {D_cascade}")
print(f"  Ratio:         {[round(r, 3) for r in D_ratio]}")
print(f"  φ_T^n:         {[round(r, 3) for r in PHI_T_ratio]}")
print(f"  φ^n:           {[round(r, 3) for r in PHI_ratio]}")
print(f"\n  Ternary BT balance at equilibrium:")
for layer, (pos, zer, neg) in layer_balance.items():
    balance_err = max(abs(pos - 1/3), abs(zer - 1/3), abs(abs(neg) - 1/3))
    print(f"  {layer}: +1={pos:.3f}  0={zer:.3f}  -1={abs(neg):.3f}  "
          f"max_err_from_BT={balance_err:.4f}")
print(f"\n  Saved: {out}")
print(f"{'='*60}")
