// Small logistic regression (Newton-Raphson / IRLS) with Wald standard errors,
// isomorphic and dependency-free (2026-09-19, for the Work Ethic vs. reaching-
// the-majors report). Same "no stats library in package.json" reasoning as
// lib/regression.ts. Handful of predictors, a few thousand rows -- exact and fast.

export interface LogisticFit {
  coefficients: number[]; // index 0 = intercept, then one per predictor column
  standardErrors: number[];
  covariance: number[][];
  converged: boolean;
  iterations: number;
}

function invert(m: number[][]): number[][] | null {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return null;
    [a[c], a[p]] = [a[p], a[c]];
    const piv = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f !== 0) for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((row) => row.slice(n));
}

// rows: predictor values (WITHOUT the intercept -- it's added here); y: 0/1.
export function fitLogistic(rows: number[][], y: number[], maxIter = 50): LogisticFit | null {
  const n = rows.length;
  if (n === 0) return null;
  const p = rows[0].length + 1;
  const X = rows.map((r) => [1, ...r]);
  let beta = new Array(p).fill(0);
  let converged = false;
  let iter = 0;
  let cov: number[][] | null = null;
  for (; iter < maxIter; iter++) {
    const grad = new Array(p).fill(0);
    const hess: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < n; i++) {
      let z = 0;
      for (let j = 0; j < p; j++) z += X[i][j] * beta[j];
      const mu = 1 / (1 + Math.exp(-z));
      const w = Math.max(mu * (1 - mu), 1e-9);
      for (let j = 0; j < p; j++) {
        grad[j] += X[i][j] * (y[i] - mu);
        for (let k = 0; k < p; k++) hess[j][k] += w * X[i][j] * X[i][k];
      }
    }
    const inv = invert(hess);
    if (!inv) return null;
    cov = inv;
    const step = inv.map((row) => row.reduce((s, v, k) => s + v * grad[k], 0));
    beta = beta.map((b, j) => b + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) { converged = true; iter++; break; }
  }
  if (!cov) return null;
  return { coefficients: beta, standardErrors: cov.map((row, i) => Math.sqrt(Math.max(row[i], 0))), covariance: cov, converged, iterations: iter };
}
