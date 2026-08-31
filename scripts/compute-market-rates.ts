import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";

// First piece of the trade-value engine (2026-08-31, Rees's ask). Fits "what
// does the open market actually pay for this talent level" from this
// league's own real contracts -- the reference curve every player's contract
// surplus gets measured against later. Full reasoning for every filter below
// lives in HANDOFF.md's transaction-analysis section; short version: OOTP
// (like real MLB) pays players on a fixed, escalating scale by service time
// completely independent of talent -- confirmed in this league's own data:
// pre-arb averages ~$122K, arbitration-eligible ~$2.6M, free-agent-eligible
// ~$9.3M. Regressing salary against Overall across ALL players would mostly
// measure "how many years has this guy been in the league," not talent. This
// script fits the curve on a deliberately narrowed CLEAN sample only.

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

interface ContractSnapshotRow {
  player_id: number;
  is_major: boolean | null;
  years: number | null;
  salary0: number | null; salary1: number | null; salary2: number | null; salary3: number | null; salary4: number | null;
  salary5: number | null; salary6: number | null; salary7: number | null; salary8: number | null; salary9: number | null;
  salary10: number | null; salary11: number | null; salary12: number | null; salary13: number | null; salary14: number | null;
}

// A contract's AAV (average annual value) rather than its year-1 salary --
// avoids a back-/front-loaded deal skewing the curve. `years<=1` has no real
// multi-year structure to average, so salary0 IS the AAV in that case.
function computeAAV(row: ContractSnapshotRow): number | null {
  const years = row.years ?? 0;
  if (years <= 1) return row.salary0 ?? null;
  const salaryFields = [
    row.salary0, row.salary1, row.salary2, row.salary3, row.salary4,
    row.salary5, row.salary6, row.salary7, row.salary8, row.salary9,
    row.salary10, row.salary11, row.salary12, row.salary13, row.salary14,
  ];
  const used = salaryFields.slice(0, Math.min(years, 15)).filter((v): v is number => typeof v === "number");
  if (used.length === 0) return row.salary0 ?? null;
  return used.reduce((a, b) => a + b, 0) / used.length;
}

function mode(values: number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) if (c > bestCount) { best = v; bestCount = c; }
  return best;
}

// Ordinary least squares, y = intercept + slope * x.
function fitLine(points: { x: number; y: number }[]): { intercept: number; slope: number } {
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0, den = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  return { intercept, slope };
}

