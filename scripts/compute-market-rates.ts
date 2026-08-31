import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { PITCHER_ROLES, computeLeagueMinimumSalary, type PlayerType } from "../lib/contract-classification.js";

// Fits "what does the open market actually pay for this talent level" from
// the ACCUMULATED training pool in market_rate_training_contracts (built and
// kept current by scripts/scan-market-contracts.ts, run every refresh) --
// not a single snapshot's cross-section. This is the fix for small-sample
// role multipliers only ever being as good as whatever's clean right now
// (264 players as of the first build, 2026-08-31): the training pool grows
// every time a new clean free-agent contract is signed, so a role's number
// (COF's in particular, still thin as of this writing) gets more reliable
// over time, especially through the offseason free-agency window.
//
// Full reasoning for the two-curve split, the shrinkage, and the DH cap
// below lives in HANDOFF.md's transaction-analysis section -- short version:
// pooling hitters and pitchers into one curve let RP's lower pay drag the
// baseline down and inflate every hitting position (DH came out priced
// ABOVE every defensive position, which is backwards -- confirmed wrong by
// Rees). Fixed by fitting separate curves per player type, shrinking each
// role's raw multiplier toward 1.0 by sample size, and explicitly capping DH
// at the lowest other hitting-role multiplier (a domain constraint no
// regression can infer on its own).

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

// Ordinary least squares, y = intercept + slope * x -- plus R² and the
// residual standard deviation (both in log-AAV space, the space the fit
// actually happens in), surfaced on /admin/market-rates for Rees to judge
// how much to trust a given curve at a glance rather than just seeing the
// coefficients.
function fitLine(points: { x: number; y: number }[]): { intercept: number; slope: number; rSquared: number; residualStdDev: number } {
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
  let ssRes = 0, ssTot = 0;
  for (const p of points) {
    const predicted = intercept + slope * p.x;
    ssRes += (p.y - predicted) ** 2;
    ssTot += (p.y - meanY) ** 2;
  }
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const residualStdDev = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;
  return { intercept, slope, rSquared, residualStdDev };
}

// Shrinkage toward 1.0 (no role adjustment) by sample size -- a role with a
// small clean sample produces a noisy raw ratio that shouldn't be trusted at
// face value. SHRINKAGE_K is the "how many observations-worth of trust does
// a n=0 role start with" constant -- weight on the raw multiplier is
// n/(n+k). Deliberately a plain constant, not a DB-stored weight like
// rating_weights -- this is a statistical shrinkage parameter tuned for how
// noisy small samples are, not a business judgment call to retune
// independently of the underlying data.
const SHRINKAGE_K = 25;
function shrink(raw: number, n: number): number {
  const weight = n / (n + SHRINKAGE_K);
  return 1 + (raw - 1) * weight;
}

interface TrainingContract { playerId: number; overall: number; role: string; aav: number }

