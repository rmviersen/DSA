import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { fitMultipleLinear } from "../lib/regression.js";
import { persistWeightTuningRun } from "../lib/weight-tuning-persist.js";
import { getLeagueId, leagueSlugFromArgv, getCurrentSeasonYear, getMlbLeagueId, getWeightTuningSeasons } from "../lib/league.js";

// Baserunning analysis (2026-09-01, Rees's ask), same shape as
// compute-hitting-weights.ts: regress a real outcome against the grades
// that plausibly drive it, pooled across every real MLB hitter, diagnostic
// only -- nothing written to the database.
//
// Target is UBR ("Ultimate Base Running" -- StatsPlus/OOTP already
// computes this as a real per-season baserunning-runs stat, confirmed
// populated for every qualifying hitter, averaging ~0 like any runs-above-
// average stat should). UBR is a COUNTING stat like raw WAR was -- it
// accumulates with playing time -- so per Rees's ask it's converted to a
// rate (per 100 PA, same convention as warRate elsewhere) before
// regressing, not used raw.
//
// Predictors are grades, not stats, same reasoning as everywhere else in
// this engine: `speed` (already used in Overall today), plus `run`, `steal`,
// `stlrt` -- three real, fully-populated 20-80 grades that exist in
// player_ratings_snapshots and are currently read by NOTHING in
// lib/rating-engine.ts. Confirmed populated 113,593/113,593 non-pitcher
// rows before building this.
//
// MULTI-SEASON BLEND (2026-09-15, Rees's ask -- see compute-hitting-
// weights.ts's file comment for the full reasoning). Pools the current
// season with the most recent earlier one (lib/league.ts's
// getWeightTuningSeasons), each season's own grades read from its own
// refresh run, weighted by real season progress so a brand-new season
// starts near-irrelevant to the fit and only reaches equal footing with
// the prior full season once it's genuinely complete itself.

const PAGE_SIZE = 1000;
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

const MIN_PA = 100; // same qualifying threshold as compute-hitting-weights.ts / /admin/rating-validation

interface Row { playerId: number; year: number; seasonWeight: number; ubrRate: number; speed: number; run: number; steal: number; stlrt: number; pa: number }

