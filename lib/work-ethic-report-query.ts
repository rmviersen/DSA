import { makeSupabaseClient } from "./supabase-client";
import { fitLogistic } from "./logistic";

const supabase = makeSupabaseClient();

// Work Ethic vs. reaching the majors (2026-09-19, Rees: "% of players that make the
// major leagues with low vs normal vs high work ethic", then "cater this analysis
// towards adding work ethic into our prospect potential rating"). The cohort itself
// is built in SQL (work_ethic_mlb_cohort, see its migration comment); everything
// statistical happens here so the page can show exactly what was counted.

export type WorkEthic = "H" | "N" | "L";
export const WE_ORDER: WorkEthic[] = ["L", "N", "H"];
export const WE_LABEL: Record<WorkEthic, string> = { L: "Low", N: "Normal", H: "High" };

interface CohortRow { we: WorkEthic; pp: number; age: number; mlb: boolean; debut: number | null; retired: boolean }

export interface GroupStat { n: number; mlb: number; pct: number; lo: number; hi: number; retiredNoMlb: number; activeNoMlb: number }
export interface StratumStat { label: string; byWe: Record<WorkEthic, GroupStat> }

export interface WorkEthicReport {
  baselineRun: number;
  baselineDate: string;
  baselineYear: number;
  dataThrough: string | null; // in-game date of the latest succeeded refresh
  maxAge: number;
  totalInBaseline: number;
  exclusions: { key: string; label: string; n: number }[];
  cohortSize: number;
  totalMlb: number;
  overall: Record<WorkEthic, GroupStat>;
  byPotentialTier: StratumStat[];
  byAge: StratumStat[];
  model: null | {
    n: number;
    events: number;
    converged: boolean;
    ppCoef: number;            // log-odds per +1 prospect-potential point
    ppSe: number;
    highOdds: number;          // odds ratio High vs Normal, holding potential+age fixed
    lowOdds: number;
    highOddsCi: [number, number];
    lowOddsCi: [number, number];
    highPointsEquiv: number | null; // prospect-potential points a High grade is "worth"
    highPointsCi: [number, number] | null;
    lowPointsEquiv: number | null;
    lowPointsCi: [number, number] | null;
    highP: number;             // two-sided p (Wald)
    lowP: number;
    ppP: number;
  };
}

// Wilson score interval -- behaves sensibly at tiny counts / 0% / 100%, unlike the
// normal approximation (which matters a lot here: some cells have 0-5 events).
function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96, p = k / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

function group(rows: CohortRow[]): GroupStat {
  const n = rows.length;
  const mlb = rows.filter((r) => r.mlb).length;
  const [lo, hi] = wilson(mlb, n);
  return {
    n, mlb, pct: n ? mlb / n : 0, lo, hi,
    retiredNoMlb: rows.filter((r) => !r.mlb && r.retired).length,
    activeNoMlb: rows.filter((r) => !r.mlb && !r.retired).length,
  };
}

function byWe(rows: CohortRow[]): Record<WorkEthic, GroupStat> {
  return { L: group(rows.filter((r) => r.we === "L")), N: group(rows.filter((r) => r.we === "N")), H: group(rows.filter((r) => r.we === "H")) };
}

// Two-sided p from a z statistic (normal approximation, erf-free).
function pFromZ(z: number): number {
  const a = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * a);
  const d = 0.3989423 * Math.exp((-a * a) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return Math.min(1, 2 * p);
}

const EXCLUSION_LABELS: Record<string, string> = {
  no_work_ethic_grade: "No Work Ethic grade in the baseline ratings",
  no_prospect_potential: "No prospect potential computed at baseline",
  no_birthdate: "No birthdate on file",
  older_than_max_age: "Older than the age cutoff at baseline",
  already_in_mlb_before_baseline_season: "Had already played in MLB before the baseline season",
};

