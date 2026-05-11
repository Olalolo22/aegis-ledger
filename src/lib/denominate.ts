/**
 * Breaks an amount into the smallest number of standard note denominations.
 * Uses a greedy descending algorithm.
 *
 * Why: Without this, an observer can match exact deposit and withdrawal amounts,
 * completely breaking privacy. Uniform notes break value-linkage heuristics.
 */

const DEFAULT_DENOMINATIONS = [1000, 500, 250, 100, 50, 25, 10, 5, 1]; // whole numbers only

export function denominate(
  amount: number,
  denoms: number[] = DEFAULT_DENOMINATIONS
): number[] {
  if (amount <= 0) return [];

  // make a copy and sort descending just in case
  const sorted = [...denoms].sort((a, b) => b - a);
  const notes: number[] = [];

  let remaining = Math.floor(amount);

  for (const denom of sorted) {
    while (remaining >= denom) {
      notes.push(denom);
      remaining -= denom;
    }
  }

  // Handle fractional part as a "remainder" note
  const fractional = amount - Math.floor(amount);
  if (fractional > 0.0001) {
    notes.push(Number(fractional.toFixed(6))); // Avoid floating point noise
  }

  return notes;
}
