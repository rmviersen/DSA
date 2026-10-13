import "dotenv/config";
import { appendFileSync } from "node:fs";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { makeStatsPlusClient } from "../lib/statsplus-client.js";
import { getLeagueId } from "../lib/league.js";
import { diffPlayerFeedAgainstDb } from "../lib/sim-data-ready.js";

// GitHub Actions' own detector (2026-08-28), replacing the earlier
// Slack-polling design entirely -- see HANDOFF.md for the full rationale.
// Compares StatsPlus's real current in-game date (a public, no-auth
// endpoint -- no token needed here) against the latest SUCCEEDED refresh's
// game_date already in Supabase. Writes `new_data`/`game_date` to
// $GITHUB_OUTPUT so the calling workflow can skip the rest of the job on a
// quiet tick, which is most of them. This script never writes to Supabase or
// StatsPlus -- read-only on both sides, safe to run as often as the
// schedule fires.
async function main() {
  const supabase = makeSupabaseClient();
  // apiToken is only needed for the published-data check below (the /players/ feed); the date endpoint is public.
  const sp = makeStatsPlusClient({ baseUrl: process.env.STATSPLUS_BASE_URL!, apiToken: process.env.STATSPLUS_API_TOKEN });

  const { data, error } = await supabase
    .from("refresh_runs")
    .select("game_date")
    .eq("status", "succeeded")
    .not("game_date", "is", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const lastGameDate = (data as { game_date: string } | null)?.game_date ?? null;

  const currentGameDate = await sp.currentGameDate();

  console.log(`Last successfully refreshed game date: ${lastGameDate ?? "(none)"}`);
  console.log(`StatsPlus current game date:            ${currentGameDate ?? "(unknown)"}`);

  // Plain string comparison is safe here -- game_date is always YYYY-MM-DD,
  // which sorts lexicographically the same as chronologically.
  const dateAdvanced = Boolean(currentGameDate && (!lastGameDate || currentGameDate > lastGameDate));
  let newData = dateAdvanced;

  // Published-data gate (2026-10-13, Rees). StatsPlus's current_date moves when the commissioner uploads the league FILE,
  // ~80 minutes before StatsPlus finishes PUBLISHING the sim. Refreshing in that gap pulled the previous sim's data stamped
  // with the new date (run 132 == run 131, player for player), and because the date then matched, nothing re-pulled it.
  // So a new date only counts once the public /players/ feed also differs from the player data we already hold -- between
  // two sims something always moves, so "identical" means "not published yet" and the next tick (30 min) tries again.
  // Only runs when the date advanced, so quiet ticks stay as cheap as before. No token (or no prior refresh to compare
  // against) -> proceed as before rather than block forever; the refresh itself needs the token anyway.
  if (dateAdvanced && lastGameDate && process.env.STATSPLUS_API_TOKEN) {
    const leagueId = await getLeagueId(supabase);
    const feed = await sp.players();
    const diff = await diffPlayerFeedAgainstDb(supabase, leagueId, feed);
    console.log(`Published-data check: ${diff.changed} of ${diff.checked} players differ from the last refresh${diff.sample.length ? ` (e.g. ${diff.sample.join("; ")})` : ""}`);
    if (diff.changed === 0) {
      newData = false;
      console.log("Date advanced but the player feed is identical to what we already hold -- StatsPlus has not published this sim yet. Waiting for the next tick.");
    }
  } else if (dateAdvanced && lastGameDate) {
    console.warn("STATSPLUS_API_TOKEN not set -- skipping the published-data check (date alone decides).");
  }
  console.log(`New data available: ${newData}`);

  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    appendFileSync(outputPath, `new_data=${newData}\n`);
    appendFileSync(outputPath, `game_date=${currentGameDate ?? ""}\n`);
  }
}

main().catch((err) => {
  console.error("check-new-sim failed:", err);
  process.exit(1);
});
