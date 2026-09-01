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
