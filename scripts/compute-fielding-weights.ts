import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { getRatingValidationPoints } from "../lib/rating-validation-query.js";
import { fitLine, isotonicRegressionNonIncreasing } from "../lib/regression.js";

// Role-calibrated fielding weight (2026-08-31, Rees's ask). Replaces the
// single global rating_weights.fielding multiplier with a per-role relative
// multiplier on top of it, so "how much does fielding count toward Overall"
// can vary by position without a small sample overinflating any one role
// relative to another. Full reasoning: HANDOFF.md's transaction/rating-
// engine section and the "Rating Engine Redesign" proposal.
//
// Reuses getRatingValidationPoints() directly -- no new data-fetching, this
// is the exact same hitter dataset /admin/rating-validation already shows
// (real 2031 WAR/100PA, real fielding composite per player).

// Real, confirmed defensive-spectrum order (2026-08-31, from /admin/
// rating-validation's real WAR-by-role data: SS 0.367 > CF 0.301 > INF
// 0.284 > COF 0.247 > C 0.205 > DH 0.191 > 1B 0.188 avg WAR/100PA). Fixed,
// not re-derived each run -- this is a stable real-world fact about the
// defensive spectrum, not something that should wobble season to season
// based on one year's noise. The isotonic step below constrains the fitted
// fielding weights to respect this exact order.
const ROLE_ORDER = ["SS", "CF", "INF", "COF", "C", "DH", "1B"];

// Same shrinkage constant/reasoning as compute-market-rates.ts -- weight on
// a role's own (already order-safe) slope is n/(n+K); small samples lean
// harder on the pooled reference.
const SHRINKAGE_K = 25;

// Below this, the pooled slope is too close to zero (or the wrong sign) to
// divide by meaningfully -- a "relative multiplier" built on a near-zero
// denominator would be wildly unstable.
const MIN_POOLED_SLOPE = 0.001;

// Below this, the pooled fielding-vs-WAR relationship itself is too weak to
// build role differentiation from AT ALL, regardless of what any individual
// role's slope says. Caught for real 2026-08-31: with the pooled R² at
// 0.004 (fielding is the weakest predictor of any hitter grade -- see
// HANDOFF.md), shrinkage toward that pooled slope alone wasn't nearly
// enough -- large-sample roles like INF (n=142, shrink weight 142/167=0.85)
// kept 85% of a "signal" that isn't statistically distinguishable from
// noise, producing ~x1.7-2.0 multipliers off an R² that explains 0.4% of
// the variance. A slope can be technically nonzero and still mean nothing.
// Below this R², every role gets a flat 1.0 (today's unchanged behavior)
// instead of a number this season's data can't actually back up -- the
// mechanism stays fully built and ready to activate for real once (if) the
// relationship strengthens with more seasons.
const MIN_R_SQUARED = 0.02;

// Defensive bound on the final multiplier -- however the data shakes out,
// never let fielding swing Overall by more than 3x today's flat weight in
// either direction. A real, earned difference should show up well inside
// this range; anything trying to exceed it is more likely noise.
const MAX_MULTIPLIER = 3;

