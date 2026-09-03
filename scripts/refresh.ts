import "dotenv/config";
import { execFileSync } from "node:child_process";
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
// by cross-referencing players.league_id against players.level for every org.
// CORRECTED 2026-09-04: 203/204 were originally assumed to be "two parallel
// A+ leagues" -- they're actually two genuinely DIFFERENT real levels (203=
// A+, 204=A) that both happen to share players.level=4, discovered when Rees
// named real OKC affiliates (Wellington=A+=203, Napanee=A=204). See
// display-helpers.ts's effectiveLevel for the full finding and every
// consumer that needed fixing. 200=MLB, 201=AAA, 202=AA, 203=A+, 204=A,
// 205=A-, 206=Rookie. Omitting lid entirely silently scopes stats calls to
// MLB only — there is no "all levels" shortcut, so every level has to be
// pulled separately (this list itself was already correct -- all 7 IDs
// were already being pulled -- only the comment's characterization of what
// 203/204 represent was wrong).
const LEAGUE_IDS = [200, 201, 202, 203, 204, 205, 206];

async function main() {
  const skipRatings = process.argv.includes("--skip-ratings");

  const supabase = makeSupabaseClient();
  const sp = makeStatsPlusClient({
    baseUrl: process.env.STATSPLUS_BASE_URL!,
    apiToken: process.env.STATSPLUS_API_TOKEN,
    sessionId: process.env.STATSPLUS_SESSION_ID,
    csrfToken: process.env.STATSPLUS_CSRF_TOKEN,
  });

  // All-or-nothing gate: unless the caller explicitly opted into a public-data-only
  // run (--skip-ratings), a refresh should never proceed on stale/missing session
  // cookies and silently end up "succeeded" with ratings/game-history quietly
  // missing. Validate the session BEFORE writing anything — not even a refresh_runs
  // row — by actually pulling game history (session-gated, and data we need anyway,
  // so nothing is wasted). Any failure here (missing cookies, expired session,
  // unexpected response) aborts the whole run before it starts.
  const wantsRatings = !skipRatings;
  let gameHistoryRows: Awaited<ReturnType<typeof sp.gameHistory>> | null = null;
  if (wantsRatings) {
    if (!sp.hasSession()) {
      console.error(
        "Refresh aborted before writing anything: no auth configured (STATSPLUS_API_TOKEN, or the older " +
          "STATSPLUS_SESSION_ID/STATSPLUS_CSRF_TOKEN pair, are missing from .env). " +
          "Pass --skip-ratings for a public-data-only refresh."
      );
      process.exitCode = 1;
      return;
    }
    console.log("Validating StatsPlus auth (all-or-nothing: won't write anything unless this succeeds)...");
    try {
      gameHistoryRows = await sp.gameHistory();
      console.log(`Auth valid — game history pull returned ${gameHistoryRows.length} rows.`);
    } catch (err) {
      console.error(
        `Refresh aborted before writing anything: StatsPlus auth validation failed (${err}). ` +
          "If using STATSPLUS_API_TOKEN, it may have expired (~90 days) and needs regenerating from the account " +
          "Preferences page; if using session cookies, ask Rees for a fresh one, or pass --skip-ratings for a " +
          "public-data-only refresh."
      );
      process.exitCode = 1;
      return;
    }
  }

  console.log(`Starting refresh — ratings/game-history: ${wantsRatings}`);

  const { data: run, error: runErr } = await supabase
    .from("refresh_runs")
    .insert({ status: "running", ratings_included: wantsRatings })
    .select()
    .single();
  if (runErr || !run) throw new Error(`Could not start refresh_run: ${runErr?.message}`);
  const refreshRunId = run.id as number;
  const capturedAt = new Date().toISOString();

  try {
    // No-auth, cookie-independent source of "what day is it in the league" —
    // unlike gamehistory's game_date (session-gated), this works every run
    // regardless of whether STATSPLUS_SESSION_ID/CSRF_TOKEN are still valid.
    console.log("Pulling current in-game date...");
    const gameDate = await sp.currentGameDate();
    console.log(`League game date as of this refresh: ${gameDate ?? "(not found)"}`);
    await supabase.from("refresh_runs").update({ game_date: gameDate }).eq("id", refreshRunId);

    // Stats years to pull -- past seasons are finished and don't change, so a
    // normal refresh only needs the CURRENT in-game season (derived from the
    // game date above), not every year on every run. Rees flagged 2026-08-21
    // that re-pulling already-final seasons (e.g. 2029/2030 once the league
    // had moved on to 2031) was pure repeated work once those seasons were
    // fully backfilled once. Override with YEARS=2001,2002,...,2031 for a
    // one-off historical re-pull/backfill; otherwise this always tracks
    // "whatever season the league is actually in right now," no matter how
    // many seasons pass.
    const currentSeasonYear = gameDate ? Number(gameDate.slice(0, 4)) : null;
    const years = process.env.YEARS
      ? process.env.YEARS.split(",").map(Number)
      : currentSeasonYear
        ? [currentSeasonYear]
        : [2029, 2030, 2031]; // defensive fallback only if the game date couldn't be read at all
    console.log(`Pulling stats for year(s): ${years.join(", ")}`);

    console.log("Pulling teams...");
    await upsertBatched(supabase, "teams", (await sp.teams()).map(map.mapTeam), "id");

    console.log("Pulling players...");
    await upsertBatched(supabase, "players", (await sp.players()).map(map.mapPlayer), "id");

    console.log("Pulling contracts...");
    {
      const rows = await sp.contracts();
      await upsertBatched(supabase, "contracts", rows.map(map.mapContract), "player_id");
      // Also append to the history table (2026-08-31, Rees's ask) -- same raw
      // rows, no second fetch. Trade-value analysis needs "what did this
      // contract look like at the time," which the current-state table above
      // can never answer since it's overwritten every refresh.
      await insertBatched(supabase, "contract_snapshots", rows.map((r) => map.mapContractSnapshot(r, refreshRunId, capturedAt)));
    }

    console.log("Pulling contract extensions...");
    {
      const rows = await sp.contractExtensions();
      await upsertBatched(supabase, "contract_extensions", rows.map(map.mapContractExtension), "player_id");
      await insertBatched(supabase, "contract_extension_snapshots", rows.map((r) => map.mapContractExtensionSnapshot(r, refreshRunId, capturedAt)));
    }

    console.log("Pulling draft results...");
    {
      const draftRows = await sp.draft();
      // draft_year resolved from players.draft_year (2026-08-30 fix) --
      // NOT derived from the pick's own "Time (UTC)" field, which is a
      // real-world capture timestamp, not the in-game draft year (see
      // mapDraftPick's comment). players was just upserted above in this
      // same run, so this reads back the fresh values, not stale ones.
      const draftPlayerIds = draftRows.map((r) => Number(r["ID"])).filter((id) => Number.isFinite(id));
      const draftYearByPlayerId = new Map<number, number | null>();
      for (let i = 0; i < draftPlayerIds.length; i += BATCH_SIZE) {
        const chunk = draftPlayerIds.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabase.from("players").select("id,draft_year").in("id", chunk);
        if (error) throw new Error(`players lookup for draft_picks failed: ${error.message}`);
        (data as { id: number; draft_year: number | null }[]).forEach((p) => draftYearByPlayerId.set(p.id, p.draft_year));
      }
      const mapped = draftRows.map((r) => map.mapDraftPick(r, draftYearByPlayerId.get(Number(r["ID"])) ?? null));
      await upsertBatched(supabase, "draft_picks", mapped, "player_id");
    }

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

    if (wantsRatings) {
      console.log("Storing game history (already pulled during cookie validation above)...");
      await upsertBatched(supabase, "game_results", gameHistoryRows!.map((r) => map.mapGameResult(r, refreshRunId)), "statsplus_game_id");

      console.log("Pulling ratings (async job — this can take a few minutes)...");
      await insertBatched(supabase, "player_ratings_snapshots", (await sp.ratings()).map((r) => map.mapPlayerRatings(r, refreshRunId, capturedAt)));
    } else {
      console.log("Skipping ratings/game history — --skip-ratings passed.");
    }

    // Player category snapshot (2026-08-28, Admin Dashboard) -- players is
    // current-state only (upserted, not versioned per run), so this is taken
    // right at the end of this refresh, against the just-upserted data, and
    // stored directly on refresh_runs -- the only way to see this breakdown
    // historically later. Verified against real data before this was wired
    // in: these 6 buckets are a clean, non-overlapping partition of every
    // row in `players` (summed to the exact total player count with nothing
    // left over). draft_pool_count is the broad, multi-year draft_eligible
    // flag, NOT one class's exact membership -- see the migration comment.
    console.log("Computing player category snapshot...");
    async function playerCount(build: (q: ReturnType<typeof supabase.from<"players">>) => PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
      const { count, error } = await build(supabase.from("players"));
      if (error) throw error;
      return count ?? 0;
    }
    const mlbCount = await playerCount((q) => q.select("*", { count: "exact", head: true }).eq("level", 1).gte("league_id", 0).neq("retired", true).neq("free_agent", true));
    const minorLeagueCount = await playerCount((q) => q.select("*", { count: "exact", head: true }).gte("level", 2).lte("level", 6).neq("retired", true).neq("free_agent", true));
    const internationalCount = await playerCount((q) => q.select("*", { count: "exact", head: true }).eq("level", 1).lt("league_id", 0).neq("retired", true).neq("free_agent", true));
    // Bug found 2026-08-28 via the first real run: retired players ALSO
    // have free_agent=true (confirmed directly against real data), so these
    // two need the same .neq("retired", true) guard the three roster
    // buckets above already had -- without it, all 31,945 retired players
    // leaked into free_agent_count (34,430 instead of the real ~2,485).
    // draft_pool_count happened to come out right anyway (no retired row
    // currently has draft_eligible=true), but the guard belongs here too --
    // relying on that coincidence would be a real, if currently-invisible, bug.
    const draftPoolCount = await playerCount((q) => q.select("*", { count: "exact", head: true }).eq("free_agent", true).eq("draft_eligible", true).neq("retired", true));
    const freeAgentCount = await playerCount((q) => q.select("*", { count: "exact", head: true }).eq("free_agent", true).eq("draft_eligible", false).neq("retired", true));
    const retiredCount = await playerCount((q) => q.select("*", { count: "exact", head: true }).eq("retired", true));
    console.log(`  MLB ${mlbCount}, Minors ${minorLeagueCount}, Int'l ${internationalCount}, Draft pool ${draftPoolCount}, Free agents ${freeAgentCount}, Retired ${retiredCount}`);

    await supabase.from("refresh_runs").update({
      status: "succeeded",
      completed_at: new Date().toISOString(),
      mlb_count: mlbCount,
      minor_league_count: minorLeagueCount,
      international_count: internationalCount,
      draft_pool_count: draftPoolCount,
      free_agent_count: freeAgentCount,
      retired_count: retiredCount,
    }).eq("id", refreshRunId);
    console.log(`Refresh run ${refreshRunId} succeeded.`);

    // Point-in-time player_snapshots (2026-09-02, Rees's ask -- "run as a
    // snapshot going forward" for accurate historical reference). Captures
    // org/age/level/service-days/league_id/active-roster/last-team as they
    // stand right now, before anything derived gets computed from them.
    console.log("Snapshotting player state for this run...");
    try {
      execFileSync("npx", ["tsx", "scripts/snapshot-players.ts"], { stdio: "inherit", shell: true });
    } catch (err) {
      console.error(`snapshot-players.ts failed after a successful refresh -- raw data is fine, but this run's player_snapshots wasn't captured: ${err}`);
      process.exitCode = 1;
    }

    // Every refresh should leave behind a dated player_computed/team_computed
    // snapshot -- that's the whole prerequisite for "change since date X"
    // reports. Previously this was a separate manual step run occasionally,
    // so real history barely existed. Failure here doesn't roll back the raw
    // ingestion (it genuinely succeeded) but does flag the process as failed
    // so it doesn't look like a silent no-op.
    console.log("Computing player ratings for this run...");
    try {
      // shell:true is required on Windows -- npx resolves to npx.cmd, a batch
      // file, which execFileSync can't invoke directly without going through
      // a shell. Without this it fails with ENOENT even though npx is on
      // PATH and works fine from an interactive terminal. Confirmed
      // 2026-08-20: this exact bug let a real refresh (run 10) succeed on
      // raw data while silently leaving no computed snapshot behind.
      execFileSync("npx", ["tsx", "scripts/compute-ratings.ts"], { stdio: "inherit", shell: true });
    } catch (err) {
      console.error(`compute-ratings.ts failed after a successful refresh -- raw data is fine, but no fresh player_computed snapshot was produced: ${err}`);
      process.exitCode = 1;
    }
    console.log("Computing team ratings for this run...");
    try {
      execFileSync("npx", ["tsx", "scripts/compute-team-ratings.ts"], { stdio: "inherit", shell: true });
    } catch (err) {
      console.error(`compute-team-ratings.ts failed after a successful refresh -- raw data is fine, but no fresh team_computed snapshot was produced: ${err}`);
      process.exitCode = 1;
    }

    // Role-calibrated fielding weight (2026-08-31) -- reads the
    // player_computed/rating snapshot this run JUST wrote, so its output
    // (fielding_role_weights) is naturally one refresh behind: this run's
    // numbers get picked up by compute-ratings.ts on the NEXT refresh, not
    // this one. Same lag already accepted for contracts vs. ratings.
    console.log("Computing role-calibrated fielding weights for this run...");
    try {
      execFileSync("npx", ["tsx", "scripts/compute-fielding-weights.ts"], { stdio: "inherit", shell: true });
    } catch (err) {
      console.error(`compute-fielding-weights.ts failed after a successful refresh -- raw data is fine, but fielding_role_weights wasn't refreshed this run: ${err}`);
      process.exitCode = 1;
    }

    // Ballpark factors (2026-09-01) -- StatsPlus only publishes CURRENT
    // factors (confirmed: no year selector, no per-season history anywhere
    // on the site), so this is a snapshot-forward-only capture, same as
    // every other snapshot table -- accurate from here on, not
    // retroactively fixable for seasons before this existed.
    console.log("Capturing ballpark factors for this run...");
    try {
      execFileSync("npx", ["tsx", "scripts/scrape-ballpark-factors.ts"], { stdio: "inherit", shell: true });
    } catch (err) {
      console.error(`scrape-ballpark-factors.ts failed after a successful refresh -- raw data is fine, but this run's ballpark_factor_snapshots wasn't captured: ${err}`);
      process.exitCode = 1;
    }

    // Weight-tuning regressions (2026-09-02, "visualize and track our
    // regressions" -- /admin/weight-tuning). Each writes its own
    // weight_tuning_runs/weight_tuning_coefficients row tagged to THIS
    // refresh_run_id, independent try/catch per script so one failing
    // doesn't block the others or the rest of the refresh.
    console.log("Computing hitting weight-tuning regression for this run...");
    try {
      execFileSync("npx", ["tsx", "scripts/compute-hitting-weights.ts"], { stdio: "inherit", shell: true });
    } catch (err) {
      console.error(`compute-hitting-weights.ts failed after a successful refresh -- raw data is fine, but this run's hitting regression wasn't saved: ${err}`);
      process.exitCode = 1;
    }
    console.log("Computing baserunning weight-tuning regression for this run...");
    try {
      execFileSync("npx", ["tsx", "scripts/compute-baserunning-weights.ts"], { stdio: "inherit", shell: true });
    } catch (err) {
      console.error(`compute-baserunning-weights.ts failed after a successful refresh -- raw data is fine, but this run's baserunning regression wasn't saved: ${err}`);
      process.exitCode = 1;
    }
    console.log("Computing pitching weight-tuning regression for this run...");
    try {
      execFileSync("npx", ["tsx", "scripts/compute-pitching-weights.ts"], { stdio: "inherit", shell: true });
    } catch (err) {
      console.error(`compute-pitching-weights.ts failed after a successful refresh -- raw data is fine, but this run's pitching regression wasn't saved: ${err}`);
      process.exitCode = 1;
    }
    console.log("Computing Batting/Fielding/Baserunning blend weight-tuning regression for this run...");
    try {
      execFileSync("npx", ["tsx", "scripts/compute-overall-blend-weights.ts"], { stdio: "inherit", shell: true });
    } catch (err) {
      console.error(`compute-overall-blend-weights.ts failed after a successful refresh -- raw data is fine, but this run's overall-blend regression wasn't saved: ${err}`);
      process.exitCode = 1;
    }
    console.log("Computing Fielding-vs-defensive-innings reference regression for this run...");
    try {
      execFileSync("npx", ["tsx", "scripts/compute-fielding-defensive-weights.ts"], { stdio: "inherit", shell: true });
    } catch (err) {
      console.error(`compute-fielding-defensive-weights.ts failed after a successful refresh -- raw data is fine, but this run's fielding-defensive regression wasn't saved: ${err}`);
      process.exitCode = 1;
    }

    // Trade-value engine, market-rate piece (2026-08-31) -- accumulates any
    // newly-signed clean free-agent contracts into market_rate_training_
    // contracts. Cheap and append-only (a no-op for a contract already on
    // file), so it's safe to run every refresh rather than on its own
    // separate cadence.
    console.log("Scanning for new clean market-rate contracts...");
    try {
      execFileSync("npx", ["tsx", "scripts/scan-market-contracts.ts"], { stdio: "inherit", shell: true });
    } catch (err) {
      console.error(`scan-market-contracts.ts failed after a successful refresh -- raw data is fine, but this run's contracts weren't scanned into the training pool: ${err}`);
      process.exitCode = 1;
    }

    // Trade block + trade history (2026-09-04) -- previously manual-only, so
    // both had gone stale (trade block hadn't been re-scraped since it was
    // built; the trade ledger was missing everything traded since). Both
    // scripts are idempotent (upsert on refresh_run_id+player_id / trade_key
    // respectively) and cheap (one page fetch each), so it's safe to run them
    // every refresh rather than inventing a separate cadence for them.
    console.log("Scraping the trade block...");
    try {
      execFileSync("npx", ["tsx", "scripts/scrape-trade-block.ts"], { stdio: "inherit", shell: true });
    } catch (err) {
      console.error(`scrape-trade-block.ts failed after a successful refresh -- raw data is fine, but this run's trade_block_snapshots wasn't captured: ${err}`);
      process.exitCode = 1;
    }
    console.log("Scraping trade history...");
    try {
      execFileSync("npx", ["tsx", "scripts/scrape-trade-history.ts"], { stdio: "inherit", shell: true });
    } catch (err) {
      console.error(`scrape-trade-history.ts failed after a successful refresh -- raw data is fine, but new trades since the last scrape weren't captured: ${err}`);
      process.exitCode = 1;
    }
  } catch (err) {
    await supabase.from("refresh_runs").update({ status: "failed", completed_at: new Date().toISOString(), notes: String(err) }).eq("id", refreshRunId);
    console.error(`Refresh run ${refreshRunId} failed:`, err);
    process.exitCode = 1;
  }
}

main();
