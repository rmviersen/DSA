import { makeSupabaseClient } from "./supabase-client";
import { makeStatsPlusClient } from "./statsplus-client";

// Admin Dashboard's own data layer (2026-08-28, §1 Platform Status) -- kept
// separate from queries.ts on purpose, same reasoning as org-minors-query.ts:
// this page is a self-contained addition, no reason to risk touching a file
// anything else might be mid-editing.
const supabase = makeSupabaseClient();

export interface RefreshRunSummary {
  id: number;
  started_at: string;
  completed_at: string | null;
  status: string;
  game_date: string | null;
  ratings_included: boolean | null;
  playerCount: number;
  teamCount: number;
  // Player-category snapshot (2026-08-28) -- straight off refresh_runs
  // itself, written by scripts/refresh.ts at the end of each run. players
  // is current-state only (not versioned per run), so a run from before
  // this column existed has these as null -- shown as "—", not 0, so an old
  // run doesn't look like it captured nobody.
  mlb_count: number | null;
  minor_league_count: number | null;
  international_count: number | null;
  draft_pool_count: number | null;
  free_agent_count: number | null;
  retired_count: number | null;
}

// player_computed/team_computed have no FK to refresh_runs (gotcha 1 -- no
// FK between any of the computed/snapshot sibling tables), so these are
// separate count queries per run, not a join. head:true means Postgres
// returns just the count, not the matching rows -- cheap even though this
// runs twice per row shown (5 runs x 2 tables = 10 small count queries).
async function countFor(table: "player_computed" | "team_computed", refreshRunId: number): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("refresh_run_id", refreshRunId);
  if (error) throw error;
  return count ?? 0;
}

export async function getRecentRefreshRuns(limit = 5): Promise<RefreshRunSummary[]> {
  const { data, error } = await supabase
    .from("refresh_runs")
    .select("id, started_at, completed_at, status, game_date, ratings_included, mlb_count, minor_league_count, international_count, draft_pool_count, free_agent_count, retired_count")
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const runs = data as Omit<RefreshRunSummary, "playerCount" | "teamCount">[];

  return Promise.all(
    runs.map(async (r) => ({
      ...r,
      playerCount: await countFor("player_computed", r.id),
      teamCount: await countFor("team_computed", r.id),
    }))
  );
}

export interface FreshnessCheck {
  lastRefreshedGameDate: string | null;
  statsPlusCurrentGameDate: string | null;
  isStale: boolean;
}

// Same comparison scripts/check-new-sim.ts already does for the automated
// refresh -- reused here so the admin page can show the same "is there new
// data waiting" signal, not a second, potentially-divergent implementation.
// StatsPlus's current-date endpoint is public, no auth -- safe for the
// deployed site to call directly. Requires STATSPLUS_BASE_URL as a plain
// (non-secret) Vercel env var; if unset, this degrades to "unknown" rather
// than crashing the whole page.
export async function getFreshnessCheck(): Promise<FreshnessCheck> {
  const { data, error } = await supabase
    .from("refresh_runs")
    .select("game_date")
    .eq("status", "succeeded")
    .not("game_date", "is", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const lastRefreshedGameDate = (data as { game_date: string } | null)?.game_date ?? null;

  const baseUrl = process.env.STATSPLUS_BASE_URL;
  let statsPlusCurrentGameDate: string | null = null;
  if (baseUrl) {
    try {
      const sp = makeStatsPlusClient({ baseUrl });
      statsPlusCurrentGameDate = await sp.currentGameDate();
    } catch {
      statsPlusCurrentGameDate = null; // StatsPlus unreachable -- don't fail the whole page over it
    }
  }

  const isStale = Boolean(
    statsPlusCurrentGameDate && (!lastRefreshedGameDate || statsPlusCurrentGameDate > lastRefreshedGameDate)
  );
  return { lastRefreshedGameDate, statsPlusCurrentGameDate, isStale };
}

export interface PlatformEvent {
  id: number;
  created_at: string;
  severity: "info" | "warning" | "error";
  source: string;
  message: string;
  details: unknown;
  refresh_run_id: number | null;
}

export async function getRecentPlatformEvents(limit = 20): Promise<PlatformEvent[]> {
  const { data, error } = await supabase
    .from("platform_events")
    .select("id, created_at, severity, source, message, details, refresh_run_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as PlatformEvent[];
}