async function main() {
  const supabase = makeSupabaseClient();
  const leagueId = await getLeagueId(supabase, leagueSlugFromArgv());
  const currentYear = await getCurrentSeasonYear(supabase, leagueId);
  const mlbLeagueId = await getMlbLeagueId(supabase, leagueId);

  console.log("Resolving which seasons to pool and how heavily to weight each...");
  const seasons = await getWeightTuningSeasons(supabase, leagueId, currentYear);
  if (seasons.length === 0) {
    console.log(`No ${currentYear} MLB batting stats yet -- likely just the start of a new season. Skipping this regression until real games have been played.`);
    return;
  }
  for (const s of seasons) console.log(`  ${s.year}: refresh_run_id ${s.statsRefreshRunId}, season weight ${s.weight.toFixed(3)}`);

  console.log(`Loading players (for the real-MLB-roster filter: league_id=${mlbLeagueId}, mlb_service_days>0)...`);
  const players = await fetchAll<{ id: number; league_id: number | null; mlb_service_days: number | null }>((from, to) =>
    supabase.from("players").select("id, league_id, mlb_service_days").eq("dsa_league_id", leagueId).range(from, to) as never
  );
  const playerMeta = new Map(players.map((p) => [p.id, p]));
  const isRealMlbPlayer = (playerId: number) => {
    const meta = playerMeta.get(playerId);
    return !!meta && meta.league_id === mlbLeagueId && (meta.mlb_service_days ?? 0) > 0;
  };

  const PITCHER_ROLES = new Set(["SP", "RP", "CL"]);
  const rows: Row[] = [];

  for (const season of seasons) {
    const { year, statsRefreshRunId } = season;
    console.log(`\n--- ${year} (refresh_run_id ${statsRefreshRunId}) ---`);

    console.log(`Loading ${year} MLB batting stats (pa, ubr)...`);
    const battingRows = await fetchAll<{ player_id: number; pa: number | null; ubr: number | null }>((from, to) =>
      supabase.from("player_batting_stats_snapshots").select("player_id, pa, ubr")
        .eq("year", year).eq("level_id", 1).eq("split_id", 1).eq("refresh_run_id", statsRefreshRunId)
        .range(from, to) as never
    );
    const byPlayer = new Map<number, { pa: number; ubr: number }>();
    for (const b of battingRows) {
      if (!isRealMlbPlayer(b.player_id)) continue;
      const cur = byPlayer.get(b.player_id) ?? { pa: 0, ubr: 0 };
      cur.pa += b.pa ?? 0;
      cur.ubr += b.ubr ?? 0; // sum within this one run -- same multi-stint-trade handling as everywhere else
      byPlayer.set(b.player_id, cur);
    }
    console.log(`  ${byPlayer.size} real MLB hitters with any ${year} PA`);

    console.log(`Loading ${year} baserunning-relevant grades (speed, run, steal, stlrt)...`);
    const ratings = await fetchAll<{ player_id: number; speed: number | null; run: number | null; steal: number | null; stlrt: number | null }>((from, to) =>
      supabase.from("player_ratings_snapshots").select("player_id, speed, run, steal, stlrt").eq("refresh_run_id", statsRefreshRunId).range(from, to) as never
    );
    const ratingsByPlayer = new Map(ratings.map((r) => [r.player_id, r]));

    console.log(`Loading ${year} roles (hitters only)...`);
    const computed = await fetchAll<{ player_id: number; role: string | null }>((from, to) =>
      supabase.from("player_computed").select("player_id, role").eq("refresh_run_id", statsRefreshRunId).range(from, to) as never
    );
    const roleByPlayer = new Map(computed.map((c) => [c.player_id, c.role]));

    let seasonRowCount = 0;
    for (const [playerId, b] of byPlayer) {
      if (b.pa < MIN_PA) continue;
      const role = roleByPlayer.get(playerId);
      if (!role || PITCHER_ROLES.has(role)) continue;
      const r = ratingsByPlayer.get(playerId);
      if (!r || r.speed == null || r.run == null || r.steal == null || r.stlrt == null) continue;
      rows.push({ playerId, year, seasonWeight: season.weight, ubrRate: (b.ubr / b.pa) * 100, speed: r.speed, run: r.run, steal: r.steal, stlrt: r.stlrt, pa: b.pa });
      seasonRowCount++;
    }
    console.log(`  ${seasonRowCount} qualifying ${year} hitters (>=${MIN_PA} PA, real grades)`);
  }

  console.log(`\n${rows.length} total qualifying hitter-seasons pooled across ${seasons.length} season(s) for the regression`);
  if (rows.length < 30) throw new Error(`Only ${rows.length} qualifying hitter-seasons -- too small to trust a 4-variable regression. Aborting.`);

  // See compute-hitting-weights.ts's comment on this exact normalization --
  // spreads each season's target weight evenly across its own qualifying
  // rows, reducing to plain OLS when only one season is pooled.
  const rowCountByYear = new Map<number, number>();
  for (const r of rows) rowCountByYear.set(r.year, (rowCountByYear.get(r.year) ?? 0) + 1);
  const weightedRows = rows.map((r) => ({ x: [r.speed, r.run, r.steal, r.stlrt], y: r.ubrRate, weight: r.seasonWeight / rowCountByYear.get(r.year)! }));

  const fit = fitMultipleLinear(weightedRows);
  const labels = ["Speed", "Run (baserunning)", "Steal", "Steal tendency (stlrt)"];

  console.log(`\nRegression: UBR-per-100-PA ~ Speed + Run + Steal + StealTendency  (n=${rows.length}, R²=${fit.rSquared.toFixed(3)})`);
  console.log(`Intercept: ${fit.intercept.toFixed(4)}`);
  for (let i = 0; i < labels.length; i++) {
    console.log(`  ${labels[i].padEnd(24)} raw coef=${fit.coefficients[i].toFixed(5)} UBR-pts/100PA per grade-pt   standardized=${fit.standardizedCoefficients[i].toFixed(3)}`);
  }

  // Implied weight uses RAW coefficients, not standardized ones -- bug fixed
  // 2026-09-02 (see compute-overall-blend-weights.ts's comment for the full
  // story). Low practical impact here -- these four are all individual
  // 20-80 grades -- but fixed for consistency regardless.
  const clamped = fit.coefficients.map((c) => Math.max(0, c));
  const sum = clamped.reduce((s, c) => s + c, 0);
  const normalized = sum > 0 ? clamped.map((c) => c / sum) : clamped.map(() => 0);
  console.log("\nImplied relative weight vector if normalized to sum to 1 (diagnostic only -- nothing written anywhere):");
  for (let i = 0; i < labels.length; i++) {
    console.log(`  ${labels[i].padEnd(24)} implied=${normalized[i].toFixed(3)}`);
  }

  // Single-variable check too, for context -- how much does each grade
  // explain ALONE, same style as the very first rating-validation pass.
  // Weighted the same way as the main fit, for consistency.
  console.log("\nFor context, single-variable weighted R² against UBR-per-100-PA:");
  for (const [key, label] of [["speed", "Speed"], ["run", "Run"], ["steal", "Steal"], ["stlrt", "StlRt"]] as const) {
    const pts = rows.map((r) => ({ x: r[key], y: r.ubrRate, weight: r.seasonWeight / rowCountByYear.get(r.year)! }));
    const totalWeight = pts.reduce((s, p) => s + p.weight, 0);
    const meanY = pts.reduce((s, p) => s + p.weight * p.y, 0) / totalWeight;
    const meanX = pts.reduce((s, p) => s + p.weight * p.x, 0) / totalWeight;
    let num = 0, denX = 0;
    for (const p of pts) { num += p.weight * (p.x - meanX) * (p.y - meanY); denX += p.weight * (p.x - meanX) ** 2; }
    const slope = denX === 0 ? 0 : num / denX;
    const intercept = meanY - slope * meanX;
    let ssRes = 0, ssTot = 0;
    for (const p of pts) { const pred = intercept + slope * p.x; ssRes += p.weight * (p.y - pred) ** 2; ssTot += p.weight * (p.y - meanY) ** 2; }
    const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
    console.log(`  ${label.padEnd(8)} R²=${r2.toFixed(3)} slope=${slope.toFixed(4)}`);
  }

  console.log("\nLoading the live baserunning weight columns (for the current-weight comparison column)...");
  const { data: weightRow } = await supabase.from("rating_weights")
    .select("baserunning_speed_weight, baserunning_run_weight, baserunning_steal_weight, baserunning_stlrt_weight").eq("dsa_league_id", leagueId).eq("is_active", true).maybeSingle();
  const current = weightRow as { baserunning_speed_weight: number; baserunning_run_weight: number; baserunning_steal_weight: number; baserunning_stlrt_weight: number } | null;
  const currentByLabel: Record<string, number | null> = {
    Speed: current?.baserunning_speed_weight ?? null,
    "Run (baserunning)": current?.baserunning_run_weight ?? null,
    Steal: current?.baserunning_steal_weight ?? null,
    "Steal tendency (stlrt)": current?.baserunning_stlrt_weight ?? null,
  };

  const seasonLabel = seasons.length > 1
    ? `${seasons.map((s) => `${s.year} (w=${s.weight.toFixed(2)})`).join(" + ")} blend`
    : `${seasons[0].year}`;
  console.log("\nSaving this run to weight_tuning_runs/weight_tuning_coefficients (for /admin/weight-tuning)...");
  await persistWeightTuningRun(supabase, {
    refreshRunId: seasons[seasons.length - 1].statsRefreshRunId,
    leagueId,
    stream: "baserunning",
    targetMetric: `UBR / 100 PA (${seasonLabel})`,
    rSquared: fit.rSquared,
    sampleSize: rows.length,
    // Stable, explicit keys (2026-09-02 cleanup) matching the
    // baserunning_{key}_weight column suffixes directly -- needed for
    // getLatestWeightTuningSnapshots() to map each row to its live weight
    // column. The prior auto-derived-from-label keys ("run_baserunning",
    // "steal_tendency_stlrt") worked for display but couldn't be mapped
    // back to a column name predictably.
    coefficients: labels.map((label, i) => ({
      key: ["speed", "run", "steal", "stlrt"][i],
      label,
      rawCoefficient: fit.coefficients[i],
      standardizedCoefficient: fit.standardizedCoefficients[i],
      impliedWeight: normalized[i],
      currentWeight: currentByLabel[label],
    })),
  });

  console.log("\nDone -- rating_weights itself is untouched; this only saved the diagnostic history.");
}

main().catch((err) => {
  console.error("compute-baserunning-weights failed:", err);
  process.exit(1);
});
