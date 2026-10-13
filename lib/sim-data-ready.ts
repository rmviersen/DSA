import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawRow } from "./statsplus-client.js";
import * as map from "./mappers.js";

// "Has StatsPlus actually PUBLISHED the new sim's data yet?" (2026-10-13, Rees)
//
// scripts/check-new-sim.ts used to decide a sim was ready purely because StatsPlus's /exports/ `current_date` moved. That
// date moves when the commissioner's league FILE is uploaded -- about 80 minutes BEFORE StatsPlus finishes publishing the
// sim (2026-10-12: file uploaded 8:24 pm CDT, "website has been updated" 9:44 pm). A refresh in that gap pulled the PREVIOUS
// sim's data and stamped it with the new date (refresh run 132 was byte-for-byte the same player data as run 131), and the
// date check then considered the sim done, so nothing re-pulled it.
//
// Fix: a new date only counts once the public /players/ feed also DIFFERS from the player data we already hold. Between two
// sims something always moves (ages, injuries, roster moves, service days), so "identical to what we have" means "StatsPlus
// has not published yet". Compared fields are deliberately broad but cheap -- roster status plus the fields that tick on a sim.
const COMPARED = [
  "team_id", "parent_team_id", "level", "league_id", "organization_id", "age", "retired",
  "is_active", "is_on_secondary", "is_on_waivers", "designated_for_assignment", "is_on_dl", "is_on_dl60", "free_agent", "last_team_id",
  "mlb_service_days", "pro_service_days", "secondary_service_days", "injury_is_injured", "injury_dl_left", "injury_left",
  "days_on_waivers_left",
] as const;

export interface FeedDiff { checked: number; changed: number; sample: string[] }

export async function diffPlayerFeedAgainstDb(supabase: SupabaseClient, leagueId: number, feed: RawRow[]): Promise<FeedDiff> {
  const db = new Map<number, Record<string, unknown>>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("players").select(["id", ...COMPARED].join(",")).eq("dsa_league_id", leagueId).order("id").range(from, from + 999);
    if (error) throw new Error(`players read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as unknown as Record<string, unknown>[]) db.set(r.id as number, r);
    if (data.length < 1000) break;
  }
  let changed = 0;
  const sample: string[] = [];
  for (const raw of feed) {
    const mapped = map.mapPlayer(raw) as Record<string, unknown>;
    const existing = db.get(mapped.id as number);
    if (!existing) { changed++; continue; } // a player we have never seen is also new data
    const diff = COMPARED.filter((f) => (existing[f] ?? null) !== (mapped[f] ?? null));
    if (diff.length > 0) { changed++; if (sample.length < 5) sample.push(`${mapped.id}: ${diff.join(",")}`); }
  }
  return { checked: feed.length, changed, sample };
}
