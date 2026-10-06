import dotenv from "dotenv";
import os from "node:os";
import path from "node:path";
import { makeSupabaseClient } from "../lib/supabase-client";

// One-off, content-aware cleanup (2026-10-06) -- written for Rees to run by hand.
//
// Background: the StatsPlus API token expired ~2026-09-25 and 55 scheduled refreshes (runs 68-122) each stored
// a snapshot of the 2032 stats + contracts before failing at the ratings step. The league kept simming, so those
// runs are REAL intermediate snapshots -- not all duplicates. This script therefore deletes a failed run's row
// ONLY when the previous run holds a row with the same key and EXACTLY the same values (every column except
// id / refresh_run_id / captured_at). A row that changed, or that the previous run doesn't have, is never touched
// (including the ~1,000 minor-league rows and ~5,000 contract rows that exist only in failed runs).
//
// It calls the database function public.dedup_failed_run_against_previous(), which also refuses to touch any run
// whose status isn't 'failed'. It never touches runs 123+ or runs <= 67.
//
//   Dry run (default -- reads and counts only, deletes NOTHING):
//     npx tsx scripts/dedup-failed-runs.ts
//   Real thing:
//     npx tsx scripts/dedup-failed-runs.ts --execute
//
// Runs newest-first so every run is compared against a previous run that hasn't been thinned yet.
// Credentials: reads .env in this folder if present, else C:\Users\<you>\secrets\dsa-platform.env.

dotenv.config();
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) dotenv.config({ path: path.join(os.homedir(), "secrets", "dsa-platform.env") });

const FIRST_FAILED = 68;
const LAST_FAILED = 122;
const LEAGUE_ID = 1;
const TABLES = [
  { name: "player_batting_stats_snapshots", byPlayer: true },
  { name: "player_pitching_stats_snapshots", byPlayer: true },
  { name: "player_fielding_stats_snapshots", byPlayer: true },
  { name: "contract_snapshots", byPlayer: true },
  { name: "contract_extension_snapshots", byPlayer: true },
  { name: "team_batting_stats_snapshots", byPlayer: false },
  { name: "team_pitching_stats_snapshots", byPlayer: false },
] as const;

const execute = process.argv.includes("--execute");
const supabase = makeSupabaseClient();
const MAX_PLAYER_ID = 1_000_000_000;

async function callFn(table: string, run: number, prev: number, lo: number | null, hi: number | null): Promise<number> {
  const { data, error } = await supabase.rpc("dedup_failed_run_against_previous", {
    p_table: table, p_run: run, p_prev: prev, p_execute: execute, p_player_lo: lo, p_player_hi: hi,
  } as never);
  if (error) throw new Error(`${error.message} (${error.code ?? "no code"})`);
  return Number(data);
}

// One call per run+table; if the API's 8s limit trips, split the player-id range in half and retry.
async function dedupRun(table: (typeof TABLES)[number], run: number, prev: number, lo: number | null = null, hi: number | null = null, depth = 0): Promise<number> {
  try {
    return await callFn(table.name, run, prev, lo, hi);
  } catch (e) {
    if (!table.byPlayer || depth >= 6) throw new Error(`${table.name} run ${run}: ${e}`);
    const a = lo ?? 0, b = hi ?? MAX_PLAYER_ID, mid = Math.floor((a + b) / 2);
    console.warn(`  ${table.name} run ${run}: ${a}..${b} too slow (${e}); splitting`);
    return (await dedupRun(table, run, prev, a, mid, depth + 1)) + (await dedupRun(table, run, prev, mid + 1, b, depth + 1));
  }
}

async function rowCount(table: string, run: number): Promise<number> {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("refresh_run_id", run);
  if (error) throw new Error(`count ${table} run ${run}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  console.log(execute ? "MODE: EXECUTE (deleting identical-to-previous rows)\n" : "MODE: DRY RUN (nothing is deleted -- pass --execute to delete)\n");

  const { data: runs, error } = await supabase.from("refresh_runs").select("id,status").eq("dsa_league_id", LEAGUE_ID).lte("id", LAST_FAILED + 1).order("id");
  if (error) throw error;
  const all = runs as { id: number; status: string }[];
  const targets = all.filter((r) => r.id >= FIRST_FAILED && r.id <= LAST_FAILED);
  const notFailed = targets.filter((r) => r.status !== "failed");
  if (notFailed.length > 0) throw new Error(`ABORT: runs in ${FIRST_FAILED}-${LAST_FAILED} that are not 'failed': ${JSON.stringify(notFailed)}. Nothing was changed.`);
  console.log(`${targets.length} failed runs (${FIRST_FAILED}-${LAST_FAILED}) confirmed 'failed'.\n`);

  // Guard rail for the keep-the-latest-run assumption: the run right after the range must have succeeded.
  const after = all.find((r) => r.id === LAST_FAILED + 1);
  if (after && after.status !== "succeeded") throw new Error(`ABORT: run ${after.id} is '${after.status}', expected 'succeeded'.`);

  const before = new Map<string, number>();
  for (const t of TABLES) {
    let n = 0;
    for (const r of targets) n += await rowCount(t.name, r.id);
    before.set(t.name, n);
  }

  const totals = new Map<string, number>(TABLES.map((t) => [t.name, 0]));
  const newestFirst = [...targets].sort((a, b) => b.id - a.id);
  for (const r of newestFirst) {
    const prev = [...all].reverse().find((x) => x.id < r.id)?.id;
    if (prev === undefined) continue;
    const parts: string[] = [];
    for (const t of TABLES) {
      const n = await dedupRun(t, r.id, prev);
      totals.set(t.name, (totals.get(t.name) ?? 0) + n);
      parts.push(`${t.name.replace(/_snapshots$/, "").replace("player_", "").replace("_stats", "")}=${n}`);
    }
    console.log(`run ${r.id} (vs ${prev}): ${execute ? "deleted" : "would delete"} ${parts.join(" ")}`);
  }

  console.log(`\n${execute ? "DELETED" : "WOULD DELETE"} (identical-to-previous rows) vs rows currently in runs ${FIRST_FAILED}-${LAST_FAILED}:`);
  let sumDel = 0, sumAll = 0;
  for (const t of TABLES) {
    const d = totals.get(t.name) ?? 0, a = before.get(t.name) ?? 0;
    sumDel += d; sumAll += a;
    console.log(`  ${t.name.padEnd(34)} ${String(d).padStart(9)} of ${String(a).padStart(9)}  (${a ? ((d / a) * 100).toFixed(1) : "0"}%)  -> ${a - d} kept`);
  }
  console.log(`  ${"TOTAL".padEnd(34)} ${String(sumDel).padStart(9)} of ${String(sumAll).padStart(9)}`);
  if (!execute) console.log("\nDry run complete. Nothing was deleted. Re-run with --execute to apply.");
  else {
    let left = 0;
    for (const t of TABLES) for (const r of targets) left += await rowCount(t.name, r.id);
    console.log(`\nRows still attached to runs ${FIRST_FAILED}-${LAST_FAILED}: ${left} (expected ${sumAll - sumDel}).`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
