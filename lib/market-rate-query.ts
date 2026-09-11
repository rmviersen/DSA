import { makeSupabaseClient } from "./supabase-client";
import { fitLine } from "./regression";

// Data layer for /admin/market-rates (2026-08-31) -- kept separate from
// queries.ts on purpose, same reasoning as org-minors-query.ts/admin-
// queries.ts: a self-contained addition, no reason to risk touching a file
// anything else might be mid-editing.
//
// makeSupabaseClient() is deliberately called INSIDE each function below,
// not at module top level (2026-08-31 fix, after the identical top-level
// pattern in rating-validation-query.ts crashed the browser the moment a
// client component imported a real runtime value -- not just a type -- from
// that file, pulling the whole module, including the top-level Supabase
// client creation, into the client bundle). This file only exports types
// today, so MarketRateExplorer.tsx's `import type` currently erases the
// import safely either way -- but doing it per-function here too means a
// future edit that exports a real constant from this file (as happened in
// rating-validation-query.ts) can't reintroduce that exact crash.

export interface MarketRateCurve {
  playerType: "hitter" | "pitcher";
  intercept: number;
  slope: number;
  rSquared: number;
  residualStdDev: number;
  sampleSize: number;
  minOverallInSample: number;
  maxOverallInSample: number;
  leagueMinimumSalary: number;
  refreshRunId: number;
  computedAt: string;
}

export interface RoleMultiplier {
  role: string;
  rawMultiplier: number;
  shrunkMultiplier: number;
  finalMultiplier: number;
  dhCapped: boolean;
  sampleSize: number;
  avgOverallInSample: number;
  avgActualAav: number;
  avgCurvePredictedAav: number;
}

export interface TrainingContractPoint {
  playerId: number;
  playerName: string;
  overall: number;
  role: string;
  playerType: "hitter" | "pitcher";
  aav: number;
  seasonYear: number;
  years: number;
  // When scan-market-contracts.ts first recorded this contract as clean
  // (2026-09-07, added for the "recent signings" view) -- distinct from
  // seasonYear (which season the contract's money applies to): a contract
  // can be OBSERVED today but its season_year is next year's, which is
  // exactly the free-agency-offseason case this field exists to surface.
  firstObservedAt: string;
}

export async function getLatestMarketRateCurves(leagueId: number): Promise<MarketRateCurve[]> {
  const supabase = makeSupabaseClient();
  const { data: latestRow } = await supabase
    .from("market_rate_curves").select("refresh_run_id").eq("dsa_league_id", leagueId).order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  if (!latestRow) return [];
  const refreshRunId = (latestRow as { refresh_run_id: number }).refresh_run_id;
  const { data, error } = await supabase.from("market_rate_curves").select("*").eq("refresh_run_id", refreshRunId);
  if (error) throw error;
  return (data as never[]).map((r) => {
    const row = r as {
      player_type: string; intercept: number; slope: number; r_squared: number; residual_std_dev: number;
      sample_size: number; min_overall_in_sample: number; max_overall_in_sample: number;
      league_minimum_salary: number; refresh_run_id: number; computed_at: string;
    };
    return {
      playerType: row.player_type as "hitter" | "pitcher",
      intercept: row.intercept, slope: row.slope, rSquared: row.r_squared, residualStdDev: row.residual_std_dev,
      sampleSize: row.sample_size, minOverallInSample: row.min_overall_in_sample, maxOverallInSample: row.max_overall_in_sample,
      leagueMinimumSalary: row.league_minimum_salary, refreshRunId: row.refresh_run_id, computedAt: row.computed_at,
    };
  });
}

