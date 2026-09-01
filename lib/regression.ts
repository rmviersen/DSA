// Simple OLS regression, extracted 2026-08-31 from scripts/compute-market-
// rates.ts so it can also be used by app/admin/rating-validation's
// client-side regressions -- isomorphic (no Node-only APIs), safe to import
// from either a script or a "use client" component.

export interface RegressionResult {
  intercept: number;
  slope: number;
  rSquared: number;
  residualStdDev: number;
}

// y = intercept + slope * x, plus R² and the residual standard deviation
// (both in whatever space the input points are already in -- callers doing
// a log-linear fit should pass log-transformed y values themselves).
export function fitLine(points: { x: number; y: number }[]): RegressionResult {
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0, den = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  let ssRes = 0, ssTot = 0;
  for (const p of points) {
    const predicted = intercept + slope * p.x;
    ssRes += (p.y - predicted) ** 2;
    ssTot += (p.y - meanY) ** 2;
  }
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const residualStdDev = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;
  return { intercept, slope, rSquared, residualStdDev };
}

// Pool-adjacent-violators algorithm (2026-08-31, for scripts/compute-
// fielding-weights.ts): projects `values` -- given in the order you want the
// OUTPUT to respect -- onto the nearest non-increasing sequence, weighted by
// `weights` (a bigger weight is trusted more during merging, e.g. sample
// size). Whenever a value is bigger than the one before it (a violation of
// "non-increasing"), the two are merged into one weighted-average block and
// the check repeats backward until the whole sequence is non-increasing
// again. This is what guarantees an ordering constraint (e.g. "SS's fielding
// weight can never end up below 1B's") holds by construction, not by hoping
// a noisy per-group regression happens to agree with it.
export function isotonicRegressionNonIncreasing(values: number[], weights: number[]): number[] {
  interface Block { value: number; weight: number; count: number }
  const stack: Block[] = [];
  for (let i = 0; i < values.length; i++) {
    let merged: Block = { value: values[i], weight: weights[i], count: 1 };
    while (stack.length > 0 && stack[stack.length - 1].value < merged.value) {
      const prev = stack.pop()!;
      const totalWeight = prev.weight + merged.weight;
      merged = {
        value: totalWeight === 0 ? merged.value : (prev.value * prev.weight + merged.value * merged.weight) / totalWeight,
        weight: totalWeight,
        count: prev.count + merged.count,
      };
    }
    stack.push(merged);
  }
  const result: number[] = [];
  for (const block of stack) for (let i = 0; i < block.count; i++) result.push(block.value);
  return result;
}