async function main() {
  const supabase = makeSupabaseClient();

  console.log("Loading rating-validation hitter data...");
  const points = await getRatingValidationPoints();
  const hitters = points.filter((p) => p.playerType === "hitter" && p.grades.fielding != null);
  console.log(`  ${hitters.length} hitters with a fielding grade`);
  if (hitters.length < 20) {
    throw new Error(`Only ${hitters.length} hitters with a fielding grade -- too small to compute anything meaningful. Aborting.`);
  }

  const pooledPoints = hitters.map((p) => ({ x: p.grades.fielding as number, y: p.warRate }));
  const pooledFit = fitLine(pooledPoints);
  console.log(`Pooled fielding slope: ${pooledFit.slope.toFixed(4)} (n=${hitters.length}, R²=${pooledFit.rSquared.toFixed(3)})`);

  const byRole = new Map<string, typeof hitters>();
  for (const p of hitters) {
    if (!byRole.has(p.role)) byRole.set(p.role, []);
    byRole.get(p.role)!.push(p);
  }

  const rows: { role: string; rawSlope: number; sampleSize: number }[] = [];
  for (const role of ROLE_ORDER) {
    const group = byRole.get(role) ?? [];
    if (group.length < 5) {
      console.warn(`  ${role}: only ${group.length} players -- not enough to fit its own slope, using the pooled slope directly`);
      rows.push({ role, rawSlope: pooledFit.slope, sampleSize: group.length });
      continue;
    }
    const fit = fitLine(group.map((p) => ({ x: p.grades.fielding as number, y: p.warRate })));
    rows.push({ role, rawSlope: fit.slope, sampleSize: group.length });
  }

  // Isotonic projection across the real, known order -- guarantees the
  // final slopes can never contradict the confirmed defensive spectrum,
  // regardless of what one season's noisy per-role regression says alone.
  const orderedSlopes = isotonicRegressionNonIncreasing(rows.map((r) => r.rawSlope), rows.map((r) => r.sampleSize));

  const pooledSlopeUsable = Math.abs(pooledFit.slope) >= MIN_POOLED_SLOPE;
  if (!pooledSlopeUsable) {
    console.warn(
      `Pooled slope (${pooledFit.slope.toFixed(4)}) is too close to zero to build a stable relative multiplier from -- ` +
      `every role will get a flat x1.00 this run rather than a number the data doesn't actually support yet.`
    );
  }
  const relationshipIsMeaningful = pooledFit.rSquared >= MIN_R_SQUARED;
  if (!relationshipIsMeaningful) {
    console.warn(
      `Pooled R² (${pooledFit.rSquared.toFixed(3)}) is below the ${MIN_R_SQUARED} floor -- the fielding-vs-WAR ` +
      `relationship isn't established enough yet to trust ANY role's differentiation from it. Every role gets a ` +
      `flat x1.00 this run (today's unchanged behavior) regardless of what an individual role's slope looks like.`
    );
  }

  console.log("Per-role fielding weights (raw -> ordered -> shrunk -> multiplier):");
  const results = rows.map((r, i) => {
    const orderedSlope = orderedSlopes[i];
    const shrinkWeight = r.sampleSize / (r.sampleSize + SHRINKAGE_K);
    const shrunkSlope = pooledFit.slope + (orderedSlope - pooledFit.slope) * shrinkWeight;
    let relativeMultiplier = (pooledSlopeUsable && relationshipIsMeaningful) ? shrunkSlope / pooledFit.slope : 1;
    // Never let fielding SUBTRACT value -- a defensive specialist should
    // never rate below an offensively-identical player with worse fielding,
    // which a negative multiplier would do. Also bound the top end (see
    // MAX_MULTIPLIER comment above).
    relativeMultiplier = Math.max(0, Math.min(MAX_MULTIPLIER, relativeMultiplier));
    console.log(
      `  ${r.role.padEnd(4)} raw=${r.rawSlope.toFixed(4)} ordered=${orderedSlope.toFixed(4)} shrunk=${shrunkSlope.toFixed(4)} -> x${relativeMultiplier.toFixed(2)}  (n=${r.sampleSize})`
    );
    return { role: r.role, rawSlope: r.rawSlope, orderedSlope, shrunkSlope, relativeMultiplier, sampleSize: r.sampleSize };
  });

  console.log("Finding latest refresh run (for tagging this computation)...");
  const { data: runRow, error: runErr } = await supabase
    .from("refresh_runs").select("id").order("id", { ascending: false }).limit(1).single();
  if (runErr || !runRow) throw new Error(`No refresh_runs found: ${runErr?.message}`);
  const refreshRunId = (runRow as { id: number }).id;

  console.log("Writing fielding_role_weights...");
  const { error: writeErr } = await supabase.from("fielding_role_weights").upsert(
    results.map((r) => ({
      refresh_run_id: refreshRunId,
      role: r.role,
      raw_slope: r.rawSlope,
      pooled_slope: pooledFit.slope,
      ordered_slope: r.orderedSlope,
      shrunk_slope: r.shrunkSlope,
      relative_multiplier: r.relativeMultiplier,
      sample_size: r.sampleSize,
    })) as never[],
    { onConflict: "refresh_run_id,role" }
  );
  if (writeErr) throw new Error(`fielding_role_weights upsert failed: ${writeErr.message}`);

  console.log("Done.");
}

main().catch((err) => {
  console.error("compute-fielding-weights failed:", err);
  process.exit(1);
});
