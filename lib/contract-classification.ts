// Shared "what counts as a clean, open-market contract" logic (2026-08-31).
// Used by both scripts/scan-market-contracts.ts (accumulates distinct clean
// contracts over time) and scripts/compute-market-rates.ts (used to derive
// this inline before the accumulation build -- now both scripts import from
// here so the definition of "clean" can't silently drift between them).
//
// Full reasoning lives in HANDOFF.md's transaction-analysis section; short
// version: OOTP (like real MLB) pays players on a fixed, escalating scale by
// service time completely independent of talent -- confirmed in this
// league's own data: pre-arb averages ~$122K, arbitration-eligible ~$2.6M,
// free-agent-eligible ~$9.3M. A contract only counts as a real market-rate
// signal if it clears ALL of: meaningfully above league minimum (excludes
// rule-driven rookie-scale deals regardless of service time), 6+ years of
// MLB service (true free-agent eligibility -- confirmed 85% of 3-5-year
// "arbitration-eligible" contracts are exactly 1 year, matching how real
// arbitration works), and not also present in contract_extension_snapshots
// (excludes a small number of players whose current deal actually
// originated as a below-market extension signed before free agency).

export const LEAGUE_MIN_BUFFER = 1.05;
export const MIN_FREE_AGENT_SERVICE_YEARS = 6;

// PITCHER_ROLES: everything else is a "hitter" for player_type purposes.
export const PITCHER_ROLES = new Set(["SP", "RP"]);
export type PlayerType = "hitter" | "pitcher";
export function playerTypeForRole(role: string): PlayerType {
  return PITCHER_ROLES.has(role) ? "pitcher" : "hitter";
}

export interface ContractSalaryFields {
  years: number | null;
  salary0: number | null; salary1: number | null; salary2: number | null; salary3: number | null; salary4: number | null;
  salary5: number | null; salary6: number | null; salary7: number | null; salary8: number | null; salary9: number | null;
  salary10: number | null; salary11: number | null; salary12: number | null; salary13: number | null; salary14: number | null;
}

// A contract's AAV (average annual value) rather than its year-1 salary --
// avoids a back-/front-loaded deal skewing the curve. `years<=1` has no real
// multi-year structure to average, so salary0 IS the AAV in that case.
export function computeAAV(row: ContractSalaryFields): number | null {
  const years = row.years ?? 0;
  if (years <= 1) return row.salary0 ?? null;
  const salaryFields = [
    row.salary0, row.salary1, row.salary2, row.salary3, row.salary4,
    row.salary5, row.salary6, row.salary7, row.salary8, row.salary9,
    row.salary10, row.salary11, row.salary12, row.salary13, row.salary14,
  ];
  const used = salaryFields.slice(0, Math.min(years, 15)).filter((v): v is number => typeof v === "number");
  if (used.length === 0) return row.salary0 ?? null;
  return used.reduce((a, b) => a + b, 0) / used.length;
}

export function mode(values: number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) if (c > bestCount) { best = v; bestCount = c; }
  return best;
}

// League minimum salary, computed FRESH from the current data (the mode of
// salary0 among clearly pre-arb players) rather than hardcoded -- this rises
// over time as seasons pass.
export function computeLeagueMinimumSalary(lowServiceSalaries: number[]): number {
  return mode(lowServiceSalaries) ?? 0;
}

export function isCleanFreeAgentContract(opts: {
  isMajor: boolean | null;
  retired: boolean | null;
  mlbServiceYears: number | null;
  salary0: number | null;
  leagueMinimum: number;
  hasRealExtension: boolean;
}): boolean {
  if (!opts.isMajor) return false;
  if (opts.retired) return false;
  if ((opts.mlbServiceYears ?? 0) < MIN_FREE_AGENT_SERVICE_YEARS) return false;
  if ((opts.salary0 ?? 0) <= opts.leagueMinimum * LEAGUE_MIN_BUFFER) return false;
  if (opts.hasRealExtension) return false;
  return true;
}