export async function getWorkEthicMlbReport(leagueId: number, maxAge: number): Promise<WorkEthicReport | null> {
  // Baseline = the earliest succeeded refresh that has a game date AND ratings -- the
  // widest look-forward window our snapshot history allows.
  const { data: runRow } = await supabase.from("refresh_runs").select("id,game_date")
    .eq("dsa_league_id", leagueId).eq("status", "succeeded").eq("ratings_included", true).not("game_date", "is", null)
    .order("id", { ascending: true }).limit(1).maybeSingle();
  if (!runRow) return null;
  const baselineRun = (runRow as { id: number }).id;

  const { data, error } = await supabase.rpc("work_ethic_mlb_cohort", { p_league_id: leagueId, p_baseline_run: baselineRun, p_max_age: maxAge } as never);
  if (error) throw error;
  const j = data as unknown as { baseline_date: string; baseline_year: number; total_in_baseline_ratings: number; exclusions: Record<string, number>; rows: CohortRow[] };
  const rows = j.rows;

  const { data: latest } = await supabase.from("refresh_runs").select("game_date")
    .eq("dsa_league_id", leagueId).eq("status", "succeeded").not("game_date", "is", null).order("id", { ascending: false }).limit(1).maybeSingle();

  // Potential tiers: quintiles of the COHORT's own prospect potential.
  const sortedPp = rows.map((r) => r.pp).sort((a, b) => a - b);
  const cut = [0.2, 0.4, 0.6, 0.8].map((q) => sortedPp[Math.floor(q * (sortedPp.length - 1))]);
  const tierOf = (pp: number) => cut.filter((c) => pp > c).length; // 0..4
  const tierLabel = (t: number) => {
    const lo = t === 0 ? sortedPp[0] : cut[t - 1];
    const hi = t === 4 ? sortedPp[sortedPp.length - 1] : cut[t];
    return `Q${t + 1}: ${lo.toFixed(0)}–${hi.toFixed(0)}`;
  };
  const byPotentialTier: StratumStat[] = [4, 3, 2, 1, 0].map((t) => ({ label: `${tierLabel(t)}${t === 4 ? " (top)" : t === 0 ? " (bottom)" : ""}`, byWe: byWe(rows.filter((r) => tierOf(r.pp) === t)) }));

  const ageBuckets: [string, (a: number) => boolean][] = [
    ["Under 20", (a) => a < 20], ["20–21", (a) => a >= 20 && a < 22], ["22–23", (a) => a >= 22 && a < 24],
    ["24–25", (a) => a >= 24 && a < 26], ["26+", (a) => a >= 26],
  ];
  const byAge: StratumStat[] = ageBuckets.map(([label, f]) => ({ label, byWe: byWe(rows.filter((r) => f(r.age))) })).filter((s) => s.byWe.L.n + s.byWe.N.n + s.byWe.H.n > 0);

  // Logistic model: made MLB ~ prospect potential + age + High + Low (Normal = reference).
  let model: WorkEthicReport["model"] = null;
  if (rows.length >= 200) {
    const fit = fitLogistic(rows.map((r) => [r.pp, r.age, r.we === "H" ? 1 : 0, r.we === "L" ? 1 : 0]), rows.map((r) => (r.mlb ? 1 : 0)));
    if (fit) {
      const [, bPp, , bH, bL] = fit.coefficients;
      const [, sPp, , sH, sL] = fit.standardErrors;
      const cov = fit.covariance;
      const ci = (b: number, s: number): [number, number] => [Math.exp(b - 1.96 * s), Math.exp(b + 1.96 * s)];
      // "Potential-point equivalent": how many prospect-potential points shift the log-odds of
      // reaching MLB as much as the makeup grade does. Delta-method CI on the ratio b/bPp.
      const equiv = (b: number, idx: number) => {
        if (bPp <= 0) return { v: null as number | null, ci: null as [number, number] | null };
        const v = b / bPp;
        const varR = cov[idx][idx] / (bPp * bPp) + (b * b * cov[1][1]) / bPp ** 4 - (2 * b * cov[idx][1]) / bPp ** 3;
        const se = Math.sqrt(Math.max(varR, 0));
        return { v, ci: [v - 1.96 * se, v + 1.96 * se] as [number, number] };
      };
      const eH = equiv(bH, 3), eL = equiv(bL, 4);
      model = {
        n: rows.length, events: rows.filter((r) => r.mlb).length, converged: fit.converged,
        ppCoef: bPp, ppSe: sPp,
        highOdds: Math.exp(bH), lowOdds: Math.exp(bL), highOddsCi: ci(bH, sH), lowOddsCi: ci(bL, sL),
        highPointsEquiv: eH.v, highPointsCi: eH.ci, lowPointsEquiv: eL.v, lowPointsCi: eL.ci,
        highP: pFromZ(bH / sH), lowP: pFromZ(bL / sL), ppP: pFromZ(bPp / sPp),
      };
    }
  }

  return {
    baselineRun, baselineDate: j.baseline_date, baselineYear: j.baseline_year,
    dataThrough: (latest as { game_date: string } | null)?.game_date ?? null,
    maxAge, totalInBaseline: j.total_in_baseline_ratings,
    exclusions: Object.entries(j.exclusions).map(([key, n]) => ({ key, label: EXCLUSION_LABELS[key] ?? key, n })).sort((a, b) => b.n - a.n),
    cohortSize: rows.length, totalMlb: rows.filter((r) => r.mlb).length,
    overall: byWe(rows), byPotentialTier, byAge, model,
  };
}
