-- jennie21: Formal verification of the mod-9 doubling orbit
-- Proved in Lean 4 + Mathlib, 2026-08-06
--
-- Core claim: {1,2,4,8,7,5} is the orbit of 1 under ×2 in ZMod 9,
-- and {0,3,6} is its unreachable complement — the non-units of ZMod 9.

import Mathlib.Data.ZMod.Basic
import Mathlib.GroupTheory.OrderOfElement
import Mathlib.Tactic

-- The orbit: 1 → 2 → 4 → 8 → 7 → 5 → 1
example : (2 : ZMod 9) ^ 0 = 1 := by decide
example : (2 : ZMod 9) ^ 1 = 2 := by decide
example : (2 : ZMod 9) ^ 2 = 4 := by decide
example : (2 : ZMod 9) ^ 3 = 8 := by decide
example : (2 : ZMod 9) ^ 4 = 7 := by decide  -- 16 mod 9
example : (2 : ZMod 9) ^ 5 = 5 := by decide  -- 32 mod 9
example : (2 : ZMod 9) ^ 6 = 1 := by decide  -- cycle closes

-- No smaller positive power returns to 1 (period is exactly 6)
example : (2 : ZMod 9) ^ 1 ≠ 1 := by decide
example : (2 : ZMod 9) ^ 2 ≠ 1 := by decide
example : (2 : ZMod 9) ^ 3 ≠ 1 := by decide
example : (2 : ZMod 9) ^ 4 ≠ 1 := by decide
example : (2 : ZMod 9) ^ 5 ≠ 1 := by decide

-- Complement {0,3,6} = non-units (unreachable from 1 under ×2)
example : ¬IsUnit (0 : ZMod 9) := by decide
example : ¬IsUnit (3 : ZMod 9) := by decide
example : ¬IsUnit (6 : ZMod 9) := by decide

-- Orbit elements are all units (coprime to 9)
example : IsUnit (1 : ZMod 9) := by decide
example : IsUnit (2 : ZMod 9) := by decide
example : IsUnit (4 : ZMod 9) := by decide
example : IsUnit (5 : ZMod 9) := by decide
example : IsUnit (7 : ZMod 9) := by decide
example : IsUnit (8 : ZMod 9) := by decide

-- The multiplicative order of 2 in ZMod 9 is exactly 6
set_option maxHeartbeats 800000 in
theorem orbit_period : orderOf (2 : ZMod 9) = 6 := by
  have hdvd : orderOf (2 : ZMod 9) ∣ 6 := orderOf_dvd_of_pow_eq_one (by decide)
  have hle  : orderOf (2 : ZMod 9) ≤ 6 := Nat.le_of_dvd (by decide) hdvd
  have hpow := pow_orderOf_eq_one (2 : ZMod 9)
  have hne0 : orderOf (2 : ZMod 9) ≠ 0 := by
    rintro h; rw [h] at hdvd; exact absurd hdvd (by decide)
  have hne1 : orderOf (2 : ZMod 9) ≠ 1 := by
    rintro h; rw [h] at hpow; exact absurd hpow (by decide)
  have hne2 : orderOf (2 : ZMod 9) ≠ 2 := by
    rintro h; rw [h] at hpow; exact absurd hpow (by decide)
  have hne3 : orderOf (2 : ZMod 9) ≠ 3 := by
    rintro h; rw [h] at hpow; exact absurd hpow (by decide)
  have hne4 : orderOf (2 : ZMod 9) ≠ 4 := by
    rintro h; rw [h] at hpow; exact absurd hpow (by decide)
  have hne5 : orderOf (2 : ZMod 9) ≠ 5 := by
    rintro h; rw [h] at hpow; exact absurd hpow (by decide)
  omega
