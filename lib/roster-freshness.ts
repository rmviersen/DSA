import { makeSupabaseClient } from "./supabase-client";

// How fresh is the `players` table's roster status (40-man, active roster, org, level, free-agent flag)? (2026-10-13)
// It is rewritten in full by every refresh (scripts/refresh.ts) and, between refreshes, row-by-row for anyone who moved by
// scripts/sync-roster-flags.ts -- so the freshest of those two timestamps is what the pages should report.
export interface RosterFreshness {
  asOf: string | null; // ISO timestamp of the newer of the two below
  source: "sync" | "refresh" | null;
  refreshAt: string | null;
  syncAt: string | null;
}

export async function getRosterFreshness(leagueId: number): Promise<RosterFreshness> {
  const supabase = makeSupabaseClient();
  const [{ data: run }, { data: sync }] = await Promise.all([
    supabase.from("refresh_runs").select("completed_at").eq("dsa_league_id", leagueId).eq("status", "succeeded").order("id", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("roster_syncs").select("synced_at").eq("dsa_league_id", leagueId).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const refreshAt = (run as { completed_at: string | null } | null)?.completed_at ?? null;
  const syncAt = (sync as { synced_at: string } | null)?.synced_at ?? null;
  if (refreshAt && syncAt) {
    return new Date(syncAt).getTime() > new Date(refreshAt).getTime()
      ? { asOf: syncAt, source: "sync", refreshAt, syncAt }
      : { asOf: refreshAt, source: "refresh", refreshAt, syncAt };
  }
  if (syncAt) return { asOf: syncAt, source: "sync", refreshAt, syncAt };
  if (refreshAt) return { asOf: refreshAt, source: "refresh", refreshAt, syncAt };
  return { asOf: null, source: null, refreshAt, syncAt };
}
