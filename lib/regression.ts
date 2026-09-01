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

export interface MultipleRegressionResult {
  intercept: number;
  coefficients: number[]; // one per predictor, same order as input columns
  standardizedCoefficients: number[]; // coefficient * (predictor SD / response SD) -- comparable across predictors on different scales, unlike the raw coefficients
  rSquared: number;
}

// Ordinary least squares with 2+ predictors, solved via the normal equations
// (X^T X) β = X^T y, using Gauss-Jordan elimination with partial pivoting.
// No external stats library in this project's dependencies (2026-09-01
// check, package.json) -- for a handful of predictors and a few hundred
// rows this is exact and fast, no need to pull one in.
export function fitMultipleLinear(rows: { x: number[]; y: number }[]): MultipleRegressionResult {
  const n = rows.length;
  const p = rows[0].x.length; // number of predictors
  const cols = p + 1; // + intercept column

  // Build X^T X (cols x cols) and X^T y (cols) directly, without materializing
  // the full design matrix -- X's first column is always 1 (the intercept).
  const xtx: number[][] = Array.from({ length: cols }, () => new Array(cols).fill(0));
  const xty: number[] = new Array(cols).fill(0);
  for (const row of rows) {
    const xi = [1, ...row.x];
    for (let a = 0; a < cols; a++) {
      xty[a] += xi[a] * row.y;
      for (let b = 0; b < cols; b++) xtx[a][b] += xi[a] * xi[b];
    }
  }

  // Augment [X^T X | X^T y] and row-reduce to solve for β.
  const aug = xtx.map((row, i) => [...row, xty[i]]);
  for (let col = 0; col < cols; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < cols; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivotRow][col])) pivotRow = r;
    }
    [aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]];
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) continue; // singular/collinear column -- leave its coefficient at 0 below
    for (let c = col; c <= cols; c++) aug[col][c] /= pivot;
    for (let r = 0; r < cols; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      for (let c = col; c <= cols; c++) aug[r][c] -= factor * aug[col][c];
    }
  }
  const beta = aug.map((row) => row[cols]);
  const intercept = beta[0];
  const coefficients = beta.slice(1);

  const meanY = rows.reduce((s, r) => s + r.y, 0) / n;
  let ssRes = 0, ssTot = 0;
  for (const row of rows) {
    const predicted = intercept + coefficients.reduce((s, c, i) => s + c * row.x[i], 0);
    ssRes += (row.y - predicted) ** 2;
    ssTot += (row.y - meanY) ** 2;
  }
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  const sdY = Math.sqrt(rows.reduce((s, r) => s + (r.y - meanY) ** 2, 0) / n);
  const standardizedCoefficients = coefficients.map((c, i) => {
    const meanXi = rows.reduce((s, r) => s + r.x[i], 0) / n;
    const sdXi = Math.sqrt(rows.reduce((s, r) => s + (r.x[i] - meanXi) ** 2, 0) / n);
    return sdY === 0 ? 0 : c * (sdXi / sdY);
  });

  return { intercept, coefficients, standardizedCoefficients, rSquared };
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
