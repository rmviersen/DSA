// Rating sanity checks (2026-10-06, after the role-multiplier incident -- see HANDOFF.md).
//
// What happened: the retired role-calibrated fielding multipliers flipped from a flat x1.0 to x0.67-2.4
// because a pooled R² landed at 0.021 vs a 0.020 gate. Every infielder/outfielder/catcher's raw Overall
// jumped ~16-20 points, the MLB hitter mean went 51 -> 65.5 and its SD 3.2 -> 9.8, and every 1B/DH
// (Jeremy Porten, one of the league's best bats, read 44.1) was crushed -- and NOTHING noticed: the
// pipeline wrote the bad ratings, marked the run succeeded, the badge said "Current", and the
// self-training weight scripts kept regressing on top of them.
//
// These checks exist so a run like that is REFUSED before it is written (compute-ratings.ts) and
// flagged by an independent audit afterwards (scripts/verify-ratings.ts). The tolerances are set from
// the real history: across 40 runs spanning a year (2031-06 -> 2032-07) the MLB hitter mean never moved
// more than ~0.2 between runs (range 50.66-51.11), the hitter SD stayed 3.13-3.50, the pitcher mean
// 47.15-48.26, the pitcher SD 4.51-4.74, and the spread between the highest and lowest hitter-ROLE mean
// raw Overall was ~3.4 points. The bad run read 65.5 / 9.8 and a ~24-point role spread.
//
// A deliberate methodology change (e.g. a hand-edited weight) can legitimately move these; set
// RATINGS_ACCEPT_SHIFT=1 (or pass --accept-shift to compute-ratings.ts) to let that one run through.

export interface RatingDistribution {
  hitterMean: number;
  hitterSd: number;
  pitcherMean: number;
  pitcherSd: number;
  // Mean RAW Overall of the MLB reference-pool hitters, by role (C, 1B, INF, SS, CF, COF, DH).
  hitterRoleMeans: Record<string, { mean: number; n: number }>;
}

export interface PreviousDistribution {
  runId: number;
  hitterMean: number;
  hitterSd: number;
  pitcherMean: number;
  pitcherSd: number;
}

export const RATING_SANITY = {
  // Absolute shift of the type mean vs the previous run's, in raw-Overall points (history: <= ~0.3).
  maxMeanShift: 2.0,
  // New SD / previous SD must stay inside this band (history: 0.85-1.15 over a year).
  sdRatioMin: 0.8,
  sdRatioMax: 1.25,
  // Highest minus lowest hitter-role mean raw Overall (history ~3.4; the bad run was ~24).
  maxRoleMeanSpread: 8,
  // A role needs at least this many reference-pool hitters to be counted in the spread check.
  minRoleSampleSize: 15,
  // Role fielding multipliers (retired mechanism, defense in depth): anything outside is refused.
  fieldingMultiplierMin: 0.5,
  fieldingMultiplierMax: 1.5,
} as const;

export function acceptShiftOverride(): boolean {
  return process.env.RATINGS_ACCEPT_SHIFT === "1" || process.argv.includes("--accept-shift");
}

/** Returns a list of human-readable problems; empty means the distribution looks sane. */
export function checkRatingDistribution(current: RatingDistribution, previous: PreviousDistribution | null): string[] {
  const problems: string[] = [];
  const fmt = (n: number) => n.toFixed(2);

  if (previous) {
    const hMeanShift = current.hitterMean - previous.hitterMean;
    if (Math.abs(hMeanShift) > RATING_SANITY.maxMeanShift) {
      problems.push(`hitter mean raw Overall moved ${fmt(hMeanShift)} (${fmt(previous.hitterMean)} -> ${fmt(current.hitterMean)} vs run ${previous.runId}); limit +/-${RATING_SANITY.maxMeanShift}`);
    }
    const pMeanShift = current.pitcherMean - previous.pitcherMean;
    if (Math.abs(pMeanShift) > RATING_SANITY.maxMeanShift) {
      problems.push(`pitcher mean raw Overall moved ${fmt(pMeanShift)} (${fmt(previous.pitcherMean)} -> ${fmt(current.pitcherMean)} vs run ${previous.runId}); limit +/-${RATING_SANITY.maxMeanShift}`);
    }
    if (previous.hitterSd > 0) {
      const ratio = current.hitterSd / previous.hitterSd;
      if (ratio < RATING_SANITY.sdRatioMin || ratio > RATING_SANITY.sdRatioMax) {
        problems.push(`hitter raw-Overall SD changed by x${fmt(ratio)} (${fmt(previous.hitterSd)} -> ${fmt(current.hitterSd)} vs run ${previous.runId}); allowed x${RATING_SANITY.sdRatioMin}-x${RATING_SANITY.sdRatioMax}`);
      }
    }
    if (previous.pitcherSd > 0) {
      const ratio = current.pitcherSd / previous.pitcherSd;
      if (ratio < RATING_SANITY.sdRatioMin || ratio > RATING_SANITY.sdRatioMax) {
        problems.push(`pitcher raw-Overall SD changed by x${fmt(ratio)} (${fmt(previous.pitcherSd)} -> ${fmt(current.pitcherSd)} vs run ${previous.runId}); allowed x${RATING_SANITY.sdRatioMin}-x${RATING_SANITY.sdRatioMax}`);
      }
    }
  }

  const roles = Object.entries(current.hitterRoleMeans).filter(([, v]) => v.n >= RATING_SANITY.minRoleSampleSize);
  if (roles.length >= 2) {
    const means = roles.map(([, v]) => v.mean);
    const hi = Math.max(...means), lo = Math.min(...means);
    if (hi - lo > RATING_SANITY.maxRoleMeanSpread) {
      const detail = roles.map(([r, v]) => `${r}=${fmt(v.mean)}`).join(", ");
      problems.push(`hitter roles disagree by ${fmt(hi - lo)} raw-Overall points between the highest and lowest role mean (${detail}); limit ${RATING_SANITY.maxRoleMeanSpread}`);
    }
  }
  return problems;
}

/** Role fielding multipliers must stay inside [min, max]; empty result means fine. */
export function checkFieldingMultipliers(multipliers: Record<string, number>): string[] {
  const problems: string[] = [];
  for (const [role, m] of Object.entries(multipliers)) {
    if (!Number.isFinite(m) || m < RATING_SANITY.fieldingMultiplierMin || m > RATING_SANITY.fieldingMultiplierMax) {
      problems.push(`fielding multiplier for ${role} is ${m} (allowed ${RATING_SANITY.fieldingMultiplierMin}-${RATING_SANITY.fieldingMultiplierMax})`);
    }
  }
  return problems;
}
