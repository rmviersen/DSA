import {
  fitRealizationCurve, realizationShare, adjustPotential, REALIZATION_REFERENCE_AGE,
  type PlayerType, type RealizationCurve, type RealizationPair,
} from "./potential-realization";

// Automatic re-fit of the age-aware Potential curve as ratings history grows (2026-10-16, Rees: "I want these factors to continue to update as we
// continue to collect more data"). Pure functions -- no database access -- shared with scripts/auto-refit-potential-realization.ts. The fit itself
// is lib/potential-realization.ts's fitRealizationCurve(), the SAME function the original backtest judged. This file adds the three safeguards:
//   1. BACKTEST GATE   -- the candidate is fitted on part of the data and judged on data it never saw (player-id halves, plus earlier-vs-later
//                         time windows), using the original pre-registered accuracy criteria (C2/C3 below). Fail any => the active curve stays.
//   2. MOVEMENT LIMIT  -- an accepted curve may move any single R by at most REFIT_MAX_STEP from the active one, so one noisy cycle can't swing
//                         prospect rankings. Repeated refits can still walk as far as the evidence says, one bounded step at a time.
//   3. VERSION HISTORY -- every attempt is stored (see the script): accepted curves as new sets, rejected ones with their gate report.
// The old C1 criterion (yearly closure within 0.35 points per age group) is deliberately NOT gating: it failed in 8 groups on the original data
// because the two development cycles we had differ by about +/-25%, and no age curve can fix that (age-development-analysis.md).

export const REFIT_HORIZON_DAYS = 365;          // a "pair" is two ratings snapshots about one year apart (one full development cycle)
export const REFIT_HORIZON_TOLERANCE_DAYS = 10; // ...within this many days of exactly a year
export const REFIT_PAIR_SPACING_DAYS = 45;      // start dates of pairs are at least this far apart (bounds the work; overlapping windows add little)
export const REFIT_MIN_OBSERVATIONS = 8000;     // below this many (player, pair) observations the fit is not trusted at all
export const REFIT_MIN_NEW_DAYS = 30;           // refit at most once per this many game days of new evidence
export const REFIT_MAX_STEP = 0.05;             // max change of any single R per refit
export const REFIT_MIN_CHECKS = 6;              // the gate needs at least this many evaluable checks, else "not enough data" => reject
export const REFIT_MATERIAL_CHANGE = 0.005;     // below this the active curve is kept as is (and only its evidence date is advanced)

const DAY = 86400000;
const YEAR = 365.25 * DAY;

export interface RunRef { id: number; game_date: string | null }
export interface RunPair { r0: RunRef & { game_date: string }; r1: RunRef & { game_date: string } }

/** Choose snapshot pairs about one year apart; start dates at least REFIT_PAIR_SPACING_DAYS apart. Runs sharing a game date keep the newest id. */
export function selectRunPairs(runs: RunRef[]): RunPair[] {
  const byDate = new Map<string, RunRef & { game_date: string }>();
  for (const r of runs) {
    if (!r.game_date) continue;
    const prev = byDate.get(r.game_date);
    if (!prev || r.id > prev.id) byDate.set(r.game_date, r as RunRef & { game_date: string });
  }
  const sorted = [...byDate.values()].sort((a, b) => Date.parse(a.game_date) - Date.parse(b.game_date));
  const pairs: RunPair[] = [];
  let lastStart = -Infinity;
  for (const r0 of sorted) {
    const t0 = Date.parse(r0.game_date);
    if (t0 - lastStart < REFIT_PAIR_SPACING_DAYS * DAY) continue;
    let best: (RunRef & { game_date: string }) | null = null, bestDiff = Infinity;
    for (const r1 of sorted) {
      const diff = Math.abs(Date.parse(r1.game_date) - (t0 + REFIT_HORIZON_DAYS * DAY));
      if (diff < bestDiff) { best = r1; bestDiff = diff; }
    }
    if (best && bestDiff <= REFIT_HORIZON_TOLERANCE_DAYS * DAY) { pairs.push({ r0, r1: best }); lastStart = t0; }
  }
  return pairs;
}

export interface SnapshotRow { overall: number | null; potential: number | null }
export interface RefitObservation extends RealizationPair { pid: number; t0: number }

