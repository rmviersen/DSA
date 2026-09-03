import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { isotonicRegressionNonIncreasing } from "../lib/regression.js";

// Trade-value engine, Phase A step 2 (2026-09-04) -- draft-pick value curve.
//
// First attempt at this looked at draft_picks and found it only ever holds
// the CURRENT draft class (StatsPlus's /draftv2/ endpoint has no historical
// archive -- confirmed by probing it with different `lid` values and getting
// byte-identical results back every time). Rees caught the real fix:
// players.draft_year/draft_round are permanent bio fields present on every
// player ever drafted, all the way back to 2001 (30 real classes, ~800
// players each) -- a real, rich source this session had overlooked.
//
// Outcome metric (Rees's spec): real MLB (level_id=1, split_id=1) career WAR
// accumulated since being drafted, divided by years since draft -- so a
// recently-drafted player who simply hasn't had time yet isn't penalized
// against one who's had two decades to accumulate value. Only draft classes
// with >= MIN_YEARS_SINCE_DRAFT years on the books count (2001-2028 as of
// this build); 2029-2031 haven't had time to show real outcomes.
//
// Quality-tier bands (avg WAR/year) are the standard sabermetric convention
// Rees pointed at ("average, above average, great, elite"), used only for
// display -- the number that actually feeds the trade-value composite is
// the continuous smoothed_war_per_year curve, not the tier label.

const PAGE_SIZE = 1000;
const MIN_YEARS_SINCE_DRAFT = 3;
const REAL_MLB_LEVEL_ID = 1;
const OVERALL_SPLIT_ID = 1;

async function fetchAll<T>(query: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

async function upsertBatched<T extends Record<string, unknown>>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  table: string,
  rows: T[],
  onConflict: string
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    let ok = false, lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
      const { error } = await supabase.from(table).upsert(batch as never[], { onConflict });
      if (!error) { ok = true; break; }
      lastErr = error;
      console.warn(`${table} upsert (rows ${i}-${i + batch.length}) failed on attempt ${attempt}/${MAX_ATTEMPTS}: ${error.message}`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    if (!ok) throw new Error(`${table} upsert failed at row ${i}: ${lastErr}`);
  }
}

/** Latest refresh_run_id that has real-MLB rows for this year, in the given
 * stats table. For a fully-completed historical season this is simply its
 * one and only run (confirmed 2026-09-04: 2001-2028 each have exactly one
 * refresh_run touching them); for a still-accumulating season (currently
 * 2029-2031) this picks the most recent run, avoiding the cumulative-per-
 * refresh double-counting gotcha documented throughout this codebase.
 * Returns null if the year has no rows at all in this table. */
async function latestRunForYear(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  table: "player_batting_stats_snapshots" | "player_pitching_stats_snapshots",
  year: number
): Promise<number | null> {
  const { data } = await supabase
    .from(table).select("refresh_run_id")
    .eq("year", year).eq("level_id", REAL_MLB_LEVEL_ID).eq("split_id", OVERALL_SPLIT_ID)
    .order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  return (data as { refresh_run_id: number } | null)?.refresh_run_id ?? null;
}

