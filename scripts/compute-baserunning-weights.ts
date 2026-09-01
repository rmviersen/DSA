import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { fitMultipleLinear } from "../lib/regression.js";
import { persistWeightTuningRun } from "../lib/weight-tuning-persist.js";

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

async function main() {
  const supabase = makeSupabaseClient();

  console.log("Finding latest refresh run with player_computed (for grades/role)...");
  const { data: computedRunRow } = await supabase
    .from("player_computed").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  if (!computedRunRow) throw new Error("No player_computed rows found.");
  const computedRunId = (computedRunRow as { refresh_run_id: number }).refresh_run_id;

  console.log("Finding latest refresh run with 2031 MLB batting stats...");
  const { data: statsRunRow } = await supabase
    .from("player_batting_stats_snapshots").select("refresh_run_id").eq("year", 2031).eq("level_id", 1).eq("split_id", 1)
    .order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  if (!statsRunRow) throw new Error("No 2031 MLB batting stats found.");
  const statsRunId = (statsRunRow as { refresh_run_id: number }).refresh_run_id;

  console.log("Loading players (for the real-MLB-roster filter: league_id=200, mlb_service_days>0)...");
  const players = await fetchAll<{ id: number; league_id: number | null; mlb_service_days: number | null }>((from, to) =>
    supabase.from("players").select("id, league_id, mlb_service_days").range(from, to) as never
  );
  const playerMeta = new Map(players.map((p) => [p.id, p]));
  const isRealMlbPlayer = (playerId: number) => {
    const meta = playerMeta.get(playerId);
    return !!meta && meta.league_id === 200 && (meta.mlb_service_days ?? 0) > 0;
  };

  console.log("Loading 2031 MLB batting stats (pa, ubr)...");
  const battingRows = await fetchAll<{ player_id: number; pa: number | null; ubr: number | null }>((from, to) =>
    supabase.from("player_batting_stats_snapshots").select("player_id, pa, ubr")
      .eq("year", 2031).eq("level_id", 1).eq("split_id", 1).eq("refresh_run_id", statsRunId)
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
  console.log(`  ${byPlayer.size} real MLB hitters with any 2031 PA`);

  console.log("Loading baserunning-relevant grades (speed, run, steal, stlrt)...");
  const ratings = await fetchAll<{ player_id: number; speed: number | null; run: number | null; steal: number | null; stlrt: number | null }>((from, to) =>
    supabase.from("player_ratings_snapshots").select("player_id, speed, run, steal, stlrt").eq("refresh_run_id", computedRunId).range(from, to) as never
  );
  const ratingsByPlayer = new Map(ratings.map((r) => [r.player_id, r]));

  console.log("Loading roles (hitters only)...");
  const computed = await fetchAll<{ player_id: number; role: string | null }>((from, to) =>
    supabase.from("player_computed").select("player_id, role").eq("refresh_run_id", computedRunId).range(from, to) as never
  );
  const roleByPlayer = new Map(computed.map((c) => [c.player_id, c.role]));
  const PITCHER_ROLES = new Set(["SP", "RP", "CL"]);

  interface Row { playerId: number; ubrRate: number; speed: number; run: number; steal: number; stlrt: number; pa: number }
  const rows: Row[] = [];
  for (const [playerId, b] of byPlayer) {
    if (b.pa < MIN_PA) continue;
    const role = roleByPlayer.get(playerId);
    if (!role || PITCHER_ROLES.has(role)) continue;
    const r = ratingsByPlayer.get(playerId);
    if (!r || r.speed == null || r.run == null || r.steal == null || r.stlrt == null) continue;
    rows.push({ playerId, ubrRate: (b.ubr / b.pa) * 100, speed: r.speed, run: r.run, steal: r.steal, stlrt: r.stlrt, pa: b.pa });
  }
  console.log(`  ${rows.length} qualifying hitters (>=${MIN_PA} PA, real grades) for the regression`);
  if (rows.length < 30) throw new Error(`Only ${rows.length} qualifying hitters -- too small to trust a 4-variable regression. Aborting.`);

  const fit = fitMultipleLinear(rows.map((r) => ({ x: [r.speed, r.run, r.steal, r.stlrt], y: r.ubrRate })));
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
  console.log("\nFor context, single-variable R² against UBR-per-100-PA:");
  for (const [key, label] of [["speed", "Speed"], ["run", "Run"], ["steal", "Steal"], ["stlrt", "StlRt"]] as const) {
    const pts = rows.map((r) => ({ x: r[key], y: r.ubrRate }));
    const meanY = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const meanX = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    let num = 0, denX = 0;
    for (const p of pts) { num += (p.x - meanX) * (p.y - meanY); denX += (p.x - meanX) ** 2; }
    const slope = denX === 0 ? 0 : num / denX;
    const intercept = meanY - slope * meanX;
    let ssRes = 0, ssTot = 0;
    for (const p of pts) { const pred = intercept + slope * p.x; ssRes += (p.y - pred) ** 2; ssTot += (p.y - meanY) ** 2; }
    const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
    console.log(`  ${label.padEnd(8)} R²=${r2.toFixed(3)} slope=${slope.toFixed(4)}`);
  }

  console.log("\nLoading the live baserunning weight columns (for the current-weight comparison column)...");
  const { data: weightRow } = await supabase.from("rating_weights")
    .select("baserunning_speed_weight, baserunning_run_weight, baserunning_steal_weight, baserunning_stlrt_weight").eq("is_active", true).maybeSingle();
  const current = weightRow as { baserunning_speed_weight: number; baserunning_run_weight: number; baserunning_steal_weight: number; baserunning_stlrt_weight: number } | null;
  const currentByLabel: Record<string, number | null> = {
    Speed: current?.baserunning_speed_weight ?? null,
    "Run (baserunning)": current?.baserunning_run_weight ?? null,
    Steal: current?.baserunning_steal_weight ?? null,
    "Steal tendency (stlrt)": current?.baserunning_stlrt_weight ?? null,
  };

  console.log("\nSaving this run to weight_tuning_runs/weight_tuning_coefficients (for /admin/weight-tuning)...");
  await persistWeightTuningRun(supabase, {
    refreshRunId: computedRunId,
    stream: "baserunning",
    targetMetric: "UBR / 100 PA",
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
