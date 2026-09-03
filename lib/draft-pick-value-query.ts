import { makeSupabaseClient } from "./supabase-client";

// Data layer for /admin/draft-pick-value (2026-09-04) -- kept separate from
// queries.ts, same reasoning as market-rate-query.ts/org-minors-query.ts: a
// self-contained addition, no reason to risk touching a file anything else
// might be mid-editing.
//
// makeSupabaseClient() is deliberately called INSIDE each function below,
// not at module top level -- same fix as market-rate-query.ts/rating-
// validation-query.ts, so a future client-component import of a real value
// from this file can't accidentally ship a server credential-reading call to
// the browser (see HANDOFF.md's "client-bundle-safe" gotcha for the full
// story of how that bug happened the first time).

export interface DraftRoundValue {
  round: number;
  sampleSize: number;
  avgWarPerYear: number;
  medianWarPerYear: number;
  smoothedWarPerYear: number;
  pctReachedMlb: number;
  reachRateSampleSize: number;
  bestPlayerId: number | null;
  bestPlayerName: string;
  bestPlayerWarPerYear: number | null;
  bestPlayerCareerWar: number | null;
}

export interface DraftedPlayerPoint {
  playerId: number;
  playerName: string;
  draftYear: number;
  draftRound: number;
  yearsSinceDraft: number;
  careerWar: number;
  warPerYear: number;
  reachedMlb: boolean;
}

// No FK from either table to players (same sibling-table, join-by-key
// pattern as everywhere else in this schema) -- names fetched separately.
async function namesFor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  playerIds: number[]
): Promise<Map<number, string>> {
  const nameById = new Map<number, string>();
  const CHUNK = 500;
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const chunk = playerIds.slice(i, i + CHUNK);
    const { data, error } = await supabase.from("players").select("id, first_name, last_name").in("id", chunk);
    if (error) throw error;
    for (const p of data as { id: number; first_name: string | null; last_name: string | null }[]) {
      nameById.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(" ") || `Player ${p.id}`);
    }
  }
  return nameById;
}

export async function getDraftPickValueCurve(): Promise<DraftRoundValue[]> {
  const supabase = makeSupabaseClient();
  const { data: latestRow } = await supabase
    .from("draft_pick_value_curve").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  if (!latestRow) return [];
  const refreshRunId = (latestRow as { refresh_run_id: number }).refresh_run_id;
  const { data, error } = await supabase
    .from("draft_pick_value_curve").select("*").eq("refresh_run_id", refreshRunId).order("draft_round", { ascending: true });
  if (error) throw error;
  const rows = data as {
    draft_round: number; sample_size: number; avg_war_per_year: number; median_war_per_year: number;
    smoothed_war_per_year: number; pct_reached_mlb: number; reach_rate_sample_size: number | null;
    best_player_id: number | null; best_player_war_per_year: number | null;
    best_player_career_war: number | null;
  }[];
  const bestIds = rows.map((r) => r.best_player_id).filter((id): id is number => id != null);
  const nameById = await namesFor(supabase, bestIds);
  return rows.map((r) => ({
    round: r.draft_round,
    sampleSize: r.sample_size,
    avgWarPerYear: r.avg_war_per_year,
    medianWarPerYear: r.median_war_per_year,
    smoothedWarPerYear: r.smoothed_war_per_year,
    pctReachedMlb: r.pct_reached_mlb,
    reachRateSampleSize: r.reach_rate_sample_size ?? r.sample_size,
    bestPlayerId: r.best_player_id,
    bestPlayerName: r.best_player_id != null ? (nameById.get(r.best_player_id) ?? `Player ${r.best_player_id}`) : "—",
    bestPlayerWarPerYear: r.best_player_war_per_year,
    bestPlayerCareerWar: r.best_player_career_war,
  }));
}

export async function getDraftPickValuePlayers(): Promise<DraftedPlayerPoint[]> {
  const supabase = makeSupabaseClient();
  const { data: latestRow } = await supabase
    .from("draft_pick_value_players").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  if (!latestRow) return [];
  const refreshRunId = (latestRow as { refresh_run_id: number }).refresh_run_id;

  const PAGE_SIZE = 1000;
  const rows: { player_id: number; draft_year: number; draft_round: number; years_since_draft: number; career_war: number; war_per_year: number; reached_mlb: boolean }[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("draft_pick_value_players").select("player_id, draft_year, draft_round, years_since_draft, career_war, war_per_year, reached_mlb")
      .eq("refresh_run_id", refreshRunId).range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as typeof rows));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const nameById = await namesFor(supabase, rows.map((r) => r.player_id));
  return rows.map((r) => ({
    playerId: r.player_id,
    playerName: nameById.get(r.player_id) ?? `Player ${r.player_id}`,
    draftYear: r.draft_year,
    draftRound: r.draft_round,
    yearsSinceDraft: r.years_since_draft,
    careerWar: r.career_war,
    warPerYear: r.war_per_year,
    reachedMlb: r.reached_mlb,
  }));
}

// Quality-tier labeling for a WAR/year value (Rees's ask: "average, above
// average, great, elite"). Display-only -- the number that actually drives
// the trade-value composite is the continuous smoothedWarPerYear value
// above, never this label.
//
// Deliberately PERCENTILE-based, not fixed absolute WAR cutoffs -- checked
// the real distribution first and it's heavily skewed (median AND 75th
// percentile are both exactly 0: 84% of every real drafted player since
// 2001, given years to develop, never accumulates a single positive career
// MLB WAR; the top 10% clears only ~0.08, top 1% clears ~1.5). Fixed
// "real-world single-season WAR" bands would call almost the entire
// population "replacement level," which is technically true but useless for
// telling picks apart -- the same lesson this codebase already learned the
// hard way on System Rankings' Balance Index grading (see HANDOFF.md:
// switching to absolute thresholds there misgraded a compressed real
// distribution; reverting to percentile-among-population fixed it). Reuses
// the exact same percentile cut points and labels as system-rankings-
// query.ts's percentileToGrade() for one consistent grading language
// sitewide, rather than inventing new wording for this one page.
export function warPerYearTier(percentile: number): string {
  if (percentile >= 90) return "Elite";
  if (percentile >= 70) return "Plus";
  if (percentile >= 30) return "Average";
  if (percentile >= 10) return "Below Average";
  return "Well Below Average";
}

/** 0-100 percentile rank of `value` within `population` (100 = best). */
export function percentileRank(value: number, population: number[]): number {
  if (population.length === 0) return 50;
  const countBelow = population.filter((v) => v < value).length;
  return (countBelow / population.length) * 100;
}
