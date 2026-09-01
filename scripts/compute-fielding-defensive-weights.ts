import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { fitLine } from "../lib/regression.js";
import { persistWeightTuningRun } from "../lib/weight-tuning-persist.js";

// Fielding vs. WAR/100 defensive innings (2026-09-02, Rees's ask) --
// reference-only, explicitly NOT meant to set any weight (he's comfortable
// with the current Fielding blend weight). Added as a real weight-tuning
// stream, same as every other regression this session, per his correction
// that this belongs on /admin/weight-tuning, not just as a toggle on
// /admin/rating-validation (rating-validation is meant to be a SUMMARY of
// the work happening here, not host new regressions of its own).
//
// Checked first (still true, not re-litigated here): no position-adjusted
// defensive value metric exists anywhere in this schema -- only raw,
// per-position ZR in player_fielding_stats_snapshots. This doesn't isolate
// defense either -- it's real total WAR (offense included) over a
// defense-scoped exposure denominator (innings fielded, summed across every
// position a player played that season), not a pure defensive value
// metric. Single-variable by design (Fielding is one composite, there's
// nothing else to combine it with here).

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

const MIN_DEFENSIVE_IP = 50; // rough analog of the 100 PA / 30-75 IP floors used elsewhere -- excludes token defensive cameos

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

  console.log("Loading 2031 real MLB WAR (batting)...");
  const battingRows = await fetchAll<{ player_id: number; war: number | null }>((from, to) =>
    supabase.from("player_batting_stats_snapshots").select("player_id, war")
      .eq("year", 2031).eq("level_id", 1).eq("split_id", 1).eq("refresh_run_id", statsRunId).range(from, to) as never
  );
  const warByPlayer = new Map<number, number>();
  for (const b of battingRows) {
    if (!isRealMlbPlayer(b.player_id)) continue;
    warByPlayer.set(b.player_id, (warByPlayer.get(b.player_id) ?? 0) + (b.war ?? 0));
  }

  // split_id=0 here, not 1 -- player_fielding_stats_snapshots' own "overall"
  // convention differs from batting/pitching (same gotcha /org-minors' ZR
  // work already confirmed). One row per position a player fielded.
  console.log("Loading 2031 defensive innings (all positions)...");
  const fieldingRows = await fetchAll<{ player_id: number; ip: number | null }>((from, to) =>
    supabase.from("player_fielding_stats_snapshots").select("player_id, ip")
      .eq("year", 2031).eq("level_id", 1).eq("split_id", 0).eq("refresh_run_id", statsRunId).range(from, to) as never
  );
  const fieldingIpByPlayer = new Map<number, number>();
  for (const f of fieldingRows) {
    if (!isRealMlbPlayer(f.player_id)) continue;
    fieldingIpByPlayer.set(f.player_id, (fieldingIpByPlayer.get(f.player_id) ?? 0) + (f.ip ?? 0));
  }

  console.log("Loading Fielding composite + role...");
  const computed = await fetchAll<{ player_id: number; role: string | null; fielding: number | null }>((from, to) =>
    supabase.from("player_computed").select("player_id, role, fielding").eq("refresh_run_id", computedRunId).range(from, to) as never
  );
  const PITCHER_ROLES = new Set(["SP", "RP", "CL"]);

  interface Row { playerId: number; fielding: number; warRate: number }
  const rows: Row[] = [];
  for (const c of computed) {
    if (!c.role || PITCHER_ROLES.has(c.role) || c.fielding == null) continue;
    const ip = fieldingIpByPlayer.get(c.player_id) ?? 0;
    if (ip < MIN_DEFENSIVE_IP) continue;
    const war = warByPlayer.get(c.player_id) ?? 0;
    rows.push({ playerId: c.player_id, fielding: c.fielding, warRate: (war / ip) * 100 });
  }
  console.log(`  ${rows.length} qualifying hitters (>=${MIN_DEFENSIVE_IP} defensive IP) for the regression`);
  if (rows.length < 30) throw new Error(`Only ${rows.length} qualifying hitters -- too small to trust this. Aborting.`);

  const fit = fitLine(rows.map((r) => ({ x: r.fielding, y: r.warRate })));
  console.log(`\nFielding vs. WAR/100 Defensive IP  (n=${rows.length}, R²=${fit.rSquared.toFixed(3)}, slope=${fit.slope.toFixed(4)})`);

  const { data: weightRow } = await supabase.from("rating_weights").select("fielding").eq("is_active", true).maybeSingle();
  const currentFielding = (weightRow as { fielding: number } | null)?.fielding ?? null;

  await persistWeightTuningRun(supabase, {
    refreshRunId: computedRunId,
    stream: "fielding_defensive",
    targetMetric: "WAR / 100 Defensive Innings",
    rSquared: fit.rSquared,
    sampleSize: rows.length,
    coefficients: [{
      key: "fielding", label: "Fielding",
      rawCoefficient: fit.slope, standardizedCoefficient: fit.slope, // single-variable -- standardized/raw distinction doesn't apply the same way, both shown as the same fitted slope
      impliedWeight: 1, // trivially 1 for a single-variable regression -- NOT a recommendation to set w.fielding to 1, see the file comment: reference only
      currentWeight: currentFielding,
    }],
  });

  console.log("\nDone -- reference only, nothing written to rating_weights.");
}

main().catch((err) => {
  console.error("compute-fielding-defensive-weights failed:", err);
  process.exit(1);
});
