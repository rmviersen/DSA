import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { fitMultipleLinear } from "../lib/regression.js";
import { getLeagueId, leagueSlugFromArgv } from "../lib/league.js";

// Work Ethic / Intelligence impact on real development (2026-09-15, Rees's
// ask). Rees wants Draft Value's Work Ethic (+3/0/-3) and Intelligence
// (+1.5/0/-1.5, i.e. half of Work Ethic's swing) adjustments retuned from
// real data instead of the hand-picked "reasoned first cut" they shipped
// as -- but a full draft-outcome regression (real drafted amateurs tracked
// all the way to a fully-developed real career) isn't viable yet: this
// league's ratings snapshots only go back to mid-2031, nowhere near a full
// development arc for any real draftee. Rees's own call: analyze what we
// CAN measure now -- how much a player's grades actually moved over the
// real snapshot history we do have -- as a real, data-driven signal to
// inform the retune, rather than guessing.
//
// PAGE_SIZE: This script is exploratory/diagnostic, run by hand, not wired
// into refresh.ts -- prints results, writes nothing anywhere.
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

// Only players with a REAL gap to close are informative here -- someone
// already at (or above) their own potential estimate has nowhere to
// "develop" in this sense, and including them would just add zero-signal
// noise. 1.0 overall point is a low bar (deliberately inclusive -- this is
// exploratory, not gating anything) but rules out already-capped veterans.
const MIN_DEVELOPMENT_GAP = 1;

interface ComputedRow { player_id: number; overall: number | null; potential: number | null }
interface RatingsRow { player_id: number; wrkethic: string | null; int_: string | null }

