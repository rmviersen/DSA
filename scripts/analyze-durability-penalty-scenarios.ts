// Durability-penalty investigation (2026-10-07), part 3/3: replays the whole prospect pool (run 128) under alternative durability penalties using the exact
// calibration code in compute-ratings.ts (validated: reproduces every stored value and all 8,139 ranks) and reports where fragile hitters / starters / relievers
// land. Scenario constants (f = share of playing time lost, replacement P0) come from parts 1 and 2. Read-only; changes nothing.
import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client";

const supabase = makeSupabaseClient();
async function fetchAll<T>(q: (f: number, t: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []; let from = 0;
  for (;;) { const { data, error } = await q(from, from + 999); if (error) throw error; if (!data?.length) break; out.push(...data); if (data.length < 1000) break; from += 1000; }
  return out;
}
const RUN = 128;
const TARGET_BY_LEVEL: Record<number, number> = { 2: 45, 3: 40, 4: 35, 5: 30, 6: 25, 7: 20, 8: 15 };
const P0: Record<string, number> = { H: 47.2, SP: 43.6, RP: 43.2 }; // replacement level on the raw scale (WAR regression)

(async () => {
  const [comp, ratings, anchors, runRow] = await Promise.all([
    fetchAll<{ player_id: number; ph: string; role: string; potential_raw: number; overall_raw: number; prospect_potential_raw: number; prospect_potential: number; prospect_rank: number }>((f, t) =>
      supabase.from("player_computed").select("player_id,ph,role,potential_raw,overall_raw,prospect_potential_raw,prospect_potential,prospect_rank").eq("dsa_league_id", 1).eq("refresh_run_id", RUN).not("prospect_rank", "is", null).range(f, t) as never),
    fetchAll<{ player_id: number; prone: string | null }>((f, t) => supabase.from("player_ratings_snapshots").select("player_id,prone").eq("dsa_league_id", 1).eq("refresh_run_id", RUN).range(f, t) as never),
    supabase.from("calibration_level_anchors").select("player_type,level,avg_raw_overall").eq("refresh_run_id", RUN).eq("dsa_league_id", 1),
    supabase.from("refresh_runs").select("hitter_overall_mean,hitter_overall_sd,pitcher_overall_mean,pitcher_overall_sd").eq("id", RUN).single(),
  ]);
  const prone = new Map(ratings.map((r) => [r.player_id, r.prone]));
  const rr = runRow.data as { hitter_overall_mean: number; hitter_overall_sd: number; pitcher_overall_mean: number; pitcher_overall_sd: number };
  const stats = { H: { mean: rr.hitter_overall_mean, sd: rr.hitter_overall_sd }, P: { mean: rr.pitcher_overall_mean, sd: rr.pitcher_overall_sd } };
  const pointsFor = (t: "H" | "P") => [{ raw: stats[t].mean, target: 50 }, ...(anchors.data as { player_type: string; level: number; avg_raw_overall: number }[]).filter((a) => a.player_type === t).map((a) => ({ raw: a.avg_raw_overall, target: TARGET_BY_LEVEL[a.level] }))].sort((a, b) => b.raw - a.raw);
  const pts = { H: pointsFor("H"), P: pointsFor("P") };
  function calibrate(raw: number, t: "H" | "P"): number {
    const s = stats[t];
    if (raw >= s.mean) return 50 + (10 * (raw - s.mean)) / s.sd;
    const p = pts[t];
    for (let i = 0; i < p.length - 1; i++) { const hi = p[i], lo = p[i + 1]; if (raw <= hi.raw && raw >= lo.raw) { const fr = hi.raw === lo.raw ? 0 : (raw - lo.raw) / (hi.raw - lo.raw); return lo.target + fr * (hi.target - lo.target); } }
    const lo = p[p.length - 1], hi = p[p.length - 2];
    return lo.target + ((hi.target - lo.target) / (hi.raw - lo.raw)) * (raw - lo.raw);
  }

  type P = { id: number; t: "H" | "P"; g: "H" | "SP" | "RP"; cls: "Fragile" | "Wrecked" | "ok"; pot: number; ovr: number; ppRaw: number; ppStored: number; rankStored: number };
  const players: P[] = comp.map((c) => {
    const pr = prone.get(c.player_id);
    return { id: c.player_id, t: c.ph === "P" ? "P" : "H", g: c.ph === "P" ? (c.role === "SP" ? "SP" : "RP") : "H", cls: pr === "Wrecked" ? "Wrecked" : pr === "Fragile" ? "Fragile" : "ok", pot: Number(c.potential_raw), ovr: Number(c.overall_raw), ppRaw: Number(c.prospect_potential_raw), ppStored: Number(c.prospect_potential), rankStored: c.prospect_rank };
  });

  // scenario: penalty(player) in raw points (replaces the flat 5)
  const scenarios: Record<string, (p: P) => number> = {
    "A  current: flat -5 (Fragile and Wrecked alike)": (p) => (p.cls === "ok" ? 0 : 5),
    "B  proportional, by type and class (f x (potential - replacement))": (p) => {
      if (p.cls === "ok") return 0;
      const f = p.cls === "Fragile" ? { H: 0.19, SP: 0.31, RP: 0.18 }[p.g] : { H: 0.82, SP: 0.77, RP: 0.54 }[p.g];
      return f! * Math.max(0, p.pot - P0[p.g]);
    },
    "C  simple type-specific flats (Fragile H-2 SP-3.5 RP-1.5; Wrecked H-7 SP-7 RP-4.5)": (p) => (p.cls === "ok" ? 0 : p.cls === "Fragile" ? { H: 2, SP: 3.5, RP: 1.5 }[p.g]! : { H: 7, SP: 7, RP: 4.5 }[p.g]!),
    "D  no durability penalty at all": () => 0,
  };

  function run(name: string, pen: (p: P) => number) {
    const scored = players.map((p) => ({ p, raw: p.pot - pen(p) + 0.25 * p.ovr - 12.5 })).map((x) => ({ ...x, cal: calibrate(x.raw, x.p.t) }));
    scored.sort((a, b) => b.cal - a.cal);
    const rank = new Map(scored.map((x, i) => [x.p.id, i + 1]));
    return { name, scored, rank };
  }
  const results = Object.entries(scenarios).map(([n, f]) => run(n, f));

  // validate the replay of the current rule against the stored rank/values
  const A = results[0];
  let maxDiff = 0, rankMismatch = 0;
  for (const x of A.scored) { maxDiff = Math.max(maxDiff, Math.abs(x.cal - x.p.ppStored)); if (A.rank.get(x.p.id) !== x.p.rankStored) rankMismatch++; }
  console.log(`Replay check of the current rule: max |calibrated diff| = ${maxDiff.toFixed(3)}; rank mismatches = ${rankMismatch} of ${players.length}\n`);

  const maurer = 39084;
  const counts = (r: typeof results[0], top: number) => {
    const inTop = r.scored.slice(0, top).map((x) => x.p);
    const c = (f: (p: P) => boolean) => inTop.filter(f).length;
    return { H: c((p) => p.g === "H"), SP: c((p) => p.g === "SP"), RP: c((p) => p.g === "RP"), fragH: c((p) => p.cls !== "ok" && p.g === "H"), fragSP: c((p) => p.cls !== "ok" && p.g === "SP"), fragRP: c((p) => p.cls !== "ok" && p.g === "RP") };
  };
  const poolShare = (g: string) => players.filter((p) => p.g === g && p.cls !== "ok").length;
  console.log(`Pool: ${players.length} prospects. Fragile/Wrecked in pool -> hitters ${poolShare("H")} of ${players.filter((p) => p.g === "H").length}, SP ${poolShare("SP")} of ${players.filter((p) => p.g === "SP").length}, RP ${poolShare("RP")} of ${players.filter((p) => p.g === "RP").length}\n`);
  for (const r of results) {
    console.log(r.name);
    console.log(`   Zack Maurer -> #${r.rank.get(maurer)}`);
    for (const top of [100, 200, 500]) {
      const c = counts(r, top);
      console.log(`   top ${String(top).padEnd(3)}: hitters ${c.H}, SP ${c.SP}, RP ${c.RP}  | fragile/wrecked inside: hitters ${c.fragH}, SP ${c.fragSP}, RP ${c.fragRP}`);
    }
  }

  // average places lost by a Fragile player under the CURRENT rule (rank now vs rank with no penalty)
  const D = results[3];
  console.log("\nAverage places lost to the current -5, among players it affects AND who would be inside the top 1000 without it:");
  for (const cls of ["Fragile", "Wrecked"] as const) for (const g of ["H", "SP", "RP"] as const) {
    const xs = players.filter((p) => p.cls === cls && p.g === g && (D.rank.get(p.id) ?? 9999) <= 1000);
    if (!xs.length) continue;
    const lost = xs.map((p) => (A.rank.get(p.id) ?? 0) - (D.rank.get(p.id) ?? 0));
    const calLost = xs.map((p) => D.scored.find((s) => s.p.id === p.id)!.cal - A.scored.find((s) => s.p.id === p.id)!.cal);
    console.log(`   ${cls.padEnd(8)} ${g.padEnd(3)} n=${String(xs.length).padStart(3)}  avg places lost ${(lost.reduce((a, b) => a + b, 0) / xs.length).toFixed(0).padStart(4)}   avg calibrated points lost ${(calLost.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)}`);
  }
  const hPotAvg = (g: string) => { const xs = players.filter((p) => p.g === g && p.rankStored <= 500); return (xs.reduce((s, p) => s + p.pot, 0) / xs.length).toFixed(1); };
  console.log(`\nAverage potential_raw of the top-500 prospects: hitters ${hPotAvg("H")}, SP ${hPotAvg("SP")}, RP ${hPotAvg("RP")}  (replacement: ${P0.H}, ${P0.SP}, ${P0.RP})`);
})();
