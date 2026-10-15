import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { getLeagueId, leagueSlugFromArgv } from "../lib/league.js";

// Age & development analysis (2026-10-15, Rees's ask): "players stop progressing at certain ages and the Potential ratings don't
// always reflect the time left to develop ... overrating older players (24+) who don't have enough time to fulfil their scouted
// potential." This is an EXPLORATORY DIAGNOSTIC, run by hand -- it reads snapshots and prints tables; it writes nothing to the
// database and changes no rating. (Same family as analyze-makeup-development-impact.ts.)
//
// Method: the game's own per-player grades in player_ratings_snapshots (`ovr`, `pot`, and per-tool current / pot_* grades) are fixed
// by OOTP, unlike our calibrated Overall, whose weights have changed over time -- so a change in them is a change in the player.
// Ratings move in installments through the year (late Jan-Feb, early April, mid June, autumn), so development is measured over
// EXACT ONE-YEAR WINDOWS (start and end ~364-368 days apart) that each hold one full cycle: several windows are used and compared
// as a robustness check. Age = age at the START of the window, from date_of_birth.
//
// Known bias, stated up front: only players present in BOTH snapshots can be compared, so players who retired during the window
// drop out (mostly old). That makes the oldest age groups look slightly better than reality.
//
// Usage: npx tsx scripts/analyze-age-development.ts [cacheDir]   (cacheDir keeps downloaded snapshots so reruns are instant)

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

const HITTER_TOOLS = ["cntct", "gap", "pow", "eye", "ks", "babip", "speed"] as const;
const PITCHER_TOOLS = ["stf", "mov", "ctrl", "hra", "pbabip", "stm"] as const;
const COLS = ["ovr", "pot", ...HITTER_TOOLS, ...PITCHER_TOOLS, "pot_cntct", "pot_gap", "pot_pow", "pot_eye", "pot_ks", "pot_babip", "pot_stf", "pot_mov", "pot_ctrl", "pot_hra", "pot_pbabip"] as const;
type Snap = { player_id: number } & Record<(typeof COLS)[number], number | null>;

// One-year windows (start date -> end date), each ~1 year apart and each containing one full development cycle.
const WINDOWS: [string, string][] = [
  ["2031-06-23", "2032-06-21"],
  ["2031-11-19", "2032-11-17"],
  ["2031-12-31", "2032-12-31"],
  ["2032-01-18", "2033-01-16"],
];