async function main() {
  const supabase = makeSupabaseClient();
  const leagueId = await getLeagueId(supabase, leagueSlugFromArgv());

  console.log("Finding the earliest and latest refresh runs with real player_computed data AND a real game_date (needed for real age-at-start-of-window below)...");
  // Paginated (fetchAll), not a plain .select() -- player_computed has far
  // more than 1000 rows per run, and an unpaginated select silently returns
  // only PostgREST's default 1000-row page, which can (and did, caught
  // during this script's own first real run) span an arbitrary MIDDLE
  // subset of refresh_run_ids rather than the true min/max.
  const computedRunRows = await fetchAll<{ refresh_run_id: number }>((from, to) =>
    supabase.from("player_computed").select("refresh_run_id").eq("dsa_league_id", leagueId).range(from, to) as never
  );
  const computedRunIds = [...new Set(computedRunRows.map((r) => r.refresh_run_id))];
  const { data: runDateRows } = await supabase.from("refresh_runs").select("id, game_date").in("id", computedRunIds).not("game_date", "is", null).order("id", { ascending: true });
  const datedRuns = (runDateRows as { id: number; game_date: string }[] ?? []);
  if (datedRuns.length < 2) {
    console.log("Not enough distinct dated refresh runs with player_computed data yet to measure development over time. Skipping.");
    return;
  }
  const earliestRun = datedRuns[0].id;
  const latestRun = datedRuns[datedRuns.length - 1].id;
  const gameDateByRun = new Map(datedRuns.map((r) => [r.id, r.game_date]));
  console.log(`Window: refresh_run_id ${earliestRun} (game_date ${gameDateByRun.get(earliestRun)}) -> ${latestRun} (game_date ${gameDateByRun.get(latestRun)})`);

  console.log("Loading early-snapshot overall/potential...");
  const earlyComputed = await fetchAll<ComputedRow>((from, to) =>
    supabase.from("player_computed").select("player_id, overall, potential").eq("dsa_league_id", leagueId).eq("refresh_run_id", earliestRun)
      .not("overall", "is", null).not("potential", "is", null).range(from, to) as never
  );
  console.log("Loading late-snapshot overall...");
  const lateComputed = await fetchAll<ComputedRow>((from, to) =>
    supabase.from("player_computed").select("player_id, overall").eq("dsa_league_id", leagueId).eq("refresh_run_id", latestRun)
      .not("overall", "is", null).range(from, to) as never
  );
  const lateOverallByPlayer = new Map(lateComputed.map((r) => [r.player_id, r.overall as number]));

  console.log("Loading early-snapshot Work Ethic / Intelligence grades...");
  const earlyRatings = await fetchAll<RatingsRow>((from, to) =>
    supabase.from("player_ratings_snapshots").select("player_id, wrkethic, int_").eq("dsa_league_id", leagueId).eq("refresh_run_id", earliestRun).range(from, to) as never
  );
  const ratingsByPlayer = new Map(earlyRatings.map((r) => [r.player_id, r]));

  console.log("Loading player birthdates (for real age-at-start-of-window, a development-speed confound to control for)...");
  const players = await fetchAll<{ id: number; date_of_birth: string | null }>((from, to) =>
    supabase.from("players").select("id, date_of_birth").eq("dsa_league_id", leagueId).range(from, to) as never
  );
  const dobByPlayer = new Map(players.map((p) => [p.id, p.date_of_birth]));
  const earlyGameDate = gameDateByRun.get(earliestRun);
  function ageAtEarlyRun(playerId: number): number | null {
    const dob = dobByPlayer.get(playerId);
    if (!dob || !earlyGameDate) return null;
    return (new Date(earlyGameDate).getTime() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000);
  }

  interface Row { playerId: number; growth: number; gap: number; age: number; workEthicScore: number; intelligenceScore: number; wrkethic: string; int_: string }
  const MAKEUP_SCORE: Record<string, number> = { H: 1, N: 0, L: -1 };
  const rows: Row[] = [];
  for (const e of earlyComputed) {
    const lateOverall = lateOverallByPlayer.get(e.player_id);
    if (lateOverall === undefined) continue; // not present in both snapshots
    const gap = (e.potential as number) - (e.overall as number);
    if (gap < MIN_DEVELOPMENT_GAP) continue;
    const r = ratingsByPlayer.get(e.player_id);
    if (!r || !r.wrkethic || !r.int_) continue;
    const age = ageAtEarlyRun(e.player_id);
    if (age === null) continue;
    rows.push({
      playerId: e.player_id, growth: lateOverall - (e.overall as number), gap, age,
      workEthicScore: MAKEUP_SCORE[r.wrkethic] ?? 0, intelligenceScore: MAKEUP_SCORE[r.int_] ?? 0,
      wrkethic: r.wrkethic, int_: r.int_,
    });
  }
  console.log(`\n${rows.length} players with a real development gap (>=${MIN_DEVELOPMENT_GAP} pts) present in both snapshots, real makeup grades, real age.`);
  if (rows.length < 30) throw new Error(`Only ${rows.length} qualifying players -- too small to trust this. Aborting.`);

  // Plain, unadjusted group averages first -- the easiest thing to read
  // directly: does average real growth actually differ by category at all?
  function groupStats(key: "wrkethic" | "int_") {
    const groups: Record<string, { n: number; growthSum: number; gapSum: number }> = { H: { n: 0, growthSum: 0, gapSum: 0 }, N: { n: 0, growthSum: 0, gapSum: 0 }, L: { n: 0, growthSum: 0, gapSum: 0 } };
    for (const r of rows) {
      const g = groups[r[key]];
      g.n++; g.growthSum += r.growth; g.gapSum += r.gap;
    }
    return groups;
  }
  console.log("\n=== Work Ethic: unadjusted average real growth (overall pts, this window) ===");
  for (const [cat, g] of Object.entries(groupStats("wrkethic"))) {
    console.log(`  ${cat.padEnd(2)} n=${g.n.toString().padEnd(6)} avg growth=${(g.growthSum / g.n).toFixed(3)}  avg starting gap=${(g.gapSum / g.n).toFixed(2)}`);
  }
  console.log("\n=== Intelligence: unadjusted average real growth (overall pts, this window) ===");
  for (const [cat, g] of Object.entries(groupStats("int_"))) {
    console.log(`  ${cat.padEnd(2)} n=${g.n.toString().padEnd(6)} avg growth=${(g.growthSum / g.n).toFixed(3)}  avg starting gap=${(g.gapSum / g.n).toFixed(2)}`);
  }

  // Controlled regression: real growth ~ WorkEthicScore + IntelligenceScore
  // + Age + StartingGap. Controls for the two obvious confounds (younger
  // players and players with a bigger gap to begin with both mechanically
  // have more ROOM to show growth) so the Work Ethic/Intelligence
  // coefficients reflect their own real relationship with development, not
  // just "H players happened to skew younger/have bigger gaps."
  const fit = fitMultipleLinear(rows.map((r) => ({ x: [r.workEthicScore, r.intelligenceScore, r.age, r.gap], y: r.growth })));
  const labels = ["Work Ethic", "Intelligence", "Age (at start)", "Starting gap (Pot-Ovr)"];
  console.log(`\n=== Controlled regression: real growth ~ Work Ethic + Intelligence + Age + Starting Gap (n=${rows.length}, R²=${fit.rSquared.toFixed(3)}) ===`);
  for (let i = 0; i < labels.length; i++) {
    console.log(`  ${labels[i].padEnd(24)} raw coef=${fit.coefficients[i].toFixed(4)} overall-pts per unit   standardized=${fit.standardizedCoefficients[i].toFixed(3)}`);
  }
  const weRatio = fit.standardizedCoefficients[1] !== 0 ? fit.standardizedCoefficients[0] / fit.standardizedCoefficients[1] : null;
  console.log(`\nWork Ethic's standardized effect is ${weRatio === null ? "undefined (Intelligence coefficient is 0)" : `${weRatio.toFixed(2)}x`} Intelligence's, after controlling for age and starting gap.`);
  console.log("(Draft Value's current constants assume a 2.00x ratio: Work Ethic +/-3 vs. Intelligence +/-1.5.)");
}

main().catch((err) => {
  console.error("analyze-makeup-development-impact failed:", err);
  process.exit(1);
});
