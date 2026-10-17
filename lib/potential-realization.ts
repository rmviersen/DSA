import { isotonicRegressionNonIncreasing } from "./regression";

// Age-aware Potential: "how much of a player's listed Potential gap will actually be realized, given how much development time he has
// left" (2026-10-15, Rees: players stop progressing at certain ages, so Potential overrates 24+ players). Pure functions, no database
// or engine imports -- shared by scripts/backtest-potential-realization.ts, scripts/fit-potential-realization.ts and the rating engine
// so the function that was BACKTESTED is the function that SHIPS. Evidence and tables: age-development-analysis.md.
//
//   Potential_adjusted = Overall + R(age, type) x max(0, Potential - Overall),   R in [0, 1]
//
// R is built from measured yearly closure rates c(age, type): the share of a player's CURRENT gap (Potential minus Overall) that closed
// during the next year, over players with a gap of at least GAP_MIN. Chaining them gives the share of today's gap that is ever realized,
//   chain(a) = 1 - prod_{k = a..MAX_AGE} (1 - c_k)            (an upper bound: it ignores the extra downward revisions of Potential)
// and R(a) = min(1, chain(a) / chain(REFERENCE_AGE)). Normalizing at a young reference age leaves the youngest prospects' Potential (the
// level draft / ETA / prospect formulas were calibrated on) untouched and removes only the TIME-REMAINING effect -- the long-horizon
// payoff for 17-19 year olds can't be verified with ~19 months of history, so it is deliberately not applied.

export type PlayerType = "H" | "P";

export const REALIZATION_GAP_MIN = 3;        // only players with a real gap inform the closure rates
export const REALIZATION_MIN_N = 60;         // an age with fewer informative players is not trusted
export const REALIZATION_REFERENCE_AGE = 19; // chain(19) is the "full development ahead" baseline (R = 1 there)
export const REALIZATION_ISOTONIC_FROM = 22; // from this age on, closure may only fall with age (removes sampling zig-zags)
export const REALIZATION_MAX_AGE = 30;       // development is over by here for everyone
export const REALIZATION_TAIL_DECAY = 0.5;   // past the last well-measured age, closure halves each year (a stated assumption)
export const REALIZATION_MIN_AGE = 15;       // curve arrays start here

export interface RealizationPair { age: number; type: PlayerType; o0: number; p0: number; o1: number }
export interface RealizationCurve {
  minAge: number;                         // share[type][i] is R for players whose integer age is minAge + i
  share: Record<PlayerType, number[]>;
}
export interface ClosureRow { type: PlayerType; age: number; n: number; closure: number | null; smoothed: number }

/** Fit the closure rates and the realization curve from one-year (Overall, Potential) -> next-year Overall observations. */
export function fitRealizationCurve(pairs: RealizationPair[], opts: { gapMin?: number } = {}): { curve: RealizationCurve; closure: ClosureRow[]; closureAt: (type: PlayerType, age: number) => number } {
  const gapMin = opts.gapMin ?? REALIZATION_GAP_MIN;
  const closure: ClosureRow[] = [];
  const closureFns: Record<PlayerType, (age: number) => number> = { H: () => 0, P: () => 0 };
  const share: Record<PlayerType, number[]> = { H: [], P: [] };
  for (const type of ["H", "P"] as PlayerType[]) {
    // raw closure by integer age
    const raw = new Map<number, { c: number; n: number }>();
    for (let age = REALIZATION_MIN_AGE; age <= REALIZATION_MAX_AGE; age++) {
      const g = pairs.filter((p) => p.type === type && Math.floor(p.age) === age && p.p0 - p.o0 >= gapMin);
      if (g.length < REALIZATION_MIN_N) continue;
      const gap = g.reduce((s, p) => s + (p.p0 - p.o0), 0);
      const gained = g.reduce((s, p) => s + (p.o1 - p.o0), 0);
      raw.set(age, { c: Math.max(0, gained / gap), n: g.length });
    }
    const ages = [...raw.keys()].sort((a, b) => a - b);
    const lastAge = ages.length ? ages[ages.length - 1] : REALIZATION_MIN_AGE;
    // smoothed closure: monotone non-increasing from REALIZATION_ISOTONIC_FROM on, sample-size weighted. (A 3-point moving average was
    // tried as "version 2" on 2026-10-15 and backtested WORSE: it blurs the sharp hitter cliff at 24-25 -- R(24) rose from 0.19 to 0.27
    // while realized gains stayed ~0.5 -- and did not fix pitchers, whose mid-20s closure is simply noisy. Version 1 (this) was kept.)
    const smooth = new Map<number, number>(ages.map((a) => [a, raw.get(a)!.c]));
    const tailAges = ages.filter((a) => a >= REALIZATION_ISOTONIC_FROM);
    if (tailAges.length > 1) {
      const fitted = isotonicRegressionNonIncreasing(tailAges.map((a) => raw.get(a)!.c), tailAges.map((a) => raw.get(a)!.n));
      tailAges.forEach((a, i) => smooth.set(a, fitted[i]));
    }
    // c(age) for every age: measured/smoothed where known; before the first measured age use the first; after the last, halve each year
    const c = (age: number): number => {
      if (smooth.has(age)) return smooth.get(age)!;
      if (age < ages[0]) return smooth.get(ages[0]) ?? 0;
      let v = smooth.get(lastAge) ?? 0;
      for (let a = lastAge + 1; a <= age; a++) v *= REALIZATION_TAIL_DECAY;
      return v < 0.01 ? 0 : v;
    };
    closureFns[type] = c;
    for (const age of ages) closure.push({ type, age, n: raw.get(age)!.n, closure: raw.get(age)!.c, smoothed: smooth.get(age)! });
    const chain = (from: number): number => {
      let keep = 1;
      for (let a = from; a <= REALIZATION_MAX_AGE; a++) keep *= 1 - c(a);
      return 1 - keep;
    };
    const base = chain(REALIZATION_REFERENCE_AGE);
    for (let age = REALIZATION_MIN_AGE; age <= 40; age++) {
      share[type].push(base > 0 && age > REALIZATION_REFERENCE_AGE ? Math.min(1, chain(age) / base) : 1);
    }
  }
  return { curve: { minAge: REALIZATION_MIN_AGE, share }, closure, closureAt: (type, age) => closureFns[type](Math.floor(age)) };
}

/**
 * R for a player of the given exact age (years). Anchors are at age + 0.5 (a player whose integer age is a is, on average, a + 0.5),
 * interpolated linearly; clamped at both ends of the curve. A null / non-finite age means "no adjustment" (R = 1).
 */
export function realizationShare(curve: RealizationCurve | null | undefined, type: PlayerType, ageYears: number | null | undefined): number {
  if (!curve || ageYears == null || !Number.isFinite(ageYears)) return 1;
  const arr = curve.share[type];
  if (!arr || arr.length === 0) return 1;
  const x = ageYears - 0.5 - curve.minAge;
  if (x <= 0) return arr[0];
  if (x >= arr.length - 1) return arr[arr.length - 1];
  const i = Math.floor(x);
  const f = x - i;
  return arr[i] + (arr[i + 1] - arr[i]) * f;
}

/** Overall + R x gap, never below Overall (a negative gap is left alone -- Potential can never be graded below current ability). */
export function adjustPotential(overall: number, potential: number, share: number): number {
  const gap = potential - overall;
  return gap > 0 ? overall + share * gap : potential;
}