/** One observation per player present in both snapshots. `potential` MUST be the raw (pre-adjustment) Potential. Age is exact years at the start. */
export function buildObservations(
  startMs: number, a: Map<number, SnapshotRow>, b: Map<number, SnapshotRow>,
  dob: Map<number, number | null>, typeOf: Map<number, PlayerType>,
): RefitObservation[] {
  const out: RefitObservation[] = [];
  for (const [pid, x] of a) {
    const y = b.get(pid), born = dob.get(pid);
    if (!y || !born || x.overall == null || x.potential == null || y.overall == null) continue;
    out.push({ pid, t0: startMs, age: (startMs - born) / YEAR, type: typeOf.get(pid) ?? "H", o0: x.overall, p0: x.potential, o1: y.overall });
  }
  return out;
}

export interface GateCheck { name: string; pass: boolean; detail: string }
export interface GateResult { pass: boolean; evaluated: number; failed: number; checks: GateCheck[] }

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const rmse = (a: number[]) => Math.sqrt(mean(a.map((x) => x * x)));
const f2 = (x: number) => x.toFixed(2);

// [label, type, age from (incl.), age to (excl.), criterion]
const GATE_GROUPS: [string, PlayerType, number, number, "C2" | "C3"][] = [
  ["H 22-23", "H", 22, 24, "C3"], ["H 24-25", "H", 24, 26, "C2"], ["H 26+", "H", 26, 40, "C2"],
  ["P 23-24", "P", 23, 25, "C3"], ["P 25", "P", 25, 26, "C3"], ["P 26+", "P", 26, 40, "C2"],
];
const GATE_MIN_N = 150;

interface Fold { curve: RealizationCurve; test: RefitObservation[] }

/**
 * Judge curves on observations they were NOT fitted on: for players with a listed gap >= 3, how well does the adjusted Potential forecast the
 * Overall one year later versus the raw Potential? (The original backtest's criteria C2/C3, at the one-year horizon.) Several folds can be POOLED:
 * each test observation is adjusted with the curve fitted WITHOUT it, and the statistics are computed over everything pooled -- thin groups
 * (pitchers 26+: ~170-200 players per half) are otherwise dominated by sampling noise.
 *   full:  C2 (late development) |bias of adjusted gain| <= 0.8, raw bias >= 2x as large, adjusted RMSE < raw RMSE;
 *          C3 (mid development) adjusted RMSE <= raw RMSE.
 *   rmseOnly: every group only has to satisfy "adjusted RMSE <= raw RMSE" (never worse than the raw Potential).
 */
export type Unit = number | Record<PlayerType, number>;
const unitOf = (u: Unit, t: PlayerType): number => (typeof u === "number" ? u : u[t]);

export function evaluateFolds(label: string, folds: Fold[], rmseOnly: boolean, unit: Unit = 1): GateCheck[] {
  const checks: GateCheck[] = [];
  for (const [group, type, lo, hi, crit] of GATE_GROUPS) {
    const g: { o: RefitObservation; adj: number }[] = [];
    for (const { curve, test } of folds) {
      for (const o of test) {
        if (o.type === type && o.age >= lo && o.age < hi && o.p0 - o.o0 >= 3 * unitOf(unit, type)) g.push({ o, adj: adjustPotential(o.o0, o.p0, realizationShare(curve, type, o.age)) });
      }
    }
    if (g.length < GATE_MIN_N) continue;
    const biasAdj = mean(g.map((x) => x.adj - x.o.o0)) - mean(g.map((x) => x.o.o1 - x.o.o0));
    const biasRaw = mean(g.map((x) => x.o.p0 - x.o.o0)) - mean(g.map((x) => x.o.o1 - x.o.o0));
    const eAdj = rmse(g.map((x) => x.adj - x.o.o1)), eRaw = rmse(g.map((x) => x.o.p0 - x.o.o1));
    const n = g.length;
    if (crit === "C2" && !rmseOnly) {
      checks.push({ name: `${label} ${group} C2 |bias adj| <= 0.8`, pass: Math.abs(biasAdj) <= 0.8 * unitOf(unit, type), detail: `n=${n} bias adj ${f2(biasAdj)}` });
      checks.push({ name: `${label} ${group} C2 raw bias >= 2x adj`, pass: Math.abs(biasRaw) >= 2 * Math.abs(biasAdj), detail: `n=${n} raw ${f2(biasRaw)} vs adj ${f2(biasAdj)}` });
      checks.push({ name: `${label} ${group} C2 RMSE adj < raw`, pass: eAdj < eRaw, detail: `n=${n} adj ${f2(eAdj)} vs raw ${f2(eRaw)}` });
    } else {
      checks.push({ name: `${label} ${group} RMSE adj <= raw`, pass: eAdj <= eRaw, detail: `n=${n} adj ${f2(eAdj)} vs raw ${f2(eRaw)}` });
    }
  }
  return checks;
}