async function main() {
  const supabase = makeSupabaseClient();
  const leagueId = await getLeagueId(supabase, leagueSlugFromArgv());
  const cacheDir = process.argv[2];
  if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });

  const { data: runs } = await supabase.from("refresh_runs").select("id,game_date").eq("dsa_league_id", leagueId).eq("status", "succeeded").not("game_date", "is", null).order("id");
  const runByDate = new Map<string, number>();
  for (const r of runs as { id: number; game_date: string }[]) runByDate.set(r.game_date, r.id); // latest run per date

  async function loadSnap(date: string): Promise<Map<number, Snap>> {
    const run = runByDate.get(date);
    if (!run) throw new Error(`no run for ${date}`);
    const file = cacheDir ? path.join(cacheDir, `snap_${date}.json`) : null;
    if (file && fs.existsSync(file)) return new Map((JSON.parse(fs.readFileSync(file, "utf8")) as Snap[]).map((s) => [s.player_id, s]));
    console.log(`  downloading ratings for ${date} (run ${run})...`);
    const rows = await fetchAll<Snap>((f, t) => supabase.from("player_ratings_snapshots").select(["id", "player_id", ...COLS].join(",")).eq("refresh_run_id", run).order("id").range(f, t) as never);
    if (file) fs.writeFileSync(file, JSON.stringify(rows));
    return new Map(rows.map((s) => [s.player_id, s]));
  }

  // Our calibrated Overall / Potential for the same runs (continuous, unlike the game's 5-point steps).
  type Comp = { player_id: number; overall: number | null; potential: number | null; prospect_potential: number | null };
  async function loadComputed(date: string): Promise<Map<number, Comp>> {
    const run = runByDate.get(date);
    if (!run) throw new Error(`no run for ${date}`);
    const file = cacheDir ? path.join(cacheDir, `comp_${date}.json`) : null;
    if (file && fs.existsSync(file)) return new Map((JSON.parse(fs.readFileSync(file, "utf8")) as Comp[]).map((s) => [s.player_id, s]));
    console.log(`  downloading calibrated ratings for ${date} (run ${run})...`);
    const rows = await fetchAll<Comp>((f, t) => supabase.from("player_computed").select("id,player_id,overall,potential,prospect_potential").eq("refresh_run_id", run).order("id").range(f, t) as never);
    if (file) fs.writeFileSync(file, JSON.stringify(rows));
    return new Map(rows.map((s) => [s.player_id, s]));
  }

  const players = await fetchAll<{ id: number; date_of_birth: string | null; pos: number | null }>((f, t) => supabase.from("players").select("id,date_of_birth,pos").eq("dsa_league_id", leagueId).order("id").range(f, t) as never);
  const dob = new Map(players.map((p) => [p.id, p.date_of_birth ? Date.parse(p.date_of_birth) : null]));
  const isPitcher = new Map(players.map((p) => [p.id, p.pos === 1]));

  interface Pair { pid: number; age: number; pitcher: boolean; w: number; a: Snap; b: Snap }
  const pairs: Pair[] = [];
  for (let w = 0; w < WINDOWS.length; w++) {
    const [d0, d1] = WINDOWS[w];
    const s0 = await loadSnap(d0), s1 = await loadSnap(d1);
    let n = 0;
    for (const [pid, a] of s0) {
      const b = s1.get(pid);
      const born = dob.get(pid);
      if (!b || !born || a.ovr == null || b.ovr == null) continue;
      pairs.push({ pid, age: (Date.parse(d0) - born) / (365.25 * 86400000), pitcher: !!isPitcher.get(pid), w, a, b });
      n++;
    }
    console.log(`window ${w + 1}: ${d0} -> ${d1}: ${n} players in both (${s0.size} at start, ${s1.size} at end)`);
  }

  // ---- ovr scale sanity ----
  const ovrs = pairs.map((p) => p.a.ovr as number);
  console.log(`\nGame 'ovr' scale: min ${Math.min(...ovrs)}, max ${Math.max(...ovrs)}, mean ${(ovrs.reduce((x, y) => x + y, 0) / ovrs.length).toFixed(1)}, distinct values ${new Set(ovrs).size}`);

  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "  -");
  const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : "-");

  function table(label: string, rows: Pair[]) {
    console.log(`\n=== ${label} (one-year change in the game's own ovr / pot, by AGE AT START; all windows pooled) ===`);
    console.log("age\tn\tovr0\tgap0\td_ovr\td_pot\t%up>=2\t%down<=-2\tgap0>=4: n\td_ovr\t%gap closed");
    for (let age = 17; age <= 38; age++) {
      const g = rows.filter((r) => Math.floor(r.age) === age);
      if (g.length < 30) continue;
      const d = g.map((r) => (r.b.ovr as number) - (r.a.ovr as number));
      const gap0 = g.map((r) => Math.max(0, ((r.a.pot ?? r.a.ovr) as number) - (r.a.ovr as number)));
      const dp = g.filter((r) => r.a.pot != null && r.b.pot != null).map((r) => (r.b.pot as number) - (r.a.pot as number));
      const wide = g.filter((r) => ((r.a.pot ?? 0) as number) - (r.a.ovr as number) >= 4);
      const wd = wide.map((r) => (r.b.ovr as number) - (r.a.ovr as number));
      const wg = wide.map((r) => (r.a.pot as number) - (r.a.ovr as number));
      const closed = wide.length ? wd.reduce((x, y) => x + y, 0) / wg.reduce((x, y) => x + y, 0) : NaN;
      console.log(`${age}\t${g.length}\t${fmt(mean(g.map((r) => r.a.ovr as number)), 1)}\t${fmt(mean(gap0), 1)}\t${fmt(mean(d))}\t${fmt(mean(dp))}\t${pct(d.filter((x) => x >= 2).length / d.length)}\t${pct(d.filter((x) => x <= -2).length / d.length)}\t${wide.length}\t${fmt(mean(wd))}\t${pct(closed)}`);
    }
  }
  table("HITTERS", pairs.filter((p) => !p.pitcher));
  table("PITCHERS", pairs.filter((p) => p.pitcher));

  // ---- robustness: the same age curve in each window ----
  console.log("\n=== Robustness: mean one-year d_ovr by age group, per window (hitters+pitchers) ===");
  const groups: [string, number, number][] = [["<=20", 0, 21], ["21-22", 21, 23], ["23-24", 23, 25], ["25-26", 25, 27], ["27-28", 27, 29], ["29-30", 29, 31], ["31-33", 31, 34], ["34+", 34, 99]];
  console.log("window\t" + groups.map((g) => g[0]).join("\t"));
  for (let w = 0; w < WINDOWS.length; w++) {
    console.log(`${WINDOWS[w][0]}\t` + groups.map(([, lo, hi]) => fmt(mean(pairs.filter((p) => p.w === w && p.age >= lo && p.age < hi).map((p) => (p.b.ovr as number) - (p.a.ovr as number))))).join("\t"));
  }
  console.log(`ALL\t` + groups.map(([, lo, hi]) => fmt(mean(pairs.filter((p) => p.age >= lo && p.age < hi).map((p) => (p.b.ovr as number) - (p.a.ovr as number))))).join("\t"));

  // ---- per-tool timeline: mean one-year change in each tool by age group ----
  const tbuckets: [string, number, number][] = [["17-18", 17, 19], ["19-20", 19, 21], ["21-22", 21, 23], ["23-24", 23, 25], ["25-26", 25, 27], ["27-28", 27, 29], ["29-30", 29, 31], ["31-32", 31, 33], ["33+", 33, 99]];
  const toolTable = (label: string, rows: Pair[], tools: readonly string[]) => {
    console.log(`\n=== ${label}: mean one-year change per TOOL by age at start (20-80 scale, steps of 5) ===`);
    console.log("tool\t" + tbuckets.map((b) => b[0]).join("\t"));
    for (const tool of tools) {
      const cells = tbuckets.map(([, lo, hi]) => {
        const d = rows.filter((r) => r.age >= lo && r.age < hi && (r.a as never)[tool] != null && (r.b as never)[tool] != null).map((r) => ((r.b as never)[tool] as number) - ((r.a as never)[tool] as number));
        return d.length >= 40 ? fmt(mean(d)) : "  -";
      });
      console.log(`${tool}\t` + cells.join("\t"));
    }
  };
  toolTable("HITTERS", pairs.filter((p) => !p.pitcher), HITTER_TOOLS);
  toolTable("PITCHERS", pairs.filter((p) => p.pitcher), PITCHER_TOOLS);

  // ---- share of each tool's scouted gap (pot_tool - tool) that closes in one year, players with >= 10 points of room ----
  const potOf: Record<string, string> = { cntct: "pot_cntct", gap: "pot_gap", pow: "pot_pow", eye: "pot_eye", ks: "pot_ks", babip: "pot_babip", stf: "pot_stf", mov: "pot_mov", ctrl: "pot_ctrl", hra: "pot_hra", pbabip: "pot_pbabip" };
  console.log("\n=== Share of a tool's scouted gap closed within one year (players with >= 10 points of room), by age at start ===");
  console.log("tool\t" + tbuckets.map((b) => b[0]).join("\t"));
  for (const tool of [...HITTER_TOOLS, ...PITCHER_TOOLS]) {
    const potKey = potOf[tool];
    if (!potKey) continue;
    const pit = (PITCHER_TOOLS as readonly string[]).includes(tool);
    const cells = tbuckets.map(([, lo, hi]) => {
      const g = pairs.filter((r) => r.pitcher === pit && r.age >= lo && r.age < hi && (r.a as never)[tool] != null && (r.b as never)[tool] != null && (r.a as never)[potKey] != null && ((r.a as never)[potKey] as number) - ((r.a as never)[tool] as number) >= 10);
      if (g.length < 40) return "  -";
      const closed = g.reduce((x, r) => x + (((r.b as never)[tool] as number) - ((r.a as never)[tool] as number)), 0);
      const room = g.reduce((x, r) => x + (((r.a as never)[potKey] as number) - ((r.a as never)[tool] as number)), 0);
      return pct(closed / room);
    });
    console.log(`${tool}\t` + cells.join("\t"));
  }

  // ---- OUR calibrated Overall / Potential: how much of the listed gap really closes, by age ----
  console.log("\n=== OUR calibrated Overall / Potential (continuous): listed gap vs one-year reality, by age at start ===");
  console.log("age\tn\tmean gap\td_overall\td_potential\t%gap closed(gap>=3)\tn(gap>=3)");
  const cpairs: { age: number; pitcher: boolean; o0: number; p0: number; o1: number; p1: number }[] = [];
  for (let w = 0; w < WINDOWS.length; w++) {
    const [d0, d1] = WINDOWS[w];
    const c0 = await loadComputed(d0), c1 = await loadComputed(d1);
    for (const [pid, a] of c0) {
      const b = c1.get(pid);
      const born = dob.get(pid);
      if (!b || !born || a.overall == null || a.potential == null || b.overall == null || b.potential == null) continue;
      cpairs.push({ age: (Date.parse(d0) - born) / (365.25 * 86400000), pitcher: !!isPitcher.get(pid), o0: a.overall, p0: a.potential, o1: b.overall, p1: b.potential });
    }
  }
  for (let age = 17; age <= 35; age++) {
    const g = cpairs.filter((r) => Math.floor(r.age) === age);
    if (g.length < 60) continue;
    const gap = g.map((r) => r.p0 - r.o0);
    const wide = g.filter((r) => r.p0 - r.o0 >= 3);
    const closed = wide.length ? wide.reduce((x, r) => x + (r.o1 - r.o0), 0) / wide.reduce((x, r) => x + (r.p0 - r.o0), 0) : NaN;
    console.log(`${age}\t${g.length}\t${fmt(mean(gap), 1)}\t${fmt(mean(g.map((r) => r.o1 - r.o0)))}\t${fmt(mean(g.map((r) => r.p1 - r.p0)))}\t${pct(closed)}\t${wide.length}`);
  }

  // ---- by type + the chained "how much of the listed gap really gets realized" factor ----
  // c[age] = share of the then-current gap (players with gap >= 3) that closed during the next year. Chaining those yearly shares from
  // age a up to the last age with enough data answers: of the gap on the card today, how much will actually be realized? (Upper bound:
  // it ignores the extra downward REVISIONS of potential the game makes for stalled players, which only make the true number lower.)
  const closureByAge = (rows: typeof cpairs): Map<number, { c: number; n: number; mean: number }> => {
    const out = new Map<number, { c: number; n: number; mean: number }>();
    for (let age = 17; age <= 28; age++) { // beyond 28 the listed gap is ~0 and tiny samples make the ratio meaningless
      const g = rows.filter((r) => Math.floor(r.age) === age && r.p0 - r.o0 >= 3);
      if (g.length < 60) continue;
      const closed = g.reduce((x, r) => x + (r.o1 - r.o0), 0) / g.reduce((x, r) => x + (r.p0 - r.o0), 0);
      out.set(age, { c: Math.max(0, closed), n: g.length, mean: g.reduce((x, r) => x + (r.p0 - r.o0), 0) / g.length });
    }
    return out;
  };
  const cAll = closureByAge(cpairs), cH = closureByAge(cpairs.filter((r) => !r.pitcher)), cP = closureByAge(cpairs.filter((r) => r.pitcher));
  console.log("\n=== Yearly share of the listed gap that closes (calibrated, gap >= 3), by type ===");
  console.log("age\tall\tn\t| hitters\tn\t| pitchers\tn");
  for (let age = 17; age <= 30; age++) {
    const a = cAll.get(age), h = cH.get(age), p = cP.get(age);
    if (!a && !h && !p) continue;
    console.log(`${age}\t${a ? pct(a.c) : "-"}\t${a?.n ?? "-"}\t| ${h ? pct(h.c) : "-"}\t${h?.n ?? "-"}\t| ${p ? pct(p.c) : "-"}\t${p?.n ?? "-"}`);
  }
  const chain = (m: Map<number, { c: number }>, from: number): number => {
    let keep = 1;
    for (let a = from; a <= 28; a++) keep *= 1 - (m.get(a)?.c ?? 0);
    return 1 - keep;
  };
  console.log("\n=== Expected share of today's listed gap that is EVER realized, by current age (chained yearly closure, upper bound) ===");
  console.log("age now\tall\thitters\tpitchers");
  for (let a = 18; a <= 28; a++) console.log(`${a}\t${pct(chain(cAll, a))}\t${pct(chain(cH, a))}\t${pct(chain(cP, a))}`);

  // ---- LONGER window (~1.65 years) to see multi-year closure directly ----
  const [l0, l1] = ["2031-06-23", "2033-02-15"];
  const lc0 = await loadComputed(l0), lc1 = await loadComputed(l1);
  const years = (Date.parse(l1) - Date.parse(l0)) / (365.25 * 86400000);
  console.log(`\n=== LONG window ${l0} -> ${l1} (${years.toFixed(2)} years): calibrated gap closed, by age at start ===`);
  console.log("age\tn(gap>=3)\tmean gap\td_overall\t%gap closed\t%gap closed per year");
  for (let age = 17; age <= 32; age++) {
    const rows: { o0: number; p0: number; o1: number }[] = [];
    for (const [pid, a] of lc0) {
      const b = lc1.get(pid);
      const born = dob.get(pid);
      if (!b || !born || a.overall == null || a.potential == null || b.overall == null) continue;
      if (Math.floor((Date.parse(l0) - born) / (365.25 * 86400000)) !== age) continue;
      if (a.potential - a.overall >= 3) rows.push({ o0: a.overall, p0: a.potential, o1: b.overall });
    }
    if (rows.length < 60) continue;
    const gap = rows.reduce((x, r) => x + (r.p0 - r.o0), 0);
    const closed = rows.reduce((x, r) => x + (r.o1 - r.o0), 0) / gap;
    console.log(`${age}\t${rows.length}\t${fmt(gap / rows.length, 1)}\t${fmt(mean(rows.map((r) => r.o1 - r.o0)))}\t${pct(closed)}\t${pct(closed / years)}`);
  }
}

main().catch((err) => {
  console.error("analyze-age-development failed:", err);
  process.exit(1);
});