export async function getLatestRoleMultipliers(leagueId: number): Promise<RoleMultiplier[]> {
  const supabase = makeSupabaseClient();
  const { data: latestRow } = await supabase
    .from("market_rate_role_multipliers").select("refresh_run_id").eq("dsa_league_id", leagueId).order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  if (!latestRow) return [];
  const refreshRunId = (latestRow as { refresh_run_id: number }).refresh_run_id;
  const { data, error } = await supabase.from("market_rate_role_multipliers").select("*").eq("refresh_run_id", refreshRunId);
  if (error) throw error;
  return (data as never[])
    .map((r) => {
      const row = r as {
        role: string; raw_multiplier: number; shrunk_multiplier: number; final_multiplier: number; dh_capped: boolean;
        sample_size: number; avg_overall_in_sample: number; avg_actual_aav: number; avg_curve_predicted_aav: number;
      };
      return {
        role: row.role, rawMultiplier: row.raw_multiplier, shrunkMultiplier: row.shrunk_multiplier,
        finalMultiplier: row.final_multiplier, dhCapped: row.dh_capped, sampleSize: row.sample_size,
        avgOverallInSample: row.avg_overall_in_sample, avgActualAav: row.avg_actual_aav, avgCurvePredictedAav: row.avg_curve_predicted_aav,
      };
    })
    .sort((a, b) => b.finalMultiplier - a.finalMultiplier);
}

// No FK between market_rate_training_contracts and players (gotcha 1 --
// sibling tables joined by key, not a relationship Supabase can embed), so
// names are fetched separately and joined in JS.
//
// Re-joins to CURRENT player_computed.overall (2026-09-04 fix, same reason
// as compute-market-rates.ts's own fix) instead of trusting the stored
// snapshot -- that value freezes at whenever a contract was first scanned
// clean and goes stale the moment the rating engine's calibration changes
// (confirmed real after the Sept 3-4 rescale: the same players' stored
// Overall reads ~15-20 points higher than their current one). Without this,
// the scatter's dots would sit at the OLD scale while the curve line drawn
// through them was fit on the NEW one -- a real, visible mismatch, even
// though the curve itself (fit inside compute-market-rates.ts, not here)
// was already correct.
export async function getTrainingContracts(leagueId: number): Promise<TrainingContractPoint[]> {
  const supabase = makeSupabaseClient();
  const { data, error } = await supabase
    .from("market_rate_training_contracts")
    .select("player_id, overall, role, player_type, aav, season_year, years, first_observed_at")
    .eq("dsa_league_id", leagueId);
  if (error) throw error;
  const rows = data as { player_id: number; overall: number; role: string; player_type: string; aav: number; season_year: number; years: number; first_observed_at: string }[];
  const playerIds = [...new Set(rows.map((r) => r.player_id))];
  const nameById = new Map<number, string>();
  const currentOverallById = new Map<number, number>();
  const { data: latestRun } = await supabase
    .from("player_computed").select("refresh_run_id").eq("dsa_league_id", leagueId).order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  const refreshRunId = (latestRun as { refresh_run_id: number } | null)?.refresh_run_id ?? null;
  const CHUNK = 500;
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const chunk = playerIds.slice(i, i + CHUNK);
    const { data: playerRows, error: playerErr } = await supabase.from("players").select("id, first_name, last_name").eq("dsa_league_id", leagueId).in("id", chunk);
    if (playerErr) throw playerErr;
    for (const p of playerRows as { id: number; first_name: string | null; last_name: string | null }[]) {
      nameById.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(" ") || `Player ${p.id}`);
    }
    if (refreshRunId !== null) {
      const { data: computedRows, error: computedErr } = await supabase
        .from("player_computed").select("player_id, overall").eq("refresh_run_id", refreshRunId).in("player_id", chunk);
      if (computedErr) throw computedErr;
      for (const c of computedRows as { player_id: number; overall: number }[]) currentOverallById.set(c.player_id, c.overall);
    }
  }
  return rows
    .filter((r) => currentOverallById.has(r.player_id))
    .map((r) => ({
      playerId: r.player_id,
      playerName: nameById.get(r.player_id) ?? `Player ${r.player_id}`,
      overall: currentOverallById.get(r.player_id)!, role: r.role, playerType: r.player_type as "hitter" | "pitcher",
      aav: r.aav, seasonYear: r.season_year, years: r.years, firstObservedAt: r.first_observed_at,
    }));
}

