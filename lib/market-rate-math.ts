// Pure market-rate math, shared by the Free Agency page and the /admin/market-rates explorer (2026-10-13, Rees's ask).
// No imports on purpose: safe to pull into a client bundle (see the per-function-client note in market-rate-query.ts).

// The most any player has ever signed for in this league is ~$49M, so no fair value may exceed this. The log-linear
// curves otherwise explode at the top end (an Overall-80 hitter extrapolates to well over $100M).
export const MARKET_RATE_MAX_AAV = 50_000_000;

// Hitters share one curve (role multipliers adjust by position); starting pitchers and relievers each get their own,
// because the market pays them very differently at the same Overall.
export type MarketType = "hitter" | "sp" | "rp";
export function marketTypeForRole(role: string): MarketType {
  if (role === "SP") return "sp";
  if (role === "RP") return "rp";
  return "hitter";
}

export interface MarketCurveInput {
  intercept: number;
  slope: number;
  maxOverallInSample: number;
  leagueMinimumSalary: number;
}

// Fair-value AAV for a given Overall. Two guards on top of the raw exp(intercept + slope * overall):
//  - Overall is clamped to the highest Overall actually observed in that curve's training sample, so the line is never
//    extrapolated into territory with no signed contracts (RPs top out near Overall 69 and the best RP deal is $27.5M).
//  - The result is held between the league minimum and MARKET_RATE_MAX_AAV.
export function marketRateAav(curve: MarketCurveInput, overall: number, roleMultiplier = 1): number {
  const x = Math.min(overall, curve.maxOverallInSample);
  const raw = Math.exp(curve.intercept + curve.slope * x) * roleMultiplier;
  return Math.min(MARKET_RATE_MAX_AAV, Math.max(curve.leagueMinimumSalary || 0, raw));
}
