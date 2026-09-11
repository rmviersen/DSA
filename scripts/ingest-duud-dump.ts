import "dotenv/config";
import { readDumpTable, type DumpRow } from "../lib/ootp-sql-dump-parser.js";
import { getLeagueId } from "../lib/league.js";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { int, str } from "../lib/mappers.js";
import * as map from "../lib/ootp-sql-dump-mappers.js";

// Duud's own ingestion adapter -- Step 5 of the multi-league architecture
// plan (2026-09-11), the OotpSqlDumpAdapter referenced throughout that doc.
// Reads a real OOTP "Configure SQL dump for MySQL" export directly off
// disk (no network calls, unlike refresh.ts's StatsPlus pipeline) and
// writes into the exact same tables TBL's refresh.ts writes into, stamped
// with Duud's own dsa_league_id so both leagues share one schema.
//
// Deliberately scoped to ONLY what we already pull from StatsPlus for TBL
// (Rees's explicit call, 2026-09-11) -- the dump's extra tables (team
// financials, per-game/at-bat data, awards, injury history, coaches, trade
// history) are real and confirmed usable, just not built yet. See
// multi-league-architecture-plan.md, Step 5, for the full research behind
// every mapping decision below.
//
// NOT run as part of refresh.ts's automated pipeline, and deliberately no
// cron/GitHub-Actions equivalent -- confirmed with Rees (2026-09-11): no
// fixed cadence (he exports whenever he thinks of it, e.g. after a draft or
// a big trade), triggered by telling Claude Code directly in a session
// rather than any automated watcher. GitHub Actions couldn't reach this
// data even if there were a fixed cadence -- the dump is a local file on
// Rees's own machine, not a hosted API like StatsPlus. See HANDOFF.md's
// "Duud refresh routine" section for the exact steps to run this.
// Downstream calibration (compute-ratings.ts and friends) is Step 6, not
// run by this script -- those still default to TBL until that step exists.

// Rees's save always lands here for the "Duud Duud" league -- confirmed
// stable across repeat exports, so this covers the common case with zero
// arguments. Override with a CLI arg or DUUD_DUMP_DIR for a renamed league,
// a moved save, or testing against a different exported copy.
const DEFAULT_DUMP_DIR = "C:\\Users\\rmvie\\OneDrive\\Documents\\Out of the Park Developments\\OOTP Baseball 27\\saved_games\\Duud Duud.lg\\import_export\\mysql";

const BATCH_SIZE = 500;
const MAX_ATTEMPTS = 3;

// Rees's own organization in Duud, confirmed 2026-09-10. Used below to pick
// which scouting report represents "the" grade for a player -- see the
// ratings section's own comment for the full reasoning.
const USER_TEAM_ID = "5"; // Chicago White Sox

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`${label} failed on attempt ${attempt}/${MAX_ATTEMPTS}: ${err}`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
}

async function upsertBatched(supabase: ReturnType<typeof makeSupabaseClient>, table: string, rows: Record<string, unknown>[], conflictCols: string, leagueId: number) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((r) => ({ ...r, dsa_league_id: leagueId }));
    await withRetry(`${table} upsert (rows ${i}-${i + batch.length})`, async () => {
      const { error } = await supabase.from(table as never).upsert(batch as never[], { onConflict: conflictCols });
      if (error) throw new Error(`${table} upsert failed: ${error.message}`);
    });
  }
  console.log(`  -> ${table}: ${rows.length} rows upserted`);
}

async function insertBatched(supabase: ReturnType<typeof makeSupabaseClient>, table: string, rows: Record<string, unknown>[], leagueId: number) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((r) => ({ ...r, dsa_league_id: leagueId }));
    await withRetry(`${table} insert (rows ${i}-${i + batch.length})`, async () => {
      const { error } = await supabase.from(table as never).insert(batch as never[]);
      if (error) throw new Error(`${table} insert failed: ${error.message}`);
    });
  }
  console.log(`  -> ${table}: ${rows.length} rows inserted`);
}

