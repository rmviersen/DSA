import { makeSupabaseClient } from "./supabase-client";

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
}

export async function getLatestMarketRateCurves(): Promise<MarketRateCurve[]> {
  const supabase = makeSupabaseClient();
  const { data: latestRow } = await supabase
    .from("market_rate_curves").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
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

export async function getLatestRoleMultipliers(): Promise<RoleMultiplier[]> {
  const supabase = makeSupabaseClient();
  const { data: latestRow } = await supabase
    .from("market_rate_role_multipliers").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
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
export async function getTrainingContracts(): Promise<TrainingContractPoint[]> {
  const supabase = makeSupabaseClient();
  const { data, error } = await supabase
    .from("market_rate_training_contracts")
    .select("player_id, overall, role, player_type, aav, season_year, years");
  if (error) throw error;
  const rows = data as { player_id: number; overall: number; role: string; player_type: string; aav: number; season_year: number; years: number }[];
  const playerIds = [...new Set(rows.map((r) => r.player_id))];
  const nameById = new Map<number, string>();
  const CHUNK = 500;
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const chunk = playerIds.slice(i, i + CHUNK);
    const { data: playerRows, error: playerErr } = await supabase.from("players").select("id, first_name, last_name").in("id", chunk);
    if (playerErr) throw playerErr;
    for (const p of playerRows as { id: number; first_name: string | null; last_name: string | null }[]) {
      nameById.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(" ") || `Player ${p.id}`);
    }
  }
  return rows.map((r) => ({
    playerId: r.player_id,
    playerName: nameById.get(r.player_id) ?? `Player ${r.player_id}`,
    overall: r.overall, role: r.role, playerType: r.player_type as "hitter" | "pitcher",
    aav: r.aav, seasonYear: r.season_year, years: r.years,
  }));
}
