import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { getLeagueId, leagueSlugFromArgv, getMlbLeagueId } from "../lib/league.js";
import { checkRatingDistribution, RATING_SANITY, type RatingDistribution, type PreviousDistribution } from "../lib/rating-sanity.js";

// Independent audit of the rating pipeline (2026-10-06, after the role-multiplier incident -- see HANDOFF.md).
// Runs in the GitHub workflow after every refresh tick (and any time: `npm run verify-ratings`). It does NOT
// trust the pipeline's own bookkeeping -- it re-reads the database and checks the invariants that, had they
// been checked, would have caught the incident on the first bad run instead of ten days later:
//
//   1. FRESH      the newest succeeded ratings-bearing refresh run has its own player_computed (+ team_computed).
//   2. DISTRIBUTION  the newest computed run's hitter/pitcher mean + SD haven't jumped vs the previous run, and the
//                 hitter ROLES agree with each other (the incident: mean +14, SD x3, roles ~24 points apart).
//   3. WEIGHTS    exactly one active rating_weights row per league and every weight group sums to 1.
//   4. BLOAT      failed refresh runs aren't leaving full copies of the season's stats behind (WARN only).
//
// Exit code 1 on any FAIL so the workflow run goes red (GitHub emails that); WARNs are printed but don't fail.

type Level = "PASS" | "WARN" | "FAIL";
const results: { level: Level; check: string; detail: string }[] = [];
const report = (level: Level, check: string, detail: string) => { results.push({ level, check, detail }); console.log(`[${level}] ${check}: ${detail}`); };

const supabase = makeSupabaseClient();