function indexBy<T extends DumpRow>(rows: T[], key: string): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) m.set(r[key], r);
  return m;
}

// The stats snapshot tables' real unique constraints are narrower than
// "one row per player per year" -- they don't include level_id. Confirmed
// via real data: ~0.7% of in-scope players have TWO stat lines in the same
// year that collide on the real key (same team_id -- usually "0", meaning
// not affiliated with any pro org -- and split_id) but come from genuinely
// different amateur/independent leagues (different level_id/league_id),
// e.g. a college season split across two conferences. Rather than crash
// the whole import over this small edge case, or silently fabricate a
// merged stat line, this keeps the first row seen per real key and logs
// exactly how many were dropped -- a small, disclosed simplification
// (these are pre-professional stat lines, not core roster/prospect data)
// rather than a silent one.
function dedupeByRealKey<T extends DumpRow>(rows: T[], keyCols: string[], label: string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  let dropped = 0;
  for (const r of rows) {
    const key = keyCols.map((c) => r[c]).join("|");
    if (seen.has(key)) { dropped++; continue; }
    seen.add(key);
    out.push(r);
  }
  if (dropped > 0) console.log(`  (${label}: dropped ${dropped} of ${rows.length} rows colliding on the real unique key ${JSON.stringify(keyCols)})`);
  return out;
}