async function main() {
  const supabase = makeSupabaseClient();

  // Contracts and ratings refresh on different cadences -- contracts get
  // pulled every refresh (public, no auth needed), but ratings/player_computed
  // only update on a session-authenticated run, which happens less often (and
  // is sometimes deliberately skipped, e.g. --skip-ratings). Confirmed
  // 2026-08-31: latest contract_snapshots was refresh_run_id 25, latest
  // player_computed was refresh_run_id 24 -- two different runs. Rather than
  // require an exact match (which would mean this can only ever run
  // immediately after a full ratings refresh), find the latest of each
  // independently -- a player's Overall/role rarely shifts much over the gap
  // between two nearby refreshes, so this is a reasonable join for a
  // league-wide curve, even if it wouldn't be precise enough for scoring one
  // specific trade against a specific date.
  console.log("Finding latest refresh run with contract snapshots...");
  const { data: contractRunRow, error: contractRunErr } = await supabase
    .from("contract_snapshots").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).single();
  if (contractRunErr || !contractRunRow) {
    throw new Error(
      `No contract_snapshots found anywhere -- contract snapshotting only started 2026-08-31. ` +
      `Run scripts/refresh.ts at least once after that date before running this.`
    );
  }
  const contractsRunId = (contractRunRow as { refresh_run_id: number }).refresh_run_id;
  console.log(`  contract_snapshots: refresh_run_id ${contractsRunId}`);

  console.log("Finding latest refresh run with player_computed...");
  const { data: computedRunRow, error: computedRunErr } = await supabase
    .from("player_computed").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).single();
  if (computedRunErr || !computedRunRow) throw new Error(`No player_computed rows found at all: ${computedRunErr?.message}`);
  const computedRunId = (computedRunRow as { refresh_run_id: number }).refresh_run_id;
  console.log(`  player_computed: refresh_run_id ${computedRunId}`);
  if (contractsRunId !== computedRunId) {
    console.log(`  (different runs -- expected, see comment above; using each table's own latest)`);
  }

  console.log("Loading contract snapshots...");
  const contracts = await fetchAll<ContractSnapshotRow>((from, to) =>
    supabase.from("contract_snapshots")
      .select("player_id, is_major, years, salary0, salary1, salary2, salary3, salary4, salary5, salary6, salary7, salary8, salary9, salary10, salary11, salary12, salary13, salary14")
      .eq("refresh_run_id", contractsRunId).range(from, to) as never
  );
  console.log(`  ${contracts.length} contract snapshot rows`);

  console.log("Loading contract extension snapshots (for the below-market-extension exclusion)...");
  const extensions = await fetchAll<{ player_id: number; salary0: number | null; years: number | null }>((from, to) =>
    supabase.from("contract_extension_snapshots").select("player_id, salary0, years").eq("refresh_run_id", contractsRunId).range(from, to) as never
  );
  const hasRealExtension = new Set(extensions.filter((e) => (e.salary0 ?? 0) > 0 || (e.years ?? 0) > 0).map((e) => e.player_id));
  console.log(`  ${hasRealExtension.size} players have a real (non-empty) contract extension on file`);

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

  // League minimum salary, computed FRESH from this refresh's own data (the
  // mode of salary0 among clearly pre-arb players) rather than hardcoded --
  // confirmed 2026-08-31 this is a real, sharp constant ($500,000 as of that
  // check), but one that rises over time as seasons pass.
  const lowServiceSalaries = contracts
    .filter((c) => c.is_major && (c.salary0 ?? 0) > 0)
    .filter((c) => (playerById.get(c.player_id)?.mlb_service_years ?? 0) < 3)
    .map((c) => c.salary0!);
  const leagueMinimum = mode(lowServiceSalaries) ?? 0;
  console.log(`League minimum salary (mode of low-service salaries, n=${lowServiceSalaries.length}): $${leagueMinimum.toLocaleString()}`);

  // The clean free-agent-market sample. Every filter here is earned by a
  // confirmed pattern in this league's own data (HANDOFF.md has the full
  // investigation): meaningfully above league minimum (excludes rule-driven
  // rookie-scale deals regardless of service time), 6+ years of MLB service
  // (true free-agent eligibility -- below that, even a normal-looking salary
  // is arbitration-suppressed), and not also present in
  // contract_extension_snapshots (excludes a small number of players whose
  // current deal actually originated as a below-market extension signed
  // before free agency).
  interface CleanPoint { playerId: number; overall: number; role: string; aav: number }
  const clean: CleanPoint[] = [];
  for (const c of contracts) {
    if (!c.is_major) continue;
    const player = playerById.get(c.player_id);
    if (!player || player.retired) continue;
    if ((player.mlb_service_years ?? 0) < 6) continue;
    if ((c.salary0 ?? 0) <= leagueMinimum * 1.05) continue;
    if (hasRealExtension.has(c.player_id)) continue;
    const pc = computedByPlayer.get(c.player_id);
    if (!pc || pc.overall == null || !pc.role) continue;
    const aav = computeAAV(c);
    if (!aav || aav <= 0) continue;
    clean.push({ playerId: c.player_id, overall: pc.overall, role: pc.role, aav });
  }
  console.log(`Clean free-agent-market sample: ${clean.length} players`);
  if (clean.length < 20) {
    throw new Error(`Only ${clean.length} clean free-agent-market contracts found -- too small a sample to fit a reliable curve. Aborting rather than writing a garbage curve.`);
  }

  // Pooled curve: ln(AAV) = intercept + slope * Overall. Log-linear because
  // salary vs. talent is a right-skewed relationship (elite talent gets paid
  // disproportionately more, not linearly more) -- standard for this kind of
  // fit and keeps predicted values always positive.
  const points = clean.map((c) => ({ x: c.overall, y: Math.log(c.aav) }));
  const { intercept, slope } = fitLine(points);
  const overalls = clean.map((c) => c.overall);
  const minOverall = Math.min(...overalls);
  const maxOverall = Math.max(...overalls);
  console.log(`Pooled curve: ln(AAV) = ${intercept.toFixed(4)} + ${slope.toFixed(4)} * Overall (n=${clean.length}, Overall range ${minOverall}-${maxOverall})`);

  // Per-role multiplier: each role's actual average AAV vs. what the pooled
  // curve alone would have predicted for that role's average Overall --
  // this is where "a top reliever isn't worth what a top starter is worth"
  // gets captured, empirically, from what this league's own GMs actually pay,
  // rather than a hand-picked weight.
  const byRole = new Map<string, CleanPoint[]>();
  for (const c of clean) {
    if (!byRole.has(c.role)) byRole.set(c.role, []);
    byRole.get(c.role)!.push(c);
  }
  const roleRows: { role: string; multiplier: number; sample_size: number; avg_overall_in_sample: number; avg_actual_aav: number; avg_curve_predicted_aav: number }[] = [];
  for (const [role, group] of byRole) {
    const avgOverall = group.reduce((s, c) => s + c.overall, 0) / group.length;
    const avgActualAav = group.reduce((s, c) => s + c.aav, 0) / group.length;
    const avgPredictedAav = group.reduce((s, c) => s + Math.exp(intercept + slope * c.overall), 0) / group.length;
    const multiplier = avgPredictedAav > 0 ? avgActualAav / avgPredictedAav : 1;
    roleRows.push({ role, multiplier, sample_size: group.length, avg_overall_in_sample: avgOverall, avg_actual_aav: avgActualAav, avg_curve_predicted_aav: avgPredictedAav });
  }
  roleRows.sort((a, b) => b.multiplier - a.multiplier);
  console.log("Per-role multipliers (actual AAV ÷ pooled-curve-predicted AAV):");
  for (const r of roleRows) {
    console.log(
      `  ${r.role.padEnd(4)} x${r.multiplier.toFixed(2)}  (n=${r.sample_size}, avg Overall ${r.avg_overall_in_sample.toFixed(1)}, ` +
      `actual $${Math.round(r.avg_actual_aav).toLocaleString()} vs curve $${Math.round(r.avg_curve_predicted_aav).toLocaleString()})`
    );
  }

  console.log("Writing market_rate_curves...");
  const { error: curveErr } = await supabase.from("market_rate_curves").upsert({
    refresh_run_id: contractsRunId,
    intercept, slope,
    sample_size: clean.length,
    min_overall_in_sample: minOverall,
    max_overall_in_sample: maxOverall,
    league_minimum_salary: leagueMinimum,
  } as never, { onConflict: "refresh_run_id" });
  if (curveErr) throw new Error(`market_rate_curves upsert failed: ${curveErr.message}`);

  console.log("Writing market_rate_role_multipliers...");
  const { error: roleErr } = await supabase.from("market_rate_role_multipliers").upsert(
    roleRows.map((r) => ({
      refresh_run_id: contractsRunId,
      role: r.role,
      multiplier: r.multiplier,
      sample_size: r.sample_size,
      avg_overall_in_sample: r.avg_overall_in_sample,
      avg_actual_aav: r.avg_actual_aav,
      avg_curve_predicted_aav: r.avg_curve_predicted_aav,
    })) as never[],
    { onConflict: "refresh_run_id,role" }
  );
  if (roleErr) throw new Error(`market_rate_role_multipliers upsert failed: ${roleErr.message}`);

  console.log("Done.");
}

main().catch((err) => {
  console.error("compute-market-rates failed:", err);
  process.exit(1);
});
