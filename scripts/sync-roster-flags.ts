import "dotenv/config";
import { makeStatsPlusClient } from "../lib/statsplus-client.js";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { getLeagueId } from "../lib/league.js";
import * as map from "../lib/mappers.js";

// Roster-status sync (2026-10-13, Rees: the Rule 5 board listed players who had just been added to the 40-man).
//
// Everything on the site is a snapshot from the last full refresh (scripts/refresh.ts), but GMs move players constantly
// between sims -- protecting prospects before the Rule 5 draft, releasing, promoting, signing free agents. This script
// closes that gap WITHOUT a full refresh and WITHOUT StatsPlus session cookies: it reads StatsPlus's public /players/
// list, finds players whose roster-status fields differ from our `players` table, and rewrites ONLY those rows using
// the exact same mapper (`mapPlayer`) the full refresh uses -- so a synced row is identical to what the next refresh
// would have written for it. Nothing else is touched (no ratings, stats, contracts, or snapshots).
//
// Safety:
//  - never inserts players we don't already have (a brand-new player needs the full refresh's ratings/stats pull);
//  - never touches players absent from the feed;
//  - aborts, writing nothing, if the feed looks truncated (fewer than 95% of the players we hold);
//  - `--dry-run` reports what would change and writes nothing.
// TBL only (StatsPlus-fed), same as refresh.ts. Run it any time: `npm run sync-roster-flags`.

// The fields whose change means "this player's roster situation moved".
const WATCHED = [
  "team_id", "parent_team_id", "level", "league_id", "organization_id",
  "is_active", "is_on_secondary", "is_on_waivers", "designated_for_assignment", "is_on_dl", "is_on_dl60",
  "free_agent", "last_team_id", "retired",
] as const;

const BATCH_SIZE = 500;
const MIN_FEED_FRACTION = 0.95;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const supabase = makeSupabaseClient();
  const leagueId = await getLeagueId(supabase);
  const sp = makeStatsPlusClient({ baseUrl: process.env.STATSPLUS_BASE_URL!, apiToken: process.env.STATSPLUS_API_TOKEN });

  console.log("Pulling StatsPlus player list...");
  const feed = await sp.players();
  const gameDate = await sp.currentGameDate().catch(() => null);

  console.log("Reading current roster fields from the database...");
  const db = new Map<number, Record<string, unknown>>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("players").select(["id", ...WATCHED].join(",")).eq("dsa_league_id", leagueId).order("id").range(from, from + 999);
    if (error) throw new Error(`players read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as unknown as Record<string, unknown>[]) db.set(r.id as number, r);
    if (data.length < 1000) break;
  }
  if (feed.length < db.size * MIN_FEED_FRACTION) {
    throw new Error(`StatsPlus returned ${feed.length} players but the database holds ${db.size} -- the feed looks truncated. Aborting, nothing written.`);
  }

  const changed: Record<string, unknown>[] = [];
  const changeCounts = new Map<string, number>();
  let skippedNew = 0;
  for (const raw of feed) {
    const mapped = map.mapPlayer(raw) as Record<string, unknown>;
    const existing = db.get(mapped.id as number);
    if (!existing) { skippedNew++; continue; }
    const diffFields = WATCHED.filter((f) => (existing[f] ?? null) !== (mapped[f] ?? null));
    if (diffFields.length === 0) continue;
    diffFields.forEach((f) => changeCounts.set(f, (changeCounts.get(f) ?? 0) + 1));
    changed.push(mapped);
  }
  console.log(`${feed.length} players in feed, ${changed.length} with changed roster status${skippedNew ? ` (${skippedNew} brand-new players skipped -- the next full refresh adds them)` : ""}.`);
  for (const [f, n] of [...changeCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${f}: ${n}`);

  if (dryRun) { console.log("--dry-run: nothing written."); return; }

  for (let i = 0; i < changed.length; i += BATCH_SIZE) {
    const batch = changed.slice(i, i + BATCH_SIZE).map((r) => ({ ...r, dsa_league_id: leagueId }));
    const { error } = await supabase.from("players").upsert(batch as never[], { onConflict: "dsa_league_id,id" });
    if (error) throw new Error(`players upsert failed (rows ${i}-${i + batch.length}): ${error.message}`);
  }
  const { error: logErr } = await supabase.from("roster_syncs").insert({
    dsa_league_id: leagueId, game_date: gameDate, players_in_feed: feed.length, players_changed: changed.length,
  } as never);
  if (logErr) throw new Error(`roster_syncs insert failed (the player updates DID apply): ${logErr.message}`);
  console.log(`Done -- ${changed.length} players updated; sync recorded${gameDate ? ` (game date ${gameDate})` : ""}.`);
}

main().catch((err) => {
  console.error("sync-roster-flags failed:", err);
  process.exit(1);
});