async function main() {
  const dumpDir = process.argv[2] || process.env.DUUD_DUMP_DIR || DEFAULT_DUMP_DIR;
  console.log(`Reading dump from: ${dumpDir}`);

  const supabase = makeSupabaseClient();
  const leagueId = await getLeagueId(supabase, "Duud");
  console.log(`Resolved Duud -> dsa_league_id ${leagueId}`);

  // The league's own current in-game date lives directly on `leagues`
  // (`current_date`) -- no separate games-table derivation needed here,
  // unlike TBL's StatsPlus pipeline.
  const { rows: leagueRows } = readDumpTable(dumpDir, "leagues");
  const gameDate = str(leagueRows[0]?.["current_date"]);
  console.log(`League game date in this dump: ${gameDate ?? "(not found)"}`);

  const { data: run, error: runErr } = await supabase
    .from("refresh_runs")
    .insert({ status: "running", ratings_included: true, dsa_league_id: leagueId, game_date: gameDate, notes: `Duud SQL dump import from ${dumpDir}` })
    .select()
    .single();
  if (runErr || !run) throw new Error(`Could not start refresh_run: ${runErr?.message}`);
  const refreshRunId = run.id as number;
  const capturedAt = new Date().toISOString();

  try {
    // --- Teams ------------------------------------------------------------
    console.log("Reading + mapping teams...");
    const { rows: teamRows } = readDumpTable(dumpDir, "teams");
    const teamById = indexBy(teamRows, "team_id");
    await upsertBatched(supabase, "teams", teamRows.map(map.mapTeam), "dsa_league_id,id", leagueId);

    // --- Players (bio + roster_status merged) ------------------------------
    // Scoped to non-retired players only -- confirmed via real data that
    // Duud's `players` table carries OOTP's entire real historical MLB
    // player database (143,779 rows total), not just this league's own
    // history the way StatsPlus's TBL export does. 126,341 of those are
    // long-retired real players with no bearing on current gameplay;
    // importing them would balloon every downstream table for no benefit.
    // 17,438 remain (on a roster, a free agent, or draft-eligible) -- a
    // scope comparable to TBL's own live player pool. Flagged to Rees in
    // the writeup; easy to widen later if retired-player lookups ever
    // become a real feature.
    console.log("Reading players + roster status...");
    const { rows: allBioRows } = readDumpTable(dumpDir, "players");
    const bioRows = allBioRows.filter((r) => r.retired === "0");
    console.log(`  ${allBioRows.length} total players in dump, ${bioRows.length} non-retired (importing these)`);
    const { rows: rosterRows } = readDumpTable(dumpDir, "players_roster_status");
    const rosterById = indexBy(rosterRows, "player_id");
    const validPlayerIds = new Set(bioRows.map((r) => r.player_id));

    const mappedPlayers = bioRows.map((bio) => {
      const team = teamById.get(bio.team_id);
      const teamParentId = team ? (int(team.parent_team_id) || null) : null;
      const teamLevel = team ? int(team.level) : null;
      return map.mapPlayer(bio, rosterById.get(bio.player_id), teamParentId, teamLevel);
    });
    await upsertBatched(supabase, "players", mappedPlayers, "dsa_league_id,id", leagueId);

    // --- Contracts + extensions --------------------------------------------
    console.log("Reading contracts...");
    const { rows: contractRows } = readDumpTable(dumpDir, "players_contract");
    const contractRowsInScope = contractRows.filter((r) => validPlayerIds.has(r.player_id));
    await upsertBatched(supabase, "contracts", contractRowsInScope.map(map.mapContract), "dsa_league_id,player_id", leagueId);
    await insertBatched(supabase, "contract_snapshots", contractRowsInScope.map((r) => map.mapContractSnapshot(r, refreshRunId, capturedAt)), leagueId);

    console.log("Reading contract extensions...");
    const { rows: extRows } = readDumpTable(dumpDir, "players_contract_extension");
    const extRowsInScope = extRows.filter((r) => validPlayerIds.has(r.player_id));
    await upsertBatched(supabase, "contract_extensions", extRowsInScope.map(map.mapContractExtension), "dsa_league_id,player_id", leagueId);
    await insertBatched(supabase, "contract_extension_snapshots", extRowsInScope.map((r) => map.mapContractExtensionSnapshot(r, refreshRunId, capturedAt)), leagueId);

    // --- Draft picks (derived from players' own bio fields) ---------------
    console.log("Deriving draft picks from player bio rows...");
    const draftedRows = bioRows.filter((r) => r.picked_in_draft === "1");
    const mappedDraftPicks = draftedRows.map((bio) => {
      const team = teamById.get(bio.draft_team_id);
      return map.mapDraftPick(bio, team ? str(team.name) : null);
    });
    await upsertBatched(supabase, "draft_picks", mappedDraftPicks, "dsa_league_id,player_id", leagueId);

    // --- Player stats snapshots ---------------------------------------------
    console.log("Reading player career batting/pitching/fielding stats (this may take a moment -- large files)...");
    const { rows: battingRowsRaw } = readDumpTable(dumpDir, "players_career_batting_stats");
    const battingRows = dedupeByRealKey(battingRowsRaw.filter((r) => validPlayerIds.has(r.player_id)), ["player_id", "year", "split_id", "team_id", "game_id"], "player_batting_stats_snapshots");
    await insertBatched(supabase, "player_batting_stats_snapshots", battingRows.map((r) => map.mapPlayerBatting(r, refreshRunId, capturedAt)), leagueId);

    const { rows: pitchingRowsRaw } = readDumpTable(dumpDir, "players_career_pitching_stats");
    const pitchingRows = dedupeByRealKey(pitchingRowsRaw.filter((r) => validPlayerIds.has(r.player_id)), ["player_id", "year", "split_id", "team_id", "game_id"], "player_pitching_stats_snapshots");
    await insertBatched(supabase, "player_pitching_stats_snapshots", pitchingRows.map((r) => map.mapPlayerPitching(r, refreshRunId, capturedAt)), leagueId);

    const { rows: fieldingRowsRaw } = readDumpTable(dumpDir, "players_career_fielding_stats");
    const fieldingRows = dedupeByRealKey(fieldingRowsRaw.filter((r) => validPlayerIds.has(r.player_id)), ["player_id", "year", "split_id", "team_id", "position"], "player_fielding_stats_snapshots");
    await insertBatched(supabase, "player_fielding_stats_snapshots", fieldingRows.map((r) => map.mapPlayerFielding(r, refreshRunId, capturedAt)), leagueId);

    // --- Team stats snapshots ------------------------------------------------
    console.log("Reading team batting/pitching stats...");
    const { rows: teamBattingRows } = readDumpTable(dumpDir, "team_batting_stats");
    const teamStatsYear = gameDate ? Number(gameDate.slice(0, 4)) : new Date().getFullYear();
    await insertBatched(
      supabase, "team_batting_stats_snapshots",
      teamBattingRows.map((r) => map.mapTeamBatting(r, refreshRunId, teamStatsYear, capturedAt, teamById.get(r.team_id) ? str(teamById.get(r.team_id)!.abbr) : null)),
      leagueId
    );
    const { rows: teamPitchingRows } = readDumpTable(dumpDir, "team_pitching_stats");
    await insertBatched(
      supabase, "team_pitching_stats_snapshots",
      teamPitchingRows.map((r) => map.mapTeamPitching(r, refreshRunId, teamStatsYear, capturedAt, teamById.get(r.team_id) ? str(teamById.get(r.team_id)!.abbr) : null)),
      leagueId
    );

    // --- Ratings snapshot -----------------------------------------------------
    // Confirmed via real data: EVERY player has multiple scouting-report
    // rows here, not one -- a generic/unaffiliated baseline (scouting_
    // team_id "0") plus a separate report from each org that has scouted
    // them (up to all 30+1, for widely-known players). Our schema stores
    // one rating row per player, so a single point of view has to be
    // chosen. Confirmed with Rees (2026-09-11): always use the White Sox's
    // (his own org's) scouting report for every player -- teammates,
    // rivals, free agents, prospects alike -- matching how a real GM
    // actually experiences the game (everything filtered through YOUR
    // scouts' own accuracy/fog), not a patchwork of whichever org happens
    // to employ each player. Falls back to the generic baseline report for
    // any player the White Sox haven't specifically scouted.
    console.log("Reading scouted ratings (this is the big one -- ~37k rows league-wide)...");
    const { rows: ratingsRows } = readDumpTable(dumpDir, "players_scouted_ratings");
    const ratingsByPlayer = new Map<string, DumpRow>();
    for (const r of ratingsRows) {
      if (!validPlayerIds.has(r.player_id)) continue;
      const isUserTeamView = r.scouting_team_id === USER_TEAM_ID;
      const isGenericBaseline = r.scouting_team_id === "0";
      const existing = ratingsByPlayer.get(r.player_id);
      const existingIsUserTeamView = existing?.scouting_team_id === USER_TEAM_ID;
      if (!existing || (isUserTeamView && !existingIsUserTeamView) || (!existingIsUserTeamView && isGenericBaseline && existing?.scouting_team_id !== "0")) {
        ratingsByPlayer.set(r.player_id, r);
      }
    }
    const ratingsInScope = [...ratingsByPlayer.values()];
    const fromUserTeam = ratingsInScope.filter((r) => r.scouting_team_id === USER_TEAM_ID).length;
    console.log(`  ${ratingsRows.length} total rating rows in dump -> ${ratingsInScope.length} players, ${fromUserTeam} from the White Sox's own scouts, ${ratingsInScope.length - fromUserTeam} from the generic baseline`);
    await insertBatched(supabase, "player_ratings_snapshots", ratingsInScope.map((r) => map.mapPlayerRatings(r, refreshRunId, capturedAt)), leagueId);

    await supabase.from("refresh_runs").update({ status: "succeeded", completed_at: new Date().toISOString() }).eq("id", refreshRunId);
    console.log(`\nDuud dump import (refresh_run ${refreshRunId}) succeeded.`);
  } catch (err) {
    await supabase.from("refresh_runs").update({ status: "failed", completed_at: new Date().toISOString(), notes: String(err) }).eq("id", refreshRunId);
    console.error(`Duud dump import (refresh_run ${refreshRunId}) failed:`, err);
    process.exitCode = 1;
  }
}

main();
