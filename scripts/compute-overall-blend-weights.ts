import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { fitMultipleLinear } from "../lib/regression.js";
import { persistWeightTuningRun } from "../lib/weight-tuning-persist.js";

// Step 3 of the decomposed offense/defense redesign, finally buildable now
// that Batting, Fielding, and Baserunning have each been individually tuned
// (2026-09-02, Rees's ask -- "start that work on Batter's Overall").
//
// Unlike the other three weight-tuning scripts, this one does NOT regress
// raw tool grades -- it regresses the three already-computed COMPOSITES
// (player_computed.batting/fielding/baserunning, each already internally
// tuned and roughly on the same 20-80ish scale -- see HANDOFF.md) against
// real WAR/100 PA, pooled across every real MLB hitter, no role split.
// This is deliberately the same "pooled, not role-bucketed" design as every
// other regression this session -- role never becomes a variable inside it,
// which is what makes it immune to the restriction-of-range problem that
// killed the original role-calibrated fielding weight.
//
// This answers "how much should Batting vs. Fielding vs. Baserunning count
// toward a hitter's Overall" -- replacing the current ad hoc structure
// where Batting is implicitly weight 1 (nothing multiplies it), Fielding
// gets a small flat 0.25 (`rating_weights.fielding`, historically picked to
// keep the SUM from swamping Pitching's differently-scaled sum, not derived
// from anything), and Baserunning defaults to 0 (deliberately not yet
// decided). Today's "current" weights (1 / 0.25 / 0) sum to 1.25, not 1 --
// exactly the same kind of mismatch Batting's and Pitching's own internal
// weights had before being fixed.

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

const MIN_PA = 100; // same threshold as every other hitter-side regression this session

