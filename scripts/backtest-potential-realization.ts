import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { getLeagueId, leagueSlugFromArgv } from "../lib/league.js";
import { fitRealizationCurve, realizationShare, adjustPotential, type PlayerType, type RealizationPair, type RealizationCurve } from "../lib/potential-realization.js";

// BACKTEST of the age-aware Potential factor (2026-10-15, Rees: "apply it to the core Potential rating, backtest first"). Read-only; writes
// nothing. Tests the SAME functions that the rating engine uses (lib/potential-realization.ts), fitted on one part of the data and judged on
// data it never saw, two ways: (S1) holding out half the PLAYERS (even ids fit, odd ids test) and (S2) holding out whole time WINDOWS
// (fit on the windows that start 2031-06-23 / 2031-11-19, test on the ones that start 2031-12-31 / 2032-01-18).
//
// PASS / FAIL CRITERIA, written BEFORE running (units: our calibrated Overall points):
//   C1  One-step dynamics: for every age group with >= 300 test players, the fitted yearly closure predicts the next year's Overall gain
//       with |bias| <= 0.35.
//   C2  Late-development groups (hitters 24+, pitchers 26+), horizon ~1.13 and ~1.65 years: adjusted Potential's gain forecast
//       (R x gap) has |bias| <= 0.8, AND raw Potential's bias is at least 2x larger, AND adjusted RMSE < raw RMSE when forecasting the
//       Overall at the end of the horizon.
//   C3  Mid-development groups (hitters 22-23, pitchers 23-25), same horizons: adjusted RMSE <= raw RMSE (never worse than raw; the
//       adjusted number is an ULTIMATE-peak estimate, so it can still run above a 1.65-year outcome -- it only has to beat raw).
//   C4  No harm to the youngest: R >= 0.97 for ages 17-19.
//   Not verifiable with 19 months of history (stated, not tested): the ultimate realized share for players under ~23 (hitters) / ~25
//   (pitchers) -- it is an extrapolation of the yearly closure rates, anchored so that age 19 keeps its Potential unchanged.
//
// Usage: npx tsx scripts/backtest-potential-realization.ts <cacheDir>   (the cache written by analyze-age-development.ts)