export interface OffseasonCurveFit {
  intercept: number;
  slope: number;
  rSquared: number;
  sampleSize: number;
}
export interface OffseasonImpact {
  playerType: "hitter" | "pitcher";
  // Fit against everything EXCEPT this offseason's new signings (season_year
  // < currentSeasonYear) -- null if too few contracts existed before this
  // offseason to fit a meaningful line (fitLine still runs, but n<10 isn't
  // trustworthy -- same floor compute-market-rates.ts itself enforces).
  before: OffseasonCurveFit | null;
  // Fit against the FULL current pool, including this offseason's new
  // contracts -- identical inputs/method to the live market_rate_curves row
  // for this type, just computed here on demand rather than read back from
  // the DB, so this comparison stays honest even if the live curve hasn't
  // been refit yet since the newest signings came in.
  after: OffseasonCurveFit;
  newContractCount: number; // how many contracts are season_year === currentSeasonYear
}
export interface OffseasonImpactResult {
  currentSeasonYear: number;
  curves: OffseasonImpact[];
}

// "How has this offseason's free agency actually moved the market curve" --
// Rees's ask (2026-09-07), now that real free-agent contracts are signing.
// Deliberately NOT a comparison against the last time compute-market-rates.ts
// happened to run (2026-09-04 as of this writing) -- that would conflate
// this offseason's new contracts with whatever ELSE changed between then and
// now (a rating-weight retune, a calibration change, anything). Isolates
// just the contract-count effect instead: fits the SAME regression twice,
// against the SAME current Overall scale, the only difference being whether
// this offseason's own new signings (season_year === the max season_year on
// file) are included in the training pool or not. "currentSeasonYear" is
// derived from the data itself (the max season_year present), not assumed --
// so this keeps meaning "this offseason" correctly as seasons roll forward.
export async function getOffseasonMarketImpact(leagueId: number): Promise<OffseasonImpactResult> {
  const supabase = makeSupabaseClient();
  const { data, error } = await supabase
    .from("market_rate_training_contracts")
    .select("player_id, role, player_type, aav, season_year")
    .eq("dsa_league_id", leagueId);
  if (error) throw error;
  const rows = data as { player_id: number; role: string; player_type: "hitter" | "pitcher"; aav: number; season_year: number }[];
  if (rows.length === 0) return { currentSeasonYear: 0, curves: [] };

  const currentSeasonYear = Math.max(...rows.map((r) => r.season_year));

  const playerIds = [...new Set(rows.map((r) => r.player_id))];
  const currentOverallById = new Map<number, number>();
  const { data: latestRun } = await supabase
    .from("player_computed").select("refresh_run_id").eq("dsa_league_id", leagueId).order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  const refreshRunId = (latestRun as { refresh_run_id: number } | null)?.refresh_run_id ?? null;
  if (refreshRunId !== null) {
    const CHUNK = 500;
    for (let i = 0; i < playerIds.length; i += CHUNK) {
      const chunk = playerIds.slice(i, i + CHUNK);
      const { data: computedRows, error: computedErr } = await supabase
        .from("player_computed").select("player_id, overall").eq("refresh_run_id", refreshRunId).in("player_id", chunk);
      if (computedErr) throw computedErr;
      for (const c of computedRows as { player_id: number; overall: number }[]) currentOverallById.set(c.player_id, c.overall);
    }
  }

  const clean = rows
    .filter((r) => currentOverallById.has(r.player_id))
    .map((r) => ({ overall: currentOverallById.get(r.player_id)!, role: r.role, playerType: r.player_type, aav: r.aav, seasonYear: r.season_year }));

  const MIN_SAMPLE = 10; // same floor compute-market-rates.ts enforces before trusting a fit
  function fit(points: { overall: number; aav: number }[]): OffseasonCurveFit | null {
    if (points.length < MIN_SAMPLE) return null;
    const { intercept, slope, rSquared } = fitLine(points.map((p) => ({ x: p.overall, y: Math.log(p.aav) })));
    return { intercept, slope, rSquared, sampleSize: points.length };
  }

  const curves: OffseasonImpact[] = (["hitter", "pitcher"] as const)
    .map((playerType) => {
      const group = clean.filter((c) => c.playerType === playerType);
      const before = group.filter((c) => c.seasonYear < currentSeasonYear);
      const after = fit(group); // full current pool -- same rows the live curve is fit from
      if (!after) return null; // too few total contracts of this type to fit at all -- shouldn't happen in practice, but never fabricate a fit
      return {
        playerType,
        before: fit(before),
        after,
        newContractCount: group.filter((c) => c.seasonYear === currentSeasonYear).length,
      };
    })
    .filter((c): c is OffseasonImpact => c !== null);

  return { currentSeasonYear, curves };
}