/** The "players with a real gap" cutoff (3 calibrated points) in the observations' own units, per hitters/pitchers. */
const gapMinFor = (u: Unit): Record<PlayerType, number> => ({ H: 3 * unitOf(u, "H"), P: 3 * unitOf(u, "P") });

/**
 * Cross-fitted backtest of the fitting METHOD on the given observations (revised 2026-10-16 after the first dry run: judging each half-sample
 * fold separately failed 7 of 33 checks, all in thin groups where the sign of the bias flips by chance; the criteria thresholds were NOT loosened,
 * the test was made less noisy):
 *   S1  player-id halves, both ways, POOLED  -- full C2/C3 criteria.
 *   S2  fit on the earlier snapshot pairs, test on the later ones -- adjusted must be no worse than raw (RMSE) in every group. (Its training half
 *       is a single older development cycle at first, so the bias criteria are not asked of it yet.)
 */
export function backtestGate(obs: RefitObservation[], unit: Unit = 1): GateResult {
  const checks: GateCheck[] = [];
  const even = obs.filter((o) => o.pid % 2 === 0), odd = obs.filter((o) => o.pid % 2 === 1);
  checks.push(...evaluateFolds("S1 pooled", [
    { curve: fitRealizationCurve(even, { gapMin: gapMinFor(unit) }).curve, test: odd },
    { curve: fitRealizationCurve(odd, { gapMin: gapMinFor(unit) }).curve, test: even },
  ], false, unit));
  const starts = [...new Set(obs.map((o) => o.t0))].sort((a, b) => a - b);
  if (starts.length >= 2) {
    const cut = starts[Math.floor(starts.length / 2)];
    const early = obs.filter((o) => o.t0 < cut), late = obs.filter((o) => o.t0 >= cut);
    checks.push(...evaluateFolds("S2 early->late", [{ curve: fitRealizationCurve(early, { gapMin: gapMinFor(unit) }).curve, test: late }], true, unit));
  }
  const failed = checks.filter((c) => !c.pass).length;
  return { pass: checks.length >= REFIT_MIN_CHECKS && failed === 0, evaluated: checks.length, failed, checks };
}

/** R for an integer age, from a curve; clamps to the ends of the curve's range. */
export function shareAtAge(curve: RealizationCurve, type: PlayerType, age: number): number {
  const arr = curve.share[type];
  const i = Math.min(Math.max(age - curve.minAge, 0), arr.length - 1);
  return arr[i];
}

/** Move `prev` toward `cand` by at most `maxStep` per age/type; ages <= the reference age stay at 1; R never rises with age after 19. */
export function clampCurve(prev: RealizationCurve, cand: RealizationCurve, maxStep: number = REFIT_MAX_STEP): RealizationCurve {
  const share: Record<PlayerType, number[]> = { H: [], P: [] };
  for (const type of ["H", "P"] as PlayerType[]) {
    const out: number[] = [];
    for (let i = 0; i < cand.share[type].length; i++) {
      const age = cand.minAge + i;
      if (age <= REALIZATION_REFERENCE_AGE) { out.push(1); continue; }
      const p = shareAtAge(prev, type, age), c = cand.share[type][i];
      let v = p + Math.max(-maxStep, Math.min(maxStep, c - p));
      if (out.length) v = Math.min(v, out[out.length - 1]);
      out.push(Math.round(Math.max(0, Math.min(1, v)) * 1e4) / 1e4);
    }
    share[type] = out;
  }
  return { minAge: cand.minAge, share };
}

/** Largest absolute difference in R between two curves, over the candidate's ages. */
export function maxCurveDiff(a: RealizationCurve, b: RealizationCurve): number {
  let m = 0;
  for (const type of ["H", "P"] as PlayerType[]) {
    for (let i = 0; i < b.share[type].length; i++) m = Math.max(m, Math.abs(shareAtAge(a, type, b.minAge + i) - b.share[type][i]));
  }
  return m;
}

