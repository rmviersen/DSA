import "dotenv/config";
import { appendFileSync } from "node:fs";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { makeStatsPlusClient } from "../lib/statsplus-client.js";

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
  const sp = makeStatsPlusClient({ baseUrl: process.env.STATSPLUS_BASE_URL! });

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
  const newData = Boolean(currentGameDate && (!lastGameDate || currentGameDate > lastGameDate));
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
