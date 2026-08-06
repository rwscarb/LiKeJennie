-- jennie21: 2 is a primitive root mod 9
-- The orbit {1,2,4,8,7,5} exhausts (ZMod 9)×
-- Proved in Lean 4 + Mathlib, 2026-08-06

import Mathlib.Data.ZMod.Basic
import Mathlib.GroupTheory.OrderOfElement
import Mathlib.Tactic

-- The ideal (from ideal_proof.lean — redefined here for self-containment)
def J : Finset (ZMod 9) := {0, 3, 6}

-- The orbit of 1 under ×2
def orbit : Finset (ZMod 9) := {1, 2, 4, 5, 7, 8}

-- The orbit IS the unit group
theorem orbit_eq_units_finset : ∀ a : ZMod 9, a ∈ orbit ↔ IsUnit a := by decide

-- The orbit has exactly 6 elements (φ(9) = 6)
theorem orbit_card : orbit.card = 6 := by decide

-- Euler's totient: φ(9) = 6
example : Nat.totient 9 = 6 := by decide

-- Orbit = exactly the powers of 2 (mod indices 0..5)
theorem orbit_is_powers :
    orbit = Finset.image (fun n => (2 : ZMod 9) ^ n) (Finset.range 6) := by decide

-- 2 is a primitive root: every unit is some power of 2
theorem two_is_primitive_root :
    ∀ a : ZMod 9, IsUnit a → ∃ n : ℕ, n < 6 ∧ a = (2 : ZMod 9) ^ n := by decide

-- The orbit and the ideal partition ZMod 9 completely
theorem partition : ∀ a : ZMod 9, a ∈ orbit ∨ a ∈ J := by decide
