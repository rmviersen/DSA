import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { fitLine } from "../lib/regression.js";
import { persistWeightTuningRun } from "../lib/weight-tuning-persist.js";
import { getLeagueId, leagueSlugFromArgv, getCurrentSeasonYear, getMlbLeagueId, getWeightTuningSeasons } from "../lib/league.js";

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
//
// MULTI-SEASON BLEND (2026-09-15, Rees's ask -- see compute-hitting-
// weights.ts's file comment for the full reasoning). Pools the current
// season with the most recent earlier one (lib/league.ts's
// getWeightTuningSeasons), each season's own Fielding composite read from
// its own refresh run, weighted by real season progress.

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

interface Row { playerId: number; year: number; seasonWeight: number; fielding: number; warRate: number }

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

    console.log(`Loading ${year} real MLB WAR (batting)...`);
    const battingRows = await fetchAll<{ player_id: number; war: number | null }>((from, to) =>
      supabase.from("player_batting_stats_snapshots").select("player_id, war")
        .eq("year", year).eq("level_id", 1).eq("split_id", 1).eq("refresh_run_id", statsRefreshRunId).range(from, to) as never
    );
    const warByPlayer = new Map<number, number>();
    for (const b of battingRows) {
      if (!isRealMlbPlayer(b.player_id)) continue;
      warByPlayer.set(b.player_id, (warByPlayer.get(b.player_id) ?? 0) + (b.war ?? 0));
    }

    // split_id=0 here, not 1 -- player_fielding_stats_snapshots' own "overall"
    // convention differs from batting/pitching (same gotcha /org-minors' ZR
    // work already confirmed). One row per position a player fielded.
    console.log(`Loading ${year} defensive innings (all positions)...`);
    const fieldingRows = await fetchAll<{ player_id: number; ip: number | null }>((from, to) =>
      supabase.from("player_fielding_stats_snapshots").select("player_id, ip")
        .eq("year", year).eq("level_id", 1).eq("split_id", 0).eq("refresh_run_id", statsRefreshRunId).range(from, to) as never
    );
    const fieldingIpByPlayer = new Map<number, number>();
    for (const f of fieldingRows) {
      if (!isRealMlbPlayer(f.player_id)) continue;
      fieldingIpByPlayer.set(f.player_id, (fieldingIpByPlayer.get(f.player_id) ?? 0) + (f.ip ?? 0));
    }

    console.log(`Loading ${year} Fielding composite + role...`);
    const computed = await fetchAll<{ player_id: number; role: string | null; fielding: number | null }>((from, to) =>
      supabase.from("player_computed").select("player_id, role, fielding").eq("dsa_league_id", leagueId).eq("refresh_run_id", statsRefreshRunId).range(from, to) as never
    );

    let seasonRowCount = 0;
    for (const c of computed) {
      if (!c.role || PITCHER_ROLES.has(c.role) || c.fielding == null) continue;
      const ip = fieldingIpByPlayer.get(c.player_id) ?? 0;
      if (ip < MIN_DEFENSIVE_IP) continue;
      const war = warByPlayer.get(c.player_id) ?? 0;
      rows.push({ playerId: c.player_id, year, seasonWeight: season.weight, fielding: c.fielding, warRate: (war / ip) * 100 });
      seasonRowCount++;
    }
    console.log(`  ${seasonRowCount} qualifying ${year} hitters (>=${MIN_DEFENSIVE_IP} defensive IP)`);
  }

  console.log(`\n${rows.length} total qualifying hitter-seasons pooled across ${seasons.length} season(s) for the regression`);
  if (rows.length < 30) throw new Error(`Only ${rows.length} qualifying hitter-seasons -- too small to trust this. Aborting.`);

  // See compute-hitting-weights.ts's comment on this exact normalization --
  // spreads each season's target weight evenly across its own qualifying
  // rows, reducing to plain OLS when only one season is pooled.
  const rowCountByYear = new Map<number, number>();
  for (const r of rows) rowCountByYear.set(r.year, (rowCountByYear.get(r.year) ?? 0) + 1);
  const fit = fitLine(rows.map((r) => ({ x: r.fielding, y: r.warRate, weight: r.seasonWeight / rowCountByYear.get(r.year)! })));
  console.log(`\nFielding vs. WAR/100 Defensive IP  (n=${rows.length}, R²=${fit.rSquared.toFixed(3)}, slope=${fit.slope.toFixed(4)})`);

  const { data: weightRow } = await supabase.from("rating_weights").select("fielding").eq("dsa_league_id", leagueId).eq("is_active", true).maybeSingle();
  const currentFielding = (weightRow as { fielding: number } | null)?.fielding ?? null;

  const seasonLabel = seasons.length > 1
    ? `${seasons.map((s) => `${s.year} (w=${s.weight.toFixed(2)})`).join(" + ")} blend`
    : `${seasons[0].year}`;
  await persistWeightTuningRun(supabase, {
    refreshRunId: seasons[seasons.length - 1].statsRefreshRunId,
    leagueId,
    stream: "fielding_defensive",
    targetMetric: `WAR / 100 Defensive Innings (${seasonLabel})`,
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