async function main() {
  const leagueId = await getLeagueId(supabase, leagueSlugFromArgv());
  const mlbLeagueId = await getMlbLeagueId(supabase, leagueId);

  // ---- 1. FRESH -------------------------------------------------------------------------------------------
  const { data: runsRaw, error: runsErr } = await supabase
    .from("refresh_runs").select("id,status,started_at,completed_at,game_date,ratings_included,hitter_overall_mean,hitter_overall_sd,pitcher_overall_mean,pitcher_overall_sd")
    .eq("dsa_league_id", leagueId).order("id", { ascending: false }).limit(40);
  if (runsErr) throw runsErr;
  type Run = { id: number; status: string; started_at: string; completed_at: string | null; game_date: string | null; ratings_included: boolean | null; hitter_overall_mean: number | null; hitter_overall_sd: number | null; pitcher_overall_mean: number | null; pitcher_overall_sd: number | null };
  const runs = (runsRaw ?? []) as Run[];
  const newestRatingsRun = runs.find((r) => r.status === "succeeded" && r.ratings_included === true);
  if (!newestRatingsRun) { report("FAIL", "fresh", "no succeeded ratings-bearing refresh run found in the last 40 runs"); return; }

  const { data: compRow, error: compErr } = await supabase.from("player_computed").select("refresh_run_id").eq("dsa_league_id", leagueId).order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  if (compErr) throw compErr;
  const computedRunId = (compRow as { refresh_run_id: number } | null)?.refresh_run_id ?? 0;
  const ageMin = (Date.now() - new Date(newestRatingsRun.completed_at ?? newestRatingsRun.started_at).getTime()) / 60000;
  if (computedRunId < newestRatingsRun.id) {
    // Grace period: the compute step runs right after the run is marked succeeded.
    report(ageMin > 45 ? "FAIL" : "WARN", "fresh",
      `newest succeeded ratings run is ${newestRatingsRun.id} (game date ${newestRatingsRun.game_date}) but the latest player_computed is run ${computedRunId} -- computed ratings are ${ageMin > 45 ? "STALE" : "still being computed"}`);
  } else {
    report("PASS", "fresh", `player_computed exists for the newest ratings run (${newestRatingsRun.id}, game date ${newestRatingsRun.game_date})`);
  }
  const { count: teamCompCount } = await supabase.from("team_computed").select("team_id", { count: "exact", head: true }).eq("dsa_league_id", leagueId).eq("refresh_run_id", computedRunId);
  if ((teamCompCount ?? 0) === 0) report("WARN", "fresh", `no team_computed rows for computed run ${computedRunId}`);

  // ---- 2. DISTRIBUTION ------------------------------------------------------------------------------------
  const cur = runs.find((r) => r.id === computedRunId);
  if (!cur || cur.hitter_overall_mean == null) {
    report("WARN", "distribution", `computed run ${computedRunId} has no stored hitter/pitcher mean+SD to check`);
  } else {
    const prev = runs.find((r) => r.id < computedRunId && r.hitter_overall_mean != null);
    // Per-role raw means over the MLB reference pool (league_id = the MLB league, mlb_service_days > 0).
    const { data: mlbPlayers, error: pErr } = await supabase.from("players").select("id").eq("dsa_league_id", leagueId).eq("league_id", mlbLeagueId).gt("mlb_service_days", 0);
    if (pErr) throw pErr;
    const ids = (mlbPlayers as { id: number }[]).map((p) => p.id);
    const roleAcc = new Map<string, { sum: number; n: number }>();
    for (let i = 0; i < ids.length; i += 400) {
      const { data, error } = await supabase.from("player_computed").select("role,ph,overall_raw").eq("dsa_league_id", leagueId).eq("refresh_run_id", computedRunId).in("player_id", ids.slice(i, i + 400));
      if (error) throw error;
      for (const r of (data ?? []) as { role: string | null; ph: string | null; overall_raw: number | null }[]) {
        if (r.ph !== "H" || !r.role || r.overall_raw == null) continue;
        const cell = roleAcc.get(r.role) ?? { sum: 0, n: 0 };
        cell.sum += Number(r.overall_raw); cell.n += 1; roleAcc.set(r.role, cell);
      }
    }
    const current: RatingDistribution = {
      hitterMean: Number(cur.hitter_overall_mean), hitterSd: Number(cur.hitter_overall_sd), pitcherMean: Number(cur.pitcher_overall_mean), pitcherSd: Number(cur.pitcher_overall_sd),
      hitterRoleMeans: Object.fromEntries([...roleAcc].map(([role, v]) => [role, { mean: v.sum / v.n, n: v.n }])),
    };
    const previous: PreviousDistribution | null = prev
      ? { runId: prev.id, hitterMean: Number(prev.hitter_overall_mean), hitterSd: Number(prev.hitter_overall_sd), pitcherMean: Number(prev.pitcher_overall_mean), pitcherSd: Number(prev.pitcher_overall_sd) }
      : null;
    const problems = checkRatingDistribution(current, previous);
    const roleText = Object.entries(current.hitterRoleMeans).map(([r, v]) => `${r}=${v.mean.toFixed(1)}`).join(" ");
    if (problems.length > 0) report("FAIL", "distribution", `run ${computedRunId}: ${problems.join(" | ")}`);
    else report("PASS", "distribution", `run ${computedRunId}: hitters ${current.hitterMean.toFixed(2)}/${current.hitterSd.toFixed(2)}, pitchers ${current.pitcherMean.toFixed(2)}/${current.pitcherSd.toFixed(2)}${previous ? ` (vs run ${previous.runId})` : ""}; role means ${roleText}`);
  }

  // ---- 3. WEIGHTS -----------------------------------------------------------------------------------------
  const { data: wRaw, error: wErr } = await supabase.from("rating_weights").select("*").eq("is_active", true);
  if (wErr) throw wErr;
  const active = (wRaw ?? []) as Record<string, number | string | boolean | null>[];
  const mine = active.filter((w) => w.dsa_league_id === leagueId);
  if (mine.length !== 1) report("FAIL", "weights", `expected exactly 1 active rating_weights row for league ${leagueId}, found ${mine.length}`);
  else {
    const w = mine[0]; const n = (k: string) => Number(w[k] ?? 0);
    const groups: [string, number][] = [
      ["blend (batting+fielding+baserunning)", n("batting") + n("fielding") + n("baserunning")],
      ["hitting", n("contact") + n("gap") + n("power") + n("eye") + n("avoid_ks") + n("speed")],
      ["baserunning parts", n("baserunning_speed_weight") + n("baserunning_run_weight") + n("baserunning_steal_weight") + n("baserunning_stlrt_weight")],
      ["SP", n("sp_stuff") + n("sp_movement") + n("sp_control") + n("sp_stamina")],
      ["RP", n("rp_stuff") + n("rp_movement") + n("rp_control") + n("rp_stamina")],
    ];
    const bad = groups.filter(([, sum]) => Math.abs(sum - 1) > 0.01);
    if (bad.length > 0) report("FAIL", "weights", `active set #${w.id}: ${bad.map(([g, s]) => `${g}=${s.toFixed(4)}`).join(", ")} (each group must sum to 1)`);
    else report("PASS", "weights", `active set #${w.id}: every group sums to 1 (blend ${n("batting").toFixed(3)}/${n("fielding").toFixed(3)}/${n("baserunning").toFixed(3)})`);
  }

  // ---- 4. BLOAT (warn only) -------------------------------------------------------------------------------
  const failedRecent = runs.filter((r) => r.status === "failed" && Date.now() - new Date(r.started_at).getTime() < 14 * 24 * 3600 * 1000);
  if (failedRecent.length >= 3) {
    report("WARN", "bloat", `${failedRecent.length} failed refresh runs in the last 14 days (ids ${failedRecent.slice(0, 6).map((r) => r.id).join(", ")}${failedRecent.length > 6 ? ", ..." : ""}) -- check the workflow logs; a recurring auth/token failure is the usual cause`);
  } else {
    report("PASS", "bloat", `${failedRecent.length} failed refresh run(s) in the last 14 days`);
  }
  void RATING_SANITY;
}

main()
  .then(() => {
    const fails = results.filter((r) => r.level === "FAIL").length;
    const warns = results.filter((r) => r.level === "WARN").length;
    console.log(`\nverify-ratings: ${fails} FAIL, ${warns} WARN, ${results.filter((r) => r.level === "PASS").length} PASS`);
    if (fails > 0) process.exitCode = 1;
  })
  .catch((e) => { console.error("verify-ratings crashed:", e); process.exit(1); });