const PAGE = 1000;
async function fetchAll<T>(q: (f: number, t: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

type Comp = { player_id: number; overall: number | null; potential: number | null };
const YEAR = 365.25 * 86400000;

async function main() {
  const supabase = makeSupabaseClient();
  const leagueId = await getLeagueId(supabase, leagueSlugFromArgv());
  const cacheDir = process.argv[2];
  if (!cacheDir) throw new Error("pass the cache directory written by analyze-age-development.ts");
  const loadComp = (date: string): Map<number, Comp> => {
    const f = path.join(cacheDir, `comp_${date}.json`);
    if (!fs.existsSync(f)) throw new Error(`missing cache file ${f} -- run analyze-age-development.ts first`);
    return new Map((JSON.parse(fs.readFileSync(f, "utf8")) as Comp[]).map((c) => [c.player_id, c]));
  };
  const players = await fetchAll<{ id: number; date_of_birth: string | null; pos: number | null }>((f, t) => supabase.from("players").select("id,date_of_birth,pos").eq("dsa_league_id", leagueId).order("id").range(f, t) as never);
  const dob = new Map(players.map((p) => [p.id, p.date_of_birth ? Date.parse(p.date_of_birth) : null]));
  const typeOf = new Map<number, PlayerType>(players.map((p) => [p.id, p.pos === 1 ? "P" : "H"]));

  interface Obs extends RealizationPair { pid: number; w: number; years: number }
  const build = (d0: string, d1: string, w: number): Obs[] => {
    const a = loadComp(d0), b = loadComp(d1);
    const years = (Date.parse(d1) - Date.parse(d0)) / YEAR;
    const out: Obs[] = [];
    for (const [pid, x] of a) {
      const y = b.get(pid);
      const born = dob.get(pid);
      if (!y || !born || x.overall == null || x.potential == null || y.overall == null) continue;
      out.push({ pid, w, years, age: (Date.parse(d0) - born) / YEAR, type: typeOf.get(pid) ?? "H", o0: x.overall, p0: x.potential, o1: y.overall });
    }
    return out;
  };
  const ONE_YEAR: [string, string][] = [["2031-06-23", "2032-06-21"], ["2031-11-19", "2032-11-17"], ["2031-12-31", "2032-12-31"], ["2032-01-18", "2033-01-16"]];
  const oneYear = ONE_YEAR.flatMap(([a, b], w) => build(a, b, w));
  // multi-year horizons for the ultimate-share tests
  const longObs: Obs[] = [...build("2031-06-23", "2033-02-15", 10), ...build("2031-12-31", "2033-02-15", 11)];

  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const rmse = (a: number[]) => Math.sqrt(mean(a.map((x) => x * x)));
  const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "  -");
  let allPass = true;
  const verdict = (label: string, ok: boolean) => { if (!ok) allPass = false; console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}`); };

  async function runSplit(name: string, train: Obs[], testOne: Obs[], testLong: Obs[]) {
    console.log(`\n################ ${name} ################`);
    console.log(`train ${train.length} one-year observations; test ${testOne.length} one-year + ${testLong.length} multi-year observations`);
    const { curve, closure, closureAt } = fitRealizationCurve(train);
    printCurve(curve, closure);

    // ---- T1: one-step dynamics (out of sample) ----
    console.log("\n-- T1: next-year Overall gain: predicted (fitted closure x gap) vs actual, test set --");
    console.log("group\tn\tgap\tactual\tpredicted\tbias\t| naive 'no change' bias\t| naive 'gain = full gap' bias");
    const groups: [string, PlayerType, number, number][] = [
      ["H 17-19", "H", 17, 20], ["H 20-22", "H", 20, 23], ["H 23-24", "H", 23, 25], ["H 25-26", "H", 25, 27], ["H 27+", "H", 27, 40],
      ["P 17-19", "P", 17, 20], ["P 20-22", "P", 20, 23], ["P 23-24", "P", 23, 25], ["P 25-26", "P", 25, 27], ["P 27+", "P", 27, 40],
    ];
    for (const [label, type, lo, hi] of groups) {
      const g = testOne.filter((o) => o.type === type && o.age >= lo && o.age < hi && o.p0 - o.o0 >= 3);
      if (g.length < 60) { console.log(`${label}\t${g.length}\t(too few)`); continue; }
      const gap = mean(g.map((o) => o.p0 - o.o0));
      const actual = mean(g.map((o) => o.o1 - o.o0));
      const pred = mean(g.map((o) => closureAt(type, o.age) * (o.p0 - o.o0)));
      console.log(`${label}\t${g.length}\t${f2(gap)}\t${f2(actual)}\t${f2(pred)}\t${f2(pred - actual)}\t| ${f2(0 - actual)}\t| ${f2(gap - actual)}`);
      if (g.length >= 300) verdict(`C1 ${label}: |bias| ${f2(Math.abs(pred - actual))} <= 0.35`, Math.abs(pred - actual) <= 0.35);
    }

    // ---- T2/T3: ultimate-share forecast vs reality at multi-year horizons ----
    for (const horizon of [1.65, 1.13]) {
      const rows = testLong.filter((o) => Math.abs(o.years - horizon) < 0.1);
      console.log(`\n-- T2/T3: forecast of the Overall ~${horizon} years later, players with a listed gap >= 3 (age at start; gain = Overall_end - Overall_start) --`);
      console.log("group\tn\tgap\tactual gain\tadjusted gain(R x gap)\traw gain(gap)\tbias adj\tbias raw\t| RMSE adj\tRMSE raw\tRMSE 'no potential'");
      const g2: [string, PlayerType, number, number, string][] = [
        ["H 20-21", "H", 20, 22, "C4"], ["H 22-23", "H", 22, 24, "C3"], ["H 24-25", "H", 24, 26, "C2"], ["H 26+", "H", 26, 40, "C2"],
        ["P 21-22", "P", 21, 23, "C4"], ["P 23-24", "P", 23, 25, "C3"], ["P 25", "P", 25, 26, "C3"], ["P 26+", "P", 26, 40, "C2"],
      ];
      for (const [label, type, lo, hi, crit] of g2) {
        const g = rows.filter((o) => o.type === type && o.age >= lo && o.age < hi && o.p0 - o.o0 >= 3);
        if (g.length < 60) { console.log(`${label}\t${g.length}\t(too few)`); continue; }
        const gain = g.map((o) => o.o1 - o.o0);
        const adjPot = g.map((o) => adjustPotential(o.o0, o.p0, realizationShare(curve, type, o.age)));
        const adjGain = adjPot.map((p, i) => p - g[i].o0);
        const rawGain = g.map((o) => o.p0 - o.o0);
        const biasAdj = mean(adjGain) - mean(gain), biasRaw = mean(rawGain) - mean(gain);
        const eAdj = g.map((o, i) => adjPot[i] - o.o1), eRaw = g.map((o) => o.p0 - o.o1), eNone = g.map((o) => o.o0 - o.o1);
        console.log(`${label}\t${g.length}\t${f2(mean(rawGain))}\t${f2(mean(gain))}\t${f2(mean(adjGain))}\t${f2(mean(rawGain))}\t${f2(biasAdj)}\t${f2(biasRaw)}\t| ${f2(rmse(eAdj))}\t${f2(rmse(eRaw))}\t${f2(rmse(eNone))}`);
        if (crit === "C2" && g.length >= 150) {
          verdict(`C2 ${label} h=${horizon}: |bias adj| ${f2(Math.abs(biasAdj))} <= 0.8`, Math.abs(biasAdj) <= 0.8);
          verdict(`C2 ${label} h=${horizon}: raw bias ${f2(Math.abs(biasRaw))} >= 2x adj ${f2(Math.abs(biasAdj))}`, Math.abs(biasRaw) >= 2 * Math.abs(biasAdj));
          verdict(`C2 ${label} h=${horizon}: RMSE adj ${f2(rmse(eAdj))} < raw ${f2(rmse(eRaw))}`, rmse(eAdj) < rmse(eRaw));
        } else if (crit === "C3" && g.length >= 150) {
          verdict(`C3 ${label} h=${horizon}: RMSE adj ${f2(rmse(eAdj))} <= raw ${f2(rmse(eRaw))}`, rmse(eAdj) <= rmse(eRaw));
        }
      }
    }
    for (const type of ["H", "P"] as PlayerType[]) {
      const young = [17, 18, 19].map((a) => realizationShare(curve, type, a + 0.5));
      verdict(`C4 ${type}: R at ages 17-19 = ${young.map(f2).join("/")} (>= 0.97)`, young.every((r) => r >= 0.97));
    }
  }

  function printCurve(curve: RealizationCurve, closure: ReturnType<typeof fitRealizationCurve>["closure"]) {
    console.log("fitted yearly closure (raw -> smoothed) and realization share R by age:");
    console.log("age\tH closure\tH R\t| P closure\tP R");
    for (let age = 17; age <= 29; age++) {
      const h = closure.find((r) => r.type === "H" && r.age === age), p = closure.find((r) => r.type === "P" && r.age === age);
      const R = (t: PlayerType) => curve.share[t][age - curve.minAge];
      console.log(`${age}\t${h ? `${f2(h.closure ?? 0)}->${f2(h.smoothed)}` : "-"}\t${f2(R("H"))}\t| ${p ? `${f2(p.closure ?? 0)}->${f2(p.smoothed)}` : "-"}\t${f2(R("P"))}`);
    }
  }

  // S1: hold out half the players. Train on even ids (all four 1-year windows); test on odd ids.
  await runSplit("S1: train even player ids, test odd player ids",
    oneYear.filter((o) => o.pid % 2 === 0), oneYear.filter((o) => o.pid % 2 === 1), longObs.filter((o) => o.pid % 2 === 1));
  // S2: hold out whole windows. Train on windows starting 2031-06-23 / 2031-11-19; test on windows starting 2031-12-31 / 2032-01-18
  // (the multi-year test rows start 2031-12-31, which is also test-side data).
  await runSplit("S2: train windows 1-2, test windows 3-4",
    oneYear.filter((o) => o.w <= 1), oneYear.filter((o) => o.w >= 2), longObs.filter((o) => o.w === 11));
  // ALL DATA fit, printed for reference (this is the curve proposed for the database)
  console.log("\n################ Curve fitted on ALL data (the proposed curve) ################");
  const full = fitRealizationCurve(oneYear);
  printCurve(full.curve, full.closure);
  fs.writeFileSync(path.join(cacheDir, "realization_curve_all.json"), JSON.stringify(full.curve));

  console.log(`\n================ OVERALL: ${allPass ? "ALL CRITERIA PASSED" : "SOME CRITERIA FAILED -- see FAIL lines above"} ================`);
}

main().catch((err) => {
  console.error("backtest-potential-realization failed:", err);
  process.exit(1);
});
