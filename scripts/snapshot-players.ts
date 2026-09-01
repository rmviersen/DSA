import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";

// Captures a point-in-time snapshot of the `players` fields that actually
// change over a career and matter for historical accuracy -- organization,
// age, level, MLB service days, league_id (real-MLB-roster vs. int'l/
// complex signee), the active-roster flag, and last team -- into a new,
// real time-series table, `player_snapshots` (2026-09-02, Rees's ask:
// "I want to have players run as a snapshot going forward ... so we can
// run over-time analysis and reference historical data accurately").
//
// Deliberately does NOT convert `players` itself into a time-series table
// -- that would mean touching every one of the many existing queries/pages
// across this app that join to `players` assuming a simple one-row-per-
// player, current-state shape. `players` stays exactly as it is; this is
// purely additive.
//
// Only useful going forward -- there's no way to reconstruct what a
// player's org/age/level actually were at any of the refresh runs before
// this table existed (same limitation as ballpark_factor_snapshots).
//
// Not yet wired into scripts/compute-ratings.ts's historical-backfill path
// (deliberately -- see HANDOFF.md): the only refresh_run_id with a
// snapshot today is the one this script is first run against, which is
// also the CURRENT run, so current-state `players` is already accurate
// for it. That wiring becomes worth doing once enough future refreshes
// have accumulated real snapshots that differ from current state.

const PAGE_SIZE = 1000;
async function fetchAll<T>(query: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

async function main() {
  const supabase = makeSupabaseClient();

  console.log("Finding latest succeeded refresh run...");
  const { data: runRow, error: runErr } = await supabase
    .from("refresh_runs").select("id").eq("status", "succeeded").order("id", { ascending: false }).limit(1).single();
  if (runErr || !runRow) throw new Error(`No succeeded refresh run found: ${runErr?.message}`);
  const refreshRunId = (runRow as { id: number }).id;
  console.log(`Snapshotting players as of refresh_run_id ${refreshRunId}...`);

  const players = await fetchAll<{
    id: number; organization_id: number | null; age: number | null; level: number | null;
    mlb_service_days: number | null; league_id: number | null; is_active: boolean | null; last_team_id: number | null;
  }>((from, to) =>
    supabase.from("players").select("id, organization_id, age, level, mlb_service_days, league_id, is_active, last_team_id").order("id").range(from, to) as never
  );
  console.log(`  ${players.length} players`);

  const rows = players.map((p) => ({
    refresh_run_id: refreshRunId,
    player_id: p.id,
    organization_id: p.organization_id,
    age: p.age,
    level: p.level,
    mlb_service_days: p.mlb_service_days,
    league_id: p.league_id,
    is_active: p.is_active,
    last_team_id: p.last_team_id,
  }));

  console.log(`Writing ${rows.length} rows to player_snapshots...`);
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase.from("player_snapshots").upsert(batch as never[], { onConflict: "refresh_run_id,player_id" });
    if (error) throw new Error(`player_snapshots upsert failed at row ${i}: ${error.message}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("snapshot-players failed:", err);
  process.exit(1);
});
