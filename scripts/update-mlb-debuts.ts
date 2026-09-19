import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { getLeagueId, leagueSlugFromArgv, getCurrentSeasonYear } from "../lib/league.js";

// Keeps player_mlb_debut (first MLB season per player) current -- feeds the Work
// Ethic vs. reaching-the-majors report (2026-09-19). Default: just the current
// season (cheap; run every refresh from refresh.ts). Backfill / repair:
//   npx tsx scripts/update-mlb-debuts.ts --years=2001-2032
async function main() {
  const supabase = makeSupabaseClient();
  const leagueId = await getLeagueId(supabase, leagueSlugFromArgv());
  const yearsArg = process.argv.find((a) => a.startsWith("--years="))?.split("=")[1];
  let years: number[];
  if (yearsArg) {
    const [a, b] = yearsArg.split("-").map(Number);
    years = Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i);
  } else {
    years = [await getCurrentSeasonYear(supabase, leagueId)];
  }
  for (const year of years) {
    const { data, error } = await supabase.rpc("update_player_mlb_debut", { p_league_id: leagueId, p_year: year } as never);
    if (error) throw new Error(`update_player_mlb_debut(${year}) failed: ${error.message}`);
    console.log(`${year}: ${data} MLB players seen`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
