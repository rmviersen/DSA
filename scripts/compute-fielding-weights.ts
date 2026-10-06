import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { getLeagueId, leagueSlugFromArgv } from "../lib/league.js";
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
//
// REWORKED 2026-10-06 (the 2026-10-06 incident): this used to be a hard on/off
// switch at 0.02. With a full 2032 season of data the pooled R² came in at
// 0.021 -- a hair over the line -- and EVERY role flipped from a flat x1.0 to
// x1.6-2.4 (SS/CF/INF/COF/C) or x0.67-0.80 (1B/DH) overnight, even though a
// 0.021 R² explains 2% of the variance and SS's own raw slope was NEGATIVE.
// Because Overall isn't re-normalized, that inflated every infielder/outfielder/
// catcher's raw Overall by ~16-20 points, dragged the MLB hitter mean from 51 to
// 65 and the SD from 3.2 to 9.8, and crushed every 1B/DH (Jeremy Porten, one of
// the best bats in the league, read 44.1). A threshold with a cliff on a number
// that can land within rounding error of it is the bug, so now:
//   * R² only STARTS to matter at MIN_R_SQUARED and ramps linearly up to its
//     full effect at FULL_EFFECT_R_SQUARED -- a hair over the floor moves the
//     multipliers by a hair, never by 2x.
//   * The ramped multipliers are re-centred so their sample-weighted mean is
//     exactly 1 -- role weights can redistribute fielding's importance between
//     positions but can never inflate or deflate the whole hitter scale.
//   * Final bounds are [MIN_MULTIPLIER, MAX_MULTIPLIER] = [0.5, 1.5].
//   * The pooled slope must be POSITIVE (better fielding -> more WAR); a flat or
//     negative pooled relationship builds no role differentiation at all.
const MIN_R_SQUARED = 0.02;
const FULL_EFFECT_R_SQUARED = 0.10;

// Defensive bounds on the final multiplier -- however the data shakes out,
// never let fielding swing Overall by more than 1.5x / 0.5x today's flat weight.
// (Was a 3x ceiling and no floor before 2026-10-06; a real, earned difference
// belongs well inside this range, anything outside it is more likely noise.)
const MIN_MULTIPLIER = 0.5;
const MAX_MULTIPLIER = 1.5;

async function main() {
  const supabase = makeSupabaseClient();
  const leagueId = await getLeagueId(supabase, leagueSlugFromArgv());

  console.log("Loading rating-validation hitter data...");
  const points = await getRatingValidationPoints(leagueId);
  const hitters = points.filter((p) => p.playerType === "hitter" && p.grades.fielding != null);
  console.log(`  ${hitters.length} hitters with a fielding grade`);
  if (points.length === 0) {
    // Not an error -- getRatingValidationPoints() already logged why (almost
    // always a brand-new season with zero games played yet, the same
    // condition compute-hitting-weights.ts and its 4 siblings handle this
    // same way -- see HANDOFF.md gotcha 39). A real, if small, sample
    // (1-19 hitters) still throws below, since that's a genuinely different
    // situation worth investigating, not just "too early in the season."
    console.log("No rating-validation points at all this run -- skipping, nothing to compute.");
    return;
  }
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

  // Needs a clearly positive pooled slope (better fielding -> more WAR); a slope near zero
  // or negative can't anchor a "relative" multiplier (see MIN_POOLED_SLOPE above).
  const pooledSlopeUsable = pooledFit.slope >= MIN_POOLED_SLOPE;
  if (!pooledSlopeUsable) {
    console.warn(
      `Pooled slope (${pooledFit.slope.toFixed(4)}) is not clearly positive (needs >= ${MIN_POOLED_SLOPE}) -- ` +
      `every role will get a flat x1.00 this run rather than a number the data doesn't actually support yet.`
    );
  }
  // Smooth ramp instead of an on/off switch: 0 at R² <= MIN_R_SQUARED, 1 at R² >= FULL_EFFECT_R_SQUARED.
  const evidenceRamp = pooledSlopeUsable
    ? Math.max(0, Math.min(1, (pooledFit.rSquared - MIN_R_SQUARED) / (FULL_EFFECT_R_SQUARED - MIN_R_SQUARED)))
    : 0;
  console.log(
    `Evidence ramp: pooled R² ${pooledFit.rSquared.toFixed(3)} (starts mattering at ${MIN_R_SQUARED}, full effect at ${FULL_EFFECT_R_SQUARED}) -> ` +
    `role differentiation applied at ${(evidenceRamp * 100).toFixed(1)}% strength.`
  );

  console.log("Per-role fielding weights (raw -> ordered -> shrunk -> unramped multiplier -> final):");
  const staged = rows.map((r, i) => {
    const orderedSlope = orderedSlopes[i];
    const shrinkWeight = r.sampleSize / (r.sampleSize + SHRINKAGE_K);
    const shrunkSlope = pooledFit.slope + (orderedSlope - pooledFit.slope) * shrinkWeight;
    const fullStrengthMultiplier = pooledSlopeUsable ? shrunkSlope / pooledFit.slope : 1;
    // Blend from a flat 1.0 toward the full-strength multiplier by how much evidence there is.
    const rampedMultiplier = 1 + (fullStrengthMultiplier - 1) * evidenceRamp;
    return { role: r.role, rawSlope: r.rawSlope, orderedSlope, shrunkSlope, fullStrengthMultiplier, rampedMultiplier, sampleSize: r.sampleSize };
  });
  // Re-centre so the sample-weighted mean multiplier is exactly 1: role weights may MOVE fielding's
  // importance between positions, never inflate or deflate the whole hitter scale (every hitter's raw
  // Overall includes fielding * this multiplier and calibration is anchored on the hitter population).
  const totalN = staged.reduce((s, r) => s + r.sampleSize, 0);
  const weightedMean = totalN > 0 ? staged.reduce((s, r) => s + r.rampedMultiplier * r.sampleSize, 0) / totalN : 1;
  const centre = weightedMean > 0 ? weightedMean : 1;
  const results = staged.map((r) => {
    // Never let fielding SUBTRACT value (a negative multiplier would rate a defensive specialist below an
    // offensively-identical player with worse fielding), and keep it inside [MIN_MULTIPLIER, MAX_MULTIPLIER].
    const relativeMultiplier = Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, r.rampedMultiplier / centre));
    console.log(
      `  ${r.role.padEnd(4)} raw=${r.rawSlope.toFixed(4)} ordered=${r.orderedSlope.toFixed(4)} shrunk=${r.shrunkSlope.toFixed(4)} -> ` +
      `full x${r.fullStrengthMultiplier.toFixed(2)} -> final x${relativeMultiplier.toFixed(3)}  (n=${r.sampleSize})`
    );
    return { role: r.role, rawSlope: r.rawSlope, orderedSlope: r.orderedSlope, shrunkSlope: r.shrunkSlope, relativeMultiplier, sampleSize: r.sampleSize };
  });

  console.log("Finding latest refresh run (for tagging this computation)...");
  const { data: runRow, error: runErr } = await supabase
    .from("refresh_runs").select("id").eq("dsa_league_id", leagueId).order("id", { ascending: false }).limit(1).single();
  if (runErr || !runRow) throw new Error(`No refresh_runs found: ${runErr?.message}`);
  const refreshRunId = (runRow as { id: number }).id;

  console.log("Writing fielding_role_weights...");
  const { error: writeErr } = await supabase.from("fielding_role_weights").upsert(
    results.map((r) => ({
      refresh_run_id: refreshRunId,
      dsa_league_id: leagueId,
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
