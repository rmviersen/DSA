import "dotenv/config";
import { makeStatsPlusClient } from "../lib/statsplus-client.js";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import * as map from "../lib/mappers.js";

const BATCH_SIZE = 500;
const MAX_ATTEMPTS = 3;

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

async function upsertBatched(supabase: ReturnType<typeof makeSupabaseClient>, table: string, rows: unknown[], conflictCols: string) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await withRetry(`${table} upsert (rows ${i}-${i + batch.length})`, async () => {
      const { error } = await supabase.from(table).upsert(batch as never[], { onConflict: conflictCols });
      if (error) throw new Error(`${table} upsert failed: ${error.message}`);
    });
  }
}

async function insertBatched(supabase: ReturnType<typeof makeSupabaseClient>, table: string, rows: unknown[]) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await withRetry(`${table} insert (rows ${i}-${i + batch.length})`, async () => {
      const { error } = await supabase.from(table).insert(batch as never[]);
      if (error) throw new Error(`${table} insert failed: ${error.message}`);
    });
  }
}

// Fixed, league-wide set of level league_ids — confirmed empirically 2026-08-18
// by cross-referencing players.league_id against players.level for every org:
// 200=MLB, 201=AAA, 202=AA, 203/204=A+ (two parallel A+ leagues), 205=A-,
// 206=Rookie. Omitting lid entirely silently scopes stats calls to MLB only —
// there is no "all levels" shortcut, so every level has to be pulled separately.
const LEAGUE_IDS = [200, 201, 202, 203, 204, 205, 206];

async function main() {
  const skipRatings = process.argv.includes("--skip-ratings");
  // Narrow default on purpose — a full 2001-present backfill is a lot of sequential
  // requests against someone else's server. Widen with YEARS=2001,2002,...,2031 once
  // the narrow run is proven out.
  const years = process.env.YEARS ? process.env.YEARS.split(",").map(Number) : [2029, 2030, 2031];

  const supabase = makeSupabaseClient();
  const sp = makeStatsPlusClient({
    baseUrl: process.env.STATSPLUS_BASE_URL!,
    sessionId: process.env.STATSPLUS_SESSION_ID,
    csrfToken: process.env.STATSPLUS_CSRF_TOKEN,
  });

  console.log(`Starting refresh — years: ${years.join(", ")}, ratings/game-history: ${!skipRatings && sp.hasSession()}`);

  const { data: run, error: runErr } = await supabase
    .from("refresh_runs")
    .insert({ status: "running", ratings_included: !skipRatings && sp.hasSession() })
    .select()
    .single();
  if (runErr || !run) throw new Error(`Could not start refresh_run: ${runErr?.message}`);
  const refreshRunId = run.id as number;
  const capturedAt = new Date().toISOString();

  try {
    console.log("Pulling teams...");
    await upsertBatched(supabase, "teams", (await sp.teams()).map(map.mapTeam), "id");

    console.log("Pulling players...");
    await upsertBatched(supabase, "players", (await sp.players()).map(map.mapPlayer), "id");

    console.log("Pulling contracts...");
    await upsertBatched(supabase, "contracts", (await sp.contracts()).map(map.mapContract), "player_id");

    console.log("Pulling contract extensions...");
    await upsertBatched(supabase, "contract_extensions", (await sp.contractExtensions()).map(map.mapContractExtension), "player_id");

    console.log("Pulling draft results...");
    await upsertBatched(supabase, "draft_picks", (await sp.draft()).map(map.mapDraftPick), "player_id");

    for (const year of years) {
      for (const lid of LEAGUE_IDS) {
        console.log(`Pulling player batting/pitching/fielding stats for ${year}, league ${lid}...`);
        await insertBatched(supabase, "player_batting_stats_snapshots", (await sp.playerBatting(year, lid)).map((r) => map.mapPlayerBatting(r, refreshRunId, capturedAt)));
        await insertBatched(supabase, "player_pitching_stats_snapshots", (await sp.playerPitching(year, lid)).map((r) => map.mapPlayerPitching(r, refreshRunId, capturedAt)));
        await insertBatched(supabase, "player_fielding_stats_snapshots", (await sp.playerFielding(year, lid)).map((r) => map.mapPlayerFielding(r, refreshRunId, capturedAt)));
      }

      // Unlike the player endpoints, teambatstats/teampitchstats ignore `lid`
      // entirely (confirmed 2026-08-18 — identical response with or without
      // it) and only ever return MLB-level teams. One call per year covers it;
      // looping over LEAGUE_IDS here just re-inserts the same rows and
      // violates the unique constraint on the second pass.
      console.log(`Pulling team batting/pitching stats for ${year}...`);
      await insertBatched(supabase, "team_batting_stats_snapshots", (await sp.teamBatting(year)).map((r) => map.mapTeamBatting(r, refreshRunId, year, capturedAt)));
      await insertBatched(supabase, "team_pitching_stats_snapshots", (await sp.teamPitching(year)).map((r) => map.mapTeamPitching(r, refreshRunId, year, capturedAt)));
    }

    if (!skipRatings && sp.hasSession()) {
      console.log("Pulling game history...");
      await upsertBatched(supabase, "game_results", (await sp.gameHistory()).map((r) => map.mapGameResult(r, refreshRunId)), "statsplus_game_id");

      console.log("Pulling ratings (async job — this can take a few minutes)...");
      await insertBatched(supabase, "player_ratings_snapshots", (await sp.ratings()).map((r) => map.mapPlayerRatings(r, refreshRunId, capturedAt)));
    } else {
      console.log("Skipping ratings/game history — no session cookies provided (or --skip-ratings passed).");
    }

    await supabase.from("refresh_runs").update({ status: "succeeded", completed_at: new Date().toISOString() }).eq("id", refreshRunId);
    console.log(`Refresh run ${refreshRunId} succeeded.`);
  } catch (err) {
    await supabase.from("refresh_runs").update({ status: "failed", completed_at: new Date().toISOString(), notes: String(err) }).eq("id", refreshRunId);
    console.error(`Refresh run ${refreshRunId} failed:`, err);
    process.exitCode = 1;
  }
}

main();
