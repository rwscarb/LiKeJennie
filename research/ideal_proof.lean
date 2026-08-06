-- jennie21: {0,3,6} is an ideal in ZMod 9 — the "void" set has algebraic structure
-- Proved in Lean 4 + Mathlib, 2026-08-06

import Mathlib.Data.ZMod.Basic
import Mathlib.Tactic

-- The complement of the orbit
def J : Finset (ZMod 9) := {0, 3, 6}

-- Ideal property 1: closed under addition (additive subgroup)
theorem J_add_closed : ∀ a b : ZMod 9, a ∈ J → b ∈ J → a + b ∈ J := by decide

-- Ideal property 2: absorbs multiplication from outside
theorem J_mul_left  : ∀ r a : ZMod 9, a ∈ J → r * a ∈ J := by decide
theorem J_mul_right : ∀ r a : ZMod 9, a ∈ J → a * r ∈ J := by decide

-- J = exactly the multiples of 3 in ZMod 9
theorem J_eq_multiples : ∀ a : ZMod 9, a ∈ J ↔ ∃ k : ZMod 9, a = 3 * k := by decide

-- J = exactly the non-units (no element of J has a multiplicative inverse)
theorem J_eq_nonunits : ∀ a : ZMod 9, a ∈ J ↔ ¬IsUnit a := by decide

-- Duality: orbit = units = complement of J
theorem orbit_eq_units : ∀ a : ZMod 9, a ∉ J ↔ IsUnit a := by decide

-- Negative of J stays in J (additive subgroup closure)
theorem J_neg_closed : ∀ a : ZMod 9, a ∈ J → -a ∈ J := by decide

-- Bonus one-liners
example : Nat.fib 8 = 21  := by decide  -- F₈ = 21
example : 7^2 * 3 = 147   := by decide  -- nucleosome length
