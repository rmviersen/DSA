import "dotenv/config";
import { readFileSync } from "node:fs";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { getLeagueId, leagueSlugFromArgv } from "../lib/league.js";

// Stores the Farm Rankings write-ups (2026-09-18) into org_system_bios -- one
// row per organization, latest generation wins, tagged with the refresh run the
// facts were drawn from so the cards can show the "stale since" note once the
// data moves on (same mechanism as prospect_bios). Input is a JSON object of
// { "<organization_id>": "<write-up text>" } (keys starting with "_" ignored),
// see farm-writeups/ and farm-rankings-writeup-style-guide.md.
//   npx tsx scripts/upsert-org-bios.ts farm-writeups/2032-05-24.json [--run=<refresh_run_id>]
async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) throw new Error("Usage: upsert-org-bios.ts <writeups.json> [--run=<refresh_run_id>]");
  const supabase = makeSupabaseClient();
  const leagueId = await getLeagueId(supabase, leagueSlugFromArgv());
  const runArg = process.argv.find((a) => a.startsWith("--run="));
  let runId = runArg ? Number(runArg.split("=")[1]) : null;
  if (runId === null) {
    const { data } = await supabase.from("player_computed").select("refresh_run_id").eq("dsa_league_id", leagueId).order("refresh_run_id", { ascending: false }).limit(1).single();
    runId = (data as { refresh_run_id: number }).refresh_run_id;
  }
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  const entries = Object.entries(raw).filter(([k]) => !k.startsWith("_"));
  const { data: teams } = await supabase.from("teams").select("id").eq("dsa_league_id", leagueId).is("parent_team_id", null);
  const valid = new Set((teams as { id: number }[]).map((t) => t.id));
  const rows = entries.map(([k, text]) => {
    const orgId = Number(k);
    if (!valid.has(orgId)) throw new Error(`Key ${k} is not a top-level organization in this league.`);
    if (!text || text.trim().length < 50) throw new Error(`Write-up for ${k} is empty/too short.`);
    return { dsa_league_id: leagueId, organization_id: orgId, bio_text: text.trim(), refresh_run_id: runId, generated_at: new Date().toISOString() };
  });
  const { error } = await supabase.from("org_system_bios").upsert(rows as never[], { onConflict: "dsa_league_id,organization_id" });
  if (error) throw new Error(`org_system_bios upsert failed: ${error.message}`);
  console.log(`Upserted ${rows.length} write-ups against refresh_run_id ${runId}.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
