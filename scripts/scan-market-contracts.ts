import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import {
  computeAAV, computeLeagueMinimumSalary, isCleanFreeAgentContract, playerTypeForRole,
  type ContractSalaryFields,
} from "../lib/contract-classification.js";

// Accumulates DISTINCT clean free-agent-market contracts into
// market_rate_training_contracts over time (2026-08-31, Rees's ask) -- the
// fix for the market-rate curve's sample size only ever being "whatever's
// clean in the single latest snapshot" (264 players as of this build).
// Free agency will add many new clean signings over the coming weeks; this
// is what actually grows the training pool instead of re-deriving the same
// snapshot's cross-section every time.
//
// Runs every refresh (wired into refresh.ts) -- cheap and append-only. Keyed
// on (player_id, season_year, years, salary0) so an unchanged contract
// showing up in yet another snapshot is a no-op, not a duplicate; only a
// genuinely new or renegotiated contract adds a row. See lib/contract-
// classification.ts for the full "what counts as clean" reasoning.

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

interface ContractSnapshotRow extends ContractSalaryFields {
  player_id: number;
  is_major: boolean | null;
  season_year: number | null;
}

async function main() {
  const supabase = makeSupabaseClient();

  console.log("Finding latest refresh run with contract snapshots...");
  const { data: contractRunRow, error: contractRunErr } = await supabase
    .from("contract_snapshots").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).single();
  if (contractRunErr || !contractRunRow) {
    console.log("No contract_snapshots found anywhere yet -- nothing to scan.");
    return;
  }
  const contractsRunId = (contractRunRow as { refresh_run_id: number }).refresh_run_id;
  console.log(`  contract_snapshots: refresh_run_id ${contractsRunId}`);

  console.log("Finding latest refresh run with player_computed...");
  const { data: computedRunRow, error: computedRunErr } = await supabase
    .from("player_computed").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).single();
  if (computedRunErr || !computedRunRow) {
    console.log("No player_computed rows found anywhere yet -- can't classify Overall/role, nothing to scan.");
    return;
  }
  const computedRunId = (computedRunRow as { refresh_run_id: number }).refresh_run_id;
  console.log(`  player_computed: refresh_run_id ${computedRunId}`);

  console.log("Loading contract snapshots...");
  const contracts = await fetchAll<ContractSnapshotRow>((from, to) =>
    supabase.from("contract_snapshots")
      .select("player_id, is_major, season_year, years, salary0, salary1, salary2, salary3, salary4, salary5, salary6, salary7, salary8, salary9, salary10, salary11, salary12, salary13, salary14")
      .eq("refresh_run_id", contractsRunId).range(from, to) as never
  );
  console.log(`  ${contracts.length} contract snapshot rows`);

  console.log("Loading contract extension snapshots (for the below-market-extension exclusion)...");
  const extensions = await fetchAll<{ player_id: number; salary0: number | null; years: number | null }>((from, to) =>
    supabase.from("contract_extension_snapshots").select("player_id, salary0, years").eq("refresh_run_id", contractsRunId).range(from, to) as never
  );
  const hasRealExtension = new Set(extensions.filter((e) => (e.salary0 ?? 0) > 0 || (e.years ?? 0) > 0).map((e) => e.player_id));

  console.log("Loading players (service time, retired status)...");
  const players = await fetchAll<{ id: number; mlb_service_years: number | null; retired: boolean | null }>((from, to) =>
    supabase.from("players").select("id, mlb_service_years, retired").order("id").range(from, to) as never
  );
  const playerById = new Map(players.map((p) => [p.id, p]));

  console.log("Loading player_computed (Overall, role)...");
  const computed = await fetchAll<{ player_id: number; overall: number | null; role: string | null }>((from, to) =>
    supabase.from("player_computed").select("player_id, overall, role").eq("refresh_run_id", computedRunId).range(from, to) as never
  );
  const computedByPlayer = new Map(computed.map((c) => [c.player_id, c]));

  const lowServiceSalaries = contracts
    .filter((c) => c.is_major && (c.salary0 ?? 0) > 0)
    .filter((c) => (playerById.get(c.player_id)?.mlb_service_years ?? 0) < 3)
    .map((c) => c.salary0!);
  const leagueMinimum = computeLeagueMinimumSalary(lowServiceSalaries);
  console.log(`League minimum salary (mode of low-service salaries, n=${lowServiceSalaries.length}): $${leagueMinimum.toLocaleString()}`);

  console.log("Loading already-recorded training contracts...");
  const existing = await fetchAll<{ player_id: number; season_year: number; years: number; salary0: number }>((from, to) =>
    supabase.from("market_rate_training_contracts").select("player_id, season_year, years, salary0").range(from, to) as never
  );
  const existingKeys = new Set(existing.map((e) => `${e.player_id}|${e.season_year}|${e.years}|${e.salary0}`));
  console.log(`  ${existingKeys.size} distinct clean contracts already on file`);

  const newRows: {
    player_id: number; season_year: number; years: number; salary0: number; aav: number;
    overall: number; role: string; player_type: "hitter" | "pitcher"; first_observed_refresh_run_id: number;
  }[] = [];
  let skippedNotClean = 0;

  for (const c of contracts) {
    const player = playerById.get(c.player_id);
    const clean = isCleanFreeAgentContract({
      isMajor: c.is_major, retired: player?.retired ?? null, mlbServiceYears: player?.mlb_service_years ?? null,
      salary0: c.salary0, leagueMinimum, hasRealExtension: hasRealExtension.has(c.player_id),
    });
    if (!clean) { skippedNotClean++; continue; }
    const pc = computedByPlayer.get(c.player_id);
    if (!pc || pc.overall == null || !pc.role) continue;
    const aav = computeAAV(c);
    if (!aav || aav <= 0) continue;
    const seasonYear = c.season_year ?? 0;
    const years = c.years ?? 0;
    const salary0 = c.salary0 ?? 0;
    const key = `${c.player_id}|${seasonYear}|${years}|${salary0}`;
    if (existingKeys.has(key)) continue; // same contract already recorded -- not new signal
    existingKeys.add(key); // guard against a duplicate within this same batch
    newRows.push({
      player_id: c.player_id, season_year: seasonYear, years, salary0, aav,
      overall: pc.overall, role: pc.role, player_type: playerTypeForRole(pc.role),
      first_observed_refresh_run_id: contractsRunId,
    });
  }

  console.log(`Clean contracts scanned: ${contracts.length - skippedNotClean}, of which ${newRows.length} are new (not already on file)`);

  if (newRows.length > 0) {
    const { error: insertErr } = await supabase.from("market_rate_training_contracts").insert(newRows as never[]);
    if (insertErr) throw new Error(`market_rate_training_contracts insert failed: ${insertErr.message}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("scan-market-contracts failed:", err);
  process.exit(1);
});
