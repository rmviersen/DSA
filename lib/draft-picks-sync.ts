import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatsPlusClient } from "./statsplus-client";
import * as map from "./mappers";

// One implementation of "pull StatsPlus's draftv2 feed and store it in draft_picks", shared by the main refresh (scripts/refresh.ts) and the draft
// board's auto-refresh route (app/api/draft-picks-refresh/route.ts) so the two can never disagree about a pick's draft_year again.
//
// The feed returns EVERY draft on record (2031, 2032 and the one in progress), not just the current class. draft_year therefore has to come from
// each player's own players.draft_year (2026-08-30 fix, see mapDraftPick) -- never from "the current season", which the route used to stamp on all
// rows. While a draft is in progress StatsPlus leaves players.draft_year at 0 until the whole draft is finalized, so the picks of the live class are
// stored with draft_year 0; readers of "the current class's picks" must accept 0 as well (see getTopDraftees).
const BATCH_SIZE = 500;

export async function syncDraftPicks(
  supabase: SupabaseClient,
  sp: Pick<StatsPlusClient, "draft">,
  leagueId: number,
): Promise<{ totalPicks: number; liveClassPicks: number }> {
  const draftRows = await sp.draft();
  const ids = draftRows.map((r) => Number(r["ID"])).filter((id) => Number.isFinite(id));
  const yearById = new Map<number, number | null>();
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const { data, error } = await supabase.from("players").select("id,draft_year").eq("dsa_league_id", leagueId).in("id", ids.slice(i, i + BATCH_SIZE));
    if (error) throw new Error(`players lookup for draft_picks failed: ${error.message}`);
    (data as { id: number; draft_year: number | null }[]).forEach((p) => yearById.set(p.id, p.draft_year));
  }
  const mapped = draftRows.map((r) => map.mapDraftPick(r, yearById.get(Number(r["ID"])) ?? null));
  for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
    const batch = mapped.slice(i, i + BATCH_SIZE).map((r) => ({ ...r, dsa_league_id: leagueId }));
    const { error } = await supabase.from("draft_picks").upsert(batch as never[], { onConflict: "dsa_league_id,player_id" });
    if (error) throw new Error(`draft_picks upsert failed: ${error.message}`);
  }
  return { totalPicks: mapped.length, liveClassPicks: mapped.filter((r) => !r.draft_year).length };
}