async function main() {
  const supabase = makeSupabaseClient();

  console.log("Finding latest refresh run with player_computed...");
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

  console.log("Loading 2031 MLB batting stats (pa, war)...");
  const battingRows = await fetchAll<{ player_id: number; pa: number | null; war: number | null }>((from, to) =>
    supabase.from("player_batting_stats_snapshots").select("player_id, pa, war")
      .eq("year", 2031).eq("level_id", 1).eq("split_id", 1).eq("refresh_run_id", statsRunId)
      .range(from, to) as never
  );
  const byPlayer = new Map<number, { pa: number; war: number }>();
  for (const b of battingRows) {
    if (!isRealMlbPlayer(b.player_id)) continue;
    const cur = byPlayer.get(b.player_id) ?? { pa: 0, war: 0 };
    cur.pa += b.pa ?? 0;
    cur.war += b.war ?? 0;
    byPlayer.set(b.player_id, cur);
  }
  console.log(`  ${byPlayer.size} real MLB hitters with any 2031 PA`);

  console.log("Loading Batting/Fielding/Baserunning composites + role...");
  const computed = await fetchAll<{ player_id: number; role: string | null; batting: number | null; fielding: number | null; baserunning: number | null }>((from, to) =>
    supabase.from("player_computed").select("player_id, role, batting, fielding, baserunning").eq("refresh_run_id", computedRunId).range(from, to) as never
  );
  const computedByPlayer = new Map(computed.map((c) => [c.player_id, c]));
  const PITCHER_ROLES = new Set(["SP", "RP", "CL"]);

  interface Row { playerId: number; warRate: number; batting: number; fielding: number; baserunning: number }
  const rows: Row[] = [];
  for (const [playerId, b] of byPlayer) {
    if (b.pa < MIN_PA) continue;
    const c = computedByPlayer.get(playerId);
    if (!c || !c.role || PITCHER_ROLES.has(c.role)) continue;
    if (c.batting == null || c.fielding == null || c.baserunning == null) continue;
    rows.push({ playerId, warRate: (b.war / b.pa) * 100, batting: c.batting, fielding: c.fielding, baserunning: c.baserunning });
  }
  console.log(`  ${rows.length} qualifying hitters (>=${MIN_PA} PA, real composites) for the regression`);
  if (rows.length < 30) throw new Error(`Only ${rows.length} qualifying hitters -- too small to trust a 3-variable regression. Aborting.`);

  const fit = fitMultipleLinear(rows.map((r) => ({ x: [r.batting, r.fielding, r.baserunning], y: r.warRate })));
  const labels = ["Batting", "Fielding", "Baserunning"];

  console.log(`\nRegression: WAR-per-100-PA ~ Batting + Fielding + Baserunning  (n=${rows.length}, R²=${fit.rSquared.toFixed(3)})`);
  console.log(`Intercept: ${fit.intercept.toFixed(4)}`);
  for (let i = 0; i < labels.length; i++) {
    console.log(`  ${labels[i].padEnd(12)} raw coef=${fit.coefficients[i].toFixed(4)} WAR-pts/100PA per composite-pt   standardized=${fit.standardizedCoefficients[i].toFixed(3)}`);
  }

  // Implied weight comes from the RAW coefficients, NOT standardized ones
  // (bug fixed 2026-09-02, caught via a real anomaly -- Jeremy Porten, elite
  // Batting/weak Baserunning, ranking outside the top 100 despite a real 7.1
  // WAR season). Standardized coefficients answer "how much does a 1-SD move
  // in X affect Y" -- the right lens for judging relative importance, which
  // is why they're still shown above. But applying THOSE (renormalized) as
  // literal multipliers against RAW composite values silently reintroduces
  // each variable's own scale: Batting is an average of six grades (SD ~4.9
  // among real hitters -- naturally compressed by averaging), Baserunning is
  // dominated by one grade, `run`, at 71.5% of its own formula (SD ~17.5 --
  // barely compressed at all). Weight x SD is what actually determines an
  // input's real influence on a ranking built from raw values, and with the
  // standardized-derived weights, Baserunning's 3.5x larger variance was
  // silently outweighing Batting's 3.5x larger weight -- roughly equal real
  // swing power despite looking nothing alike in the weight column. Raw
  // coefficients are already expressed in real units ("WAR per raw
  // composite point"), which is the dimensionally correct thing to
  // normalize and apply directly to raw values.
  const clamped = fit.coefficients.map((c) => Math.max(0, c));
  const sum = clamped.reduce((s, c) => s + c, 0);
  const normalized = sum > 0 ? clamped.map((c) => c / sum) : clamped.map(() => 0);

  console.log("\nLoading the live active weight set (for the current-weight comparison column)...");
  // `batting` is a real column since 2026-09-02 (previously implicit 1,
  // nothing multiplied it) -- read it directly rather than hardcoding,
  // which was its own stale-snapshot bug (always reported 1 here even
  // after batting's real weight shipped, since this select never asked for
  // the new column).
  const { data: weightRow } = await supabase.from("rating_weights").select("batting, fielding, baserunning").eq("is_active", true).maybeSingle();
  const current = weightRow as { batting: number; fielding: number; baserunning: number } | null;
  const currentByLabel: Record<string, number | null> = {
    Batting: current?.batting ?? null, Fielding: current?.fielding ?? null, Baserunning: current?.baserunning ?? null,
  };
  const currentSum = (currentByLabel.Batting ?? 0) + (currentByLabel.Fielding ?? 0) + (currentByLabel.Baserunning ?? 0);

  console.log(`\nImplied weight vector if normalized to sum to 1 (diagnostic -- not written to rating_weights). Current weights sum to ${currentSum.toFixed(3)}, not 1:`);
  for (let i = 0; i < labels.length; i++) {
    console.log(`  ${labels[i].padEnd(12)} implied=${normalized[i].toFixed(3)}   current=${(currentByLabel[labels[i]] ?? NaN).toFixed(3)}`);
  }

  console.log("\nSaving this run to weight_tuning_runs/weight_tuning_coefficients (for /admin/weight-tuning)...");
  await persistWeightTuningRun(supabase, {
    refreshRunId: computedRunId,
    stream: "overall_blend",
    targetMetric: "WAR / 100 PA",
    rSquared: fit.rSquared,
    sampleSize: rows.length,
    coefficients: labels.map((label, i) => ({
      key: label.toLowerCase(),
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
  console.error("compute-overall-blend-weights failed:", err);
  process.exit(1);
});
