import "dotenv/config";
import { makeStatsPlusClient } from "../lib/statsplus-client.js";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { getLeagueId } from "../lib/league.js";
import * as map from "../lib/mappers.js";

// Lightweight, fast "is anyone new off the board" checker (2026-09-13,
// Rees's ask while live-drafting: "build a process to check the draft page").
// refresh.ts ALREADY pulls draft results every full run via the exact same
// public sp.draft() endpoint (StatsPlus's draftv2 CSV -- confirmed via a
// plain curl, zero auth needed), but a full refresh is a heavy, multi-step
// pull (stats/ratings/etc.) nobody wants to run every few minutes just to see
// who got picked. This script does ONLY the draft_picks half, so it's cheap
// enough to run as often as needed mid-draft.
//
// Real bug this sidesteps: refresh.ts resolves draft_year by reading it back
// off `players.draft_year` -- correct for a COMPLETED draft (that field gets
// set once the league finalizes it), but during a LIVE draft a just-picked
// player's `players.draft_year` isn't populated yet, so refresh.ts's own
// pipeline was silently writing draft_year=0 for in-progress picks (confirmed
// real: 7 rows from the 2026-09-11 refresh, draft_year=0, right as this
// draft started). This script takes the draft year as an explicit --year=
// argument instead (same convention as import-draft-pool.ts) rather than
// trusting a field that isn't populated yet.
//
// Usage: npm run check-draft-picks -- --year=2032

const BATCH_SIZE = 500;

function getArg(name: string): string | undefined {
  const match = process.argv.find((a) => a.startsWith(`--${name}=`));
  return match?.split("=")[1];
}

async function main() {
  const yearArg = getArg("year");
  if (!yearArg) {
    console.error("Usage: npm run check-draft-picks -- --year=2032  (the draft class currently on the clock)");
    process.exit(1);
  }
  const draftYear = Number(yearArg);

  const supabase = makeSupabaseClient();
  const leagueId = await getLeagueId(supabase);
  const sp = makeStatsPlusClient({ baseUrl: process.env.STATSPLUS_BASE_URL! });

  console.log("Fetching current draft results (public draftv2 endpoint, no auth needed)...");
  const draftRows = await sp.draft();
  console.log(`  ${draftRows.length} picks made so far`);

  // Diff against what we already have on file so the summary below only
  // calls out what's NEW since the last check, not the whole board every time.
  const { data: existing } = await supabase
    .from("draft_picks").select("player_id,overall_pick").eq("dsa_league_id", leagueId).eq("draft_year", draftYear);
  const knownOverallPicks = new Set((existing as { overall_pick: number }[] | null)?.map((r) => r.overall_pick) ?? []);

  const mapped = draftRows.map((r) => map.mapDraftPick(r, draftYear));
  for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
    const batch = mapped.slice(i, i + BATCH_SIZE).map((r) => ({ ...r, dsa_league_id: leagueId }));
    const { error } = await supabase.from("draft_picks").upsert(batch as never[], { onConflict: "dsa_league_id,player_id" });
    if (error) throw new Error(`draft_picks upsert failed at row ${i}: ${error.message}`);
  }

  const newPicks = mapped.filter((r) => !knownOverallPicks.has(r.overall_pick));
  console.log(`Done. ${mapped.length} total picks on file for the ${draftYear} class (${newPicks.length} new since last check).`);
  if (newPicks.length > 0) {
    console.log("New since last check:");
    for (const p of newPicks.sort((a, b) => a.overall_pick - b.overall_pick)) {
      console.log(`  ${p.round}-${p.pick_in_round} (#${p.overall_pick}) ${p.team_name}: ${p.position} ${p.player_name}${p.auto_pick ? " (auto pick)" : ""}`);
    }
  }
}

main().catch((err) => {
  console.error("check-draft-picks failed:", err);
  process.exit(1);
});
