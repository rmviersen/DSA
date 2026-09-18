import "dotenv/config";
import * as cheerio from "cheerio";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { getLeagueId } from "../lib/league.js";

// MLB standings snapshot (2026-09-18, Rees's ask -- Farm Rankings shows each
// team's record and division position, e.g. "27-21, 4th in the FC Topaz").
// StatsPlus has NO standings endpoint in its JSON/CSV API (probed: standings,
// teamstandings, division(s), league(s), conferences, teaminfo -- all 404), only
// the server-rendered, public page https://.../thebigleague/standings/, so this
// parses it like scrape-ballpark-factors.ts parses /ballparks/. One table per
// division under a heading like "Fire Conference Topaz Division"; rows are
// already in standings order, so division_rank is just the row's position.
// Team ids come from each row's /thebigleague/team/{id} link (same ids as our
// teams.id).

const STANDINGS_URL = "https://atl-02.statsplus.net/thebigleague/standings/";

interface StandingRow { teamId: number; wins: number; losses: number; divisionName: string; divisionRank: number }

export function parseStandingsHtml(html: string): StandingRow[] {
  const $ = cheerio.load(html);
  const out: StandingRow[] = [];
  // Division headings ("... Division") are <th colspan> rows that can share ONE
  // table with several divisions' team rows, so walk every row in document order
  // and start a new division (rank back to 0) at each heading row.
  let division: string | null = null;
  let rank = 0;
  $("tr").each((_, tr) => {
    const $tr = $(tr);
    const heading = $tr.find("th[colspan]").first().text().trim();
    if (/Division$/.test(heading)) { division = heading; rank = 0; return; }
    if (!division) return;
    const href = $tr.find("a[href*='/team/']").first().attr("href");
    const id = href?.match(/\/team\/(\d+)/)?.[1];
    const cells = $tr.find("> td");
    const wins = Number($(cells[1]).text().trim());
    const losses = Number($(cells[2]).text().trim());
    if (!id || !Number.isFinite(wins) || !Number.isFinite(losses)) return; // skip malformed rows rather than guessing
    rank++;
    out.push({ teamId: Number(id), wins, losses, divisionName: division, divisionRank: rank });
  });
  return out;
}

export async function scrapeStandings(refreshRunId: number, leagueId: number, supabase = makeSupabaseClient()): Promise<number> {
  const res = await fetch(STANDINGS_URL);
  if (!res.ok) throw new Error(`Standings page fetch failed: ${res.status}`);
  const rows = parseStandingsHtml(await res.text());
  if (rows.length < 20) throw new Error(`Only parsed ${rows.length} standings rows -- page layout likely changed, refusing to write.`);
  const { error } = await supabase.from("team_standings_snapshots").upsert(
    rows.map((r) => ({ dsa_league_id: leagueId, refresh_run_id: refreshRunId, team_id: r.teamId, wins: r.wins, losses: r.losses, division_name: r.divisionName, division_rank: r.divisionRank })) as never[],
    { onConflict: "refresh_run_id,team_id" }
  );
  if (error) throw new Error(`team_standings_snapshots upsert failed: ${error.message}`);
  return rows.length;
}

async function main() {
  const supabase = makeSupabaseClient();
  const leagueId = await getLeagueId(supabase);
  const { data: runRow, error } = await supabase.from("refresh_runs").select("id").eq("dsa_league_id", leagueId).order("id", { ascending: false }).limit(1).single();
  if (error || !runRow) throw new Error(`No refresh_runs found: ${error?.message}`);
  const refreshRunId = (runRow as { id: number }).id;
  console.log(`Fetching standings, tagging as refresh_run_id ${refreshRunId}...`);
  console.log(`Wrote ${await scrapeStandings(refreshRunId, leagueId, supabase)} team rows.`);
}

if (process.argv[1]?.includes("scrape-standings")) {
  main().catch((err) => { console.error("scrape-standings failed:", err); process.exit(1); });
}
