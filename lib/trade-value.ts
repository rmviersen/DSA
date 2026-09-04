// Trade-value engine (2026-09-04, Rees's ask -- see HANDOFF.md's
// transaction-analysis section for the full plan: talent value + contract
// surplus + control-years multiplier + draft-pick value curve, combined into
// one weighted composite). This module holds pure, side-effect-free
// functions for the composite -- a script will orchestrate these against
// real data later, the same way lib/rating-engine.ts's pure functions get
// orchestrated by scripts/compute-ratings.ts. Talent value (existing
// Overall/Potential/role/ETA) and contract surplus (lib/contract-
// classification.ts + market_rate_curves) already exist; this file starts
// the two still-missing pieces.
//
// Phase A, step 1: control-years multiplier.
//
// Real insight, found and verified against real data 2026-09-04: a player's
// CONTRACT length is not the same as how many years his team actually
// controls him. OOTP (like real MLB) locks a player to his team for
// MIN_FREE_AGENT_SERVICE_YEARS (6) years of service time regardless of
// contract length -- arbitration-eligible players get renewed one year at a
// time (see lib/contract-classification.ts's own note on this), so a
// player's `contracts` row always shows just 1 year remaining even when the
// team really controls him for several more years before free agency. Real
// example: player #26339 has 1 year of MLB service and a 1-year contract --
// reading the contract alone he looks like a pure rental, but he actually
// has 5 more years before free agency and is a real long-term asset.
//
// Fix: years_of_control = max(contract years remaining, years until free
// agency via service time). Verified across the real active roster (1,102
// players, league_id=200 + mlb_service_days>0) before shipping -- produces a
// real, sensible spread (240 true rentals, 81 with a guaranteed deal that
// extends past the free-agency threshold, roughly-even counts of 2/3/4/5 in
// between), not a degenerate all-one-value result.

import { MIN_FREE_AGENT_SERVICE_YEARS } from "./contract-classification";

export interface ControlYearsInput {
  contractYears: number | null; // contracts.years
  contractCurrentYear: number | null; // contracts.current_year
  mlbServiceYears: number | null; // players.mlb_service_years
}

/**
 * How many more years, including this one, the player's CURRENT team can
 * count on having him: the max of his guaranteed contract's remaining years
 * and however many years remain before he reaches free agency via service
 * time. Floors at 1 -- even a free-agent-eligible player on a fresh 1-year
 * deal still represents "this year" of control.
 *
 * A player with no contract row at all (contractYears/contractCurrentYear
 * both null) is treated as having 0 contract-years-left, so the result falls
 * back entirely to the service-time side -- correct for an amateur/
 * international signee who hasn't signed a real MLB deal yet.
 */
export function yearsOfControl(input: ControlYearsInput): number {
  const contractYearsLeft = Math.max(0, (input.contractYears ?? 0) - (input.contractCurrentYear ?? 0));
  const yearsUntilFreeAgency = Math.max(0, MIN_FREE_AGENT_SERVICE_YEARS - (input.mlbServiceYears ?? 0));
  return Math.max(1, contractYearsLeft, yearsUntilFreeAgency);
}

/**
 * Scales a player's per-year contract-surplus value by how many controlled
 * years he represents, discounting years further out by `decayRate` per
 * additional year (a year several seasons from now carries more real
 * uncertainty -- injury, aging, regression -- than next year does).
 *
 * multiplier(1) = 1 exactly (a pure rental is the baseline, no bonus).
 * multiplier(n) = 1 + sum_{i=1}^{n-1} decayRate^i for n > 1.
 *
 * `decayRate` comes from trade_value_weights.control_years_decay_rate, not a
 * hardcoded constant -- chosen 0.75 ("moderate") 2026-09-04 as a reasoned
 * starting point. There's no real internal outcome data (like realized
 * trade-return performance) to fit this against the way the rating engine's
 * own weights were fit against real WAR, so this is a judgment call, same
 * category as rating_weights.relief_value_multiplier.
 */
export function controlYearsMultiplier(yearsOfControlValue: number, decayRate: number): number {
  let multiplier = 1;
  let discount = 1;
  for (let i = 1; i < yearsOfControlValue; i++) {
    discount *= decayRate;
    multiplier += discount;
  }
  return multiplier;
}