async function main() {
  const supabase = makeSupabaseClient();

  console.log("Loading accumulated training contracts (market_rate_training_contracts)...");
  const training = await fetchAll<{ player_id: number; overall: number; role: string; aav: number }>((from, to) =>
    supabase.from("market_rate_training_contracts").select("player_id, overall, role, aav").range(from, to) as never
  );
  console.log(`  ${training.length} distinct clean contracts on file`);
  if (training.length < 20) {
    throw new Error(
      `Only ${training.length} training contracts found -- too small a sample to fit a reliable curve. ` +
      `Run scripts/scan-market-contracts.ts first (also runs automatically as part of scripts/refresh.ts).`
    );
  }
  const clean: TrainingContract[] = training.map((t) => ({ playerId: t.player_id, overall: t.overall, role: t.role, aav: t.aav }));

  // Tag the output with the CURRENT latest refresh run -- "when was this fit
  // computed," independent of when any individual training contract was
  // first observed (those can span many past refreshes).
  console.log("Finding latest refresh run (for tagging this fit)...");
  const { data: runRow, error: runErr } = await supabase
    .from("refresh_runs").select("id").order("id", { ascending: false }).limit(1).single();
  if (runErr || !runRow) throw new Error(`No refresh_runs found: ${runErr?.message}`);
  const currentRunId = (runRow as { id: number }).id;
  console.log(`  refresh_run_id ${currentRunId}`);

  // League minimum is purely informational here now (classification already
  // happened in scan-market-contracts.ts) -- recomputed fresh from the
  // latest contract snapshot rather than read back from a previous curve
  // row, so this script works standalone on a first-ever run too.
  console.log("Computing current league minimum salary (for display context)...");
  const { data: latestContractRun } = await supabase
    .from("contract_snapshots").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  let leagueMinimum = 0;
  if (latestContractRun) {
    const runId = (latestContractRun as { refresh_run_id: number }).refresh_run_id;
    const lowServiceContracts = await fetchAll<{ player_id: number; is_major: boolean | null; salary0: number | null }>((from, to) =>
      supabase.from("contract_snapshots").select("player_id, is_major, salary0").eq("refresh_run_id", runId).range(from, to) as never
    );
    const players = await fetchAll<{ id: number; mlb_service_years: number | null }>((from, to) =>
      supabase.from("players").select("id, mlb_service_years").range(from, to) as never
    );
    const serviceByPlayer = new Map(players.map((p) => [p.id, p.mlb_service_years]));
    const lowServiceSalaries = lowServiceContracts
      .filter((c) => c.is_major && (c.salary0 ?? 0) > 0 && (serviceByPlayer.get(c.player_id) ?? 0) < 3)
      .map((c) => c.salary0!);
    leagueMinimum = computeLeagueMinimumSalary(lowServiceSalaries);
  }
  console.log(`  $${leagueMinimum.toLocaleString()}`);

  // Fit one curve per player type -- see header comment for why.
  const curvesByType = new Map<PlayerType, { intercept: number; slope: number; rSquared: number; residualStdDev: number; sampleSize: number; minOverall: number; maxOverall: number }>();
  for (const type of ["hitter", "pitcher"] as const) {
    const group = clean.filter((c) => PITCHER_ROLES.has(c.role) === (type === "pitcher"));
    if (group.length < 10) throw new Error(`Only ${group.length} clean ${type} contracts -- too small to fit a curve. Aborting.`);
    const points = group.map((c) => ({ x: c.overall, y: Math.log(c.aav) }));
    const { intercept, slope, rSquared, residualStdDev } = fitLine(points);
    const overalls = group.map((c) => c.overall);
    curvesByType.set(type, { intercept, slope, rSquared, residualStdDev, sampleSize: group.length, minOverall: Math.min(...overalls), maxOverall: Math.max(...overalls) });
    console.log(`${type} curve: ln(AAV) = ${intercept.toFixed(4)} + ${slope.toFixed(4)} * Overall (n=${group.length}, R²=${rSquared.toFixed(3)}, residual SD=${residualStdDev.toFixed(3)}, Overall range ${Math.min(...overalls)}-${Math.max(...overalls)})`);
  }

  // Per-role multiplier: each role's actual average AAV vs. what its own
  // player type's curve alone would have predicted, then shrunk toward 1.0
  // by sample size, then DH is capped at the lowest other hitting-role
  // multiplier (DH provides zero defensive value -- it can never
  // legitimately outrank a position that also plays the field).
  const byRole = new Map<string, TrainingContract[]>();
  for (const c of clean) {
    if (!byRole.has(c.role)) byRole.set(c.role, []);
    byRole.get(c.role)!.push(c);
  }
  interface RoleRow {
    role: string; playerType: PlayerType; sampleSize: number; avgOverall: number;
    avgActualAav: number; avgPredictedAav: number; rawMultiplier: number; shrunkMultiplier: number;
    finalMultiplier: number; dhCapped: boolean;
  }
  const roleRows: RoleRow[] = [];
  for (const [role, group] of byRole) {
    const playerType: PlayerType = PITCHER_ROLES.has(role) ? "pitcher" : "hitter";
    const curve = curvesByType.get(playerType)!;
    const avgOverall = group.reduce((s, c) => s + c.overall, 0) / group.length;
    const avgActualAav = group.reduce((s, c) => s + c.aav, 0) / group.length;
    const avgPredictedAav = group.reduce((s, c) => s + Math.exp(curve.intercept + curve.slope * c.overall), 0) / group.length;
    const rawMultiplier = avgPredictedAav > 0 ? avgActualAav / avgPredictedAav : 1;
    const shrunkMultiplier = shrink(rawMultiplier, group.length);
    roleRows.push({
      role, playerType, sampleSize: group.length, avgOverall, avgActualAav, avgPredictedAav,
      rawMultiplier, shrunkMultiplier, finalMultiplier: shrunkMultiplier, dhCapped: false,
    });
  }
  const dhRow = roleRows.find((r) => r.role === "DH");
  if (dhRow) {
    const otherHitters = roleRows.filter((r) => r.playerType === "hitter" && r.role !== "DH");
    if (otherHitters.length > 0) {
      const lowestOtherHitter = Math.min(...otherHitters.map((r) => r.shrunkMultiplier));
      if (dhRow.shrunkMultiplier > lowestOtherHitter) {
        dhRow.finalMultiplier = lowestOtherHitter;
        dhRow.dhCapped = true;
      }
    }
  }
  roleRows.sort((a, b) => b.finalMultiplier - a.finalMultiplier);
  console.log("Per-role multipliers (raw -> shrunk -> final, sample-size-weighted, DH capped against defensive positions):");
  for (const r of roleRows) {
    console.log(
      `  ${r.role.padEnd(4)} raw x${r.rawMultiplier.toFixed(2)} -> shrunk x${r.shrunkMultiplier.toFixed(2)}` +
      `${r.dhCapped ? ` -> capped x${r.finalMultiplier.toFixed(2)}` : ""}` +
      `  (n=${r.sampleSize}, avg Overall ${r.avgOverall.toFixed(1)}, actual $${Math.round(r.avgActualAav).toLocaleString()} vs curve $${Math.round(r.avgPredictedAav).toLocaleString()})`
    );
  }

  console.log("Writing market_rate_curves...");
  for (const [type, curve] of curvesByType) {
    const { error: curveErr } = await supabase.from("market_rate_curves").upsert({
      refresh_run_id: currentRunId,
      player_type: type,
      intercept: curve.intercept, slope: curve.slope,
      r_squared: curve.rSquared, residual_std_dev: curve.residualStdDev,
      sample_size: curve.sampleSize,
      min_overall_in_sample: curve.minOverall,
      max_overall_in_sample: curve.maxOverall,
      league_minimum_salary: leagueMinimum,
    } as never, { onConflict: "refresh_run_id,player_type" });
    if (curveErr) throw new Error(`market_rate_curves upsert failed (${type}): ${curveErr.message}`);
  }

  console.log("Writing market_rate_role_multipliers...");
  const { error: roleErr } = await supabase.from("market_rate_role_multipliers").upsert(
    roleRows.map((r) => ({
      refresh_run_id: currentRunId,
      role: r.role,
      raw_multiplier: r.rawMultiplier,
      shrunk_multiplier: r.shrunkMultiplier,
      final_multiplier: r.finalMultiplier,
      dh_capped: r.dhCapped,
      sample_size: r.sampleSize,
      avg_overall_in_sample: r.avgOverall,
      avg_actual_aav: r.avgActualAav,
      avg_curve_predicted_aav: r.avgPredictedAav,
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
