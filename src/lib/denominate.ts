/**
 * MagicBlock PER Private Transfer Split & Jitter Planner.
 *
 * Threat-model honesty:
 * Splitting a salary greedily into fixed denominations (e.g. $3,800 -> 3x1000,
 * 500, 250, 50 + fractional cents) and sending those notes directly to the same
 * recipient wallet does NOT hide the amount — the multiset trivially sums back
 * to the salary, and any fractional remainder is a unique fingerprint.
 *
 * Instead, confidentiality in Aegis comes from executing transfers inside
 * MagicBlock's delegated Private Ephemeral Rollup (Intel TDX TEE) with:
 *   - visibility: "private"
 *   - fromBalance: "ephemeral"
 *   - randomized sub-transfer split counts + asynchronous delay windows
 *     (minDelayMs / maxDelayMs) enforced by MagicBlock's Private SPL engine.
 *
 * This module computes the actual `split`, `minDelayMs`, and `maxDelayMs`
 * parameters passed into `buildMagicBlockSplTransfer`.
 */

export interface MagicBlockSplitPlan {
  /** Number of randomized private sub-transfers executed inside MagicBlock PER */
  split: number;
  /** Minimum delay between sub-transfers in milliseconds */
  minDelayMs: string;
  /** Maximum delay between sub-transfers in milliseconds */
  maxDelayMs: string;
}

/**
 * Computes the MagicBlock Private SPL split count and timing jitter window for
 * a recipient disbursement.
 *
 * - Very small transfers (< 10 units) use `split: 1` to avoid unnecessary
 *   sub-transfer overhead or dust rounding.
 * - Medium transfers (10..999 units) use `split: 2`.
 * - Large transfers (1,000..4,999 units) use `split: 3`.
 * - Executive/high-value transfers (>= 5,000 units) use `split: 4`.
 */
export function computeMagicBlockSplitPlan(
  amountBaseUnits: bigint,
  decimals: number = 6
): MagicBlockSplitPlan {
  if (amountBaseUnits <= 0n) {
    throw new Error("Transfer amount must be greater than zero.");
  }

  const unitDivisor = 10n ** BigInt(decimals);
  const wholeUnits = amountBaseUnits / unitDivisor;

  // For native SOL (9 decimals), treat >= 0.5 SOL as split-eligible
  if (decimals === 9) {
    const halfSol = 500_000_000n;
    const fiveSol = 5_000_000_000n;
    if (amountBaseUnits < halfSol) {
      return { split: 1, minDelayMs: "500", maxDelayMs: "1500" };
    }
    if (amountBaseUnits < fiveSol) {
      return { split: 2, minDelayMs: "750", maxDelayMs: "2500" };
    }
    return { split: 3, minDelayMs: "1000", maxDelayMs: "4000" };
  }

  // Stablecoins (USDC/USDT, 6 decimals)
  if (wholeUnits < 10n) {
    return { split: 1, minDelayMs: "500", maxDelayMs: "1500" };
  }
  if (wholeUnits < 1000n) {
    return { split: 2, minDelayMs: "750", maxDelayMs: "2500" };
  }
  if (wholeUnits < 5000n) {
    return { split: 3, minDelayMs: "1000", maxDelayMs: "3500" };
  }
  return { split: 4, minDelayMs: "1200", maxDelayMs: "5000" };
}