function quantileMedian(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main() {
  const supabase = makeSupabaseClient();

  console.log("Finding latest refresh run and current in-game year...");
  const { data: latestRunRow, error: runErr } = await supabase
    .from("refresh_runs").select("id, game_date").order("id", { ascending: false }).limit(1).single();
  if (runErr || !latestRunRow) throw new Error(`No refresh_runs found: ${runErr?.message}`);
  const refreshRunId = (latestRunRow as { id: number; game_date: string | null }).id;
  const gameDate = (latestRunRow as { id: number; game_date: string | null }).game_date;
  if (!gameDate) throw new Error("Latest refresh_runs row has no game_date -- can't determine the current in-game year.");
  const currentYear = Number(gameDate.slice(0, 4));
  console.log(`  refresh_run_id ${refreshRunId}, current in-game year ${currentYear}`);

  console.log("Loading drafted players (draft_year 2001+ with a real round)...");
  const allDrafted = await fetchAll<{ id: number; draft_year: number; draft_round: number }>((from, to) =>
    supabase.from("players").select("id, draft_year, draft_round")
      .gte("draft_year", 2001).not("draft_round", "is", null).order("id").range(from, to) as never
  );
  const eligible = allDrafted.filter((p) => currentYear - p.draft_year >= MIN_YEARS_SINCE_DRAFT);
  console.log(`  ${allDrafted.length} total drafted players since 2001, ${eligible.length} with >= ${MIN_YEARS_SINCE_DRAFT} years since draft`);

  const oldestDraftYear = Math.min(...eligible.map((p) => p.draft_year));
  const newestEligibleDraftYear = currentYear - MIN_YEARS_SINCE_DRAFT;
  console.log(`  Draft classes ${oldestDraftYear}-${newestEligibleDraftYear} qualify`);

  // Every eligible player starts at 0 career WAR -- a real bust (drafted,
  // never accumulated real MLB value) is a real, meaningful outcome and
  // belongs in the round average at 0, not excluded for lack of stat rows.
  const careerWarByPlayer = new Map<number, number>(eligible.map((p) => [p.id, 0]));

  // A career can span from its draft year all the way to the current year --
  // sweep every year in that whole window once, not per-player, since the
  // latest-run-per-year lookup is the same for every player in a given year.
  const sweepFromYear = oldestDraftYear;
  console.log(`Sweeping real MLB batting/pitching WAR, ${sweepFromYear}-${currentYear}...`);
  const eligibleIds = new Set(eligible.map((p) => p.id));
  for (let year = sweepFromYear; year <= currentYear; year++) {
    const battingRun = await latestRunForYear(supabase, "player_batting_stats_snapshots", year);
    const pitchingRun = await latestRunForYear(supabase, "player_pitching_stats_snapshots", year);
    if (battingRun != null) {
      const rows = await fetchAll<{ player_id: number; war: number | null }>((from, to) =>
        supabase.from("player_batting_stats_snapshots").select("player_id, war")
          .eq("year", year).eq("level_id", REAL_MLB_LEVEL_ID).eq("split_id", OVERALL_SPLIT_ID).eq("refresh_run_id", battingRun)
          .range(from, to) as never
      );
      for (const r of rows) {
        if (!eligibleIds.has(r.player_id)) continue;
        careerWarByPlayer.set(r.player_id, (careerWarByPlayer.get(r.player_id) ?? 0) + (r.war ?? 0));
      }
    }
    if (pitchingRun != null) {
      const rows = await fetchAll<{ player_id: number; war: number | null }>((from, to) =>
        supabase.from("player_pitching_stats_snapshots").select("player_id, war")
          .eq("year", year).eq("level_id", REAL_MLB_LEVEL_ID).eq("split_id", OVERALL_SPLIT_ID).eq("refresh_run_id", pitchingRun)
          .range(from, to) as never
      );
      for (const r of rows) {
        if (!eligibleIds.has(r.player_id)) continue;
        careerWarByPlayer.set(r.player_id, (careerWarByPlayer.get(r.player_id) ?? 0) + (r.war ?? 0));
      }
    }
    if (year % 5 === 0 || year === currentYear) console.log(`  ...through ${year}`);
  }

  console.log("Computing WAR/year per player and grouping by round...");
  const playerRows = eligible.map((p) => {
    const careerWar = careerWarByPlayer.get(p.id) ?? 0;
    const yearsSinceDraft = Math.max(1, currentYear - p.draft_year);
    return {
      refresh_run_id: refreshRunId,
      player_id: p.id,
      draft_year: p.draft_year,
      draft_round: p.draft_round,
      years_since_draft: yearsSinceDraft,
      career_war: careerWar,
      war_per_year: careerWar / yearsSinceDraft,
    };
  });

  const byRound = new Map<number, typeof playerRows>();
  for (const r of playerRows) {
    if (!byRound.has(r.draft_round)) byRound.set(r.draft_round, []);
    byRound.get(r.draft_round)!.push(r);
  }
  const rounds = [...byRound.keys()].sort((a, b) => a - b);

  const roundSummaries = rounds.map((round) => {
    const rows = byRound.get(round)!;
    const values = rows.map((r) => r.war_per_year);
    const sorted = [...values].sort((a, b) => a - b);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const median = quantileMedian(sorted);
    const best = rows.reduce((a, b) => (b.war_per_year > a.war_per_year ? b : a));
    return { round, n: rows.length, avg, median, best };
  });

  // Isotonic-smooth the round averages so a later round can never show a
  // HIGHER expected value than an earlier one, even where raw sample noise
  // briefly suggests it -- same technique already proven out on the
  // fielding-role-weight work (lib/regression.ts). This smoothed curve, not
  // the raw average, is what the trade-value composite should read.
  const smoothed = isotonicRegressionNonIncreasing(
    roundSummaries.map((r) => r.avg),
    roundSummaries.map((r) => r.n)
  );

  console.log("Round  N     Avg WAR/yr  Median  Smoothed  Best player (id / WAR-per-yr)");
  roundSummaries.forEach((r, i) => {
    console.log(
      `${String(r.round).padStart(5)}  ${String(r.n).padStart(4)}  ${r.avg.toFixed(3).padStart(9)}  ${r.median.toFixed(3).padStart(6)}  ${smoothed[i].toFixed(3).padStart(8)}  #${r.best.player_id} (${r.best.war_per_year.toFixed(2)})`
    );
  });

  console.log("Writing draft_pick_value_curve...");
  await upsertBatched(
    supabase,
    "draft_pick_value_curve",
    roundSummaries.map((r, i) => ({
      refresh_run_id: refreshRunId,
      draft_round: r.round,
      sample_size: r.n,
      avg_war_per_year: r.avg,
      median_war_per_year: r.median,
      smoothed_war_per_year: smoothed[i],
      best_player_id: r.best.player_id,
      best_player_war_per_year: r.best.war_per_year,
    })),
    "refresh_run_id,draft_round"
  );

  console.log(`Writing draft_pick_value_players (${playerRows.length} rows)...`);
  await upsertBatched(supabase, "draft_pick_value_players", playerRows, "refresh_run_id,player_id");

  console.log("Done.");
}

main().catch((err) => {
  console.error("compute-draft-pick-value failed:", err);
  process.exit(1);
});
