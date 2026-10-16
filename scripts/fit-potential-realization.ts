import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { getLeagueId, leagueSlugFromArgv } from "../lib/league.js";
import { fitRealizationCurve, type PlayerType, type RealizationPair } from "../lib/potential-realization.js";

// Fits the age-aware Potential curve (2026-10-15, Rees) and, with --activate, stores it as the league's ACTIVE set in
// potential_realization_sets / potential_realization_rows. The rating engine (scripts/compute-ratings.ts) reads the active set on every run;
// deactivating it (or the tables being absent) means no adjustment. Re-run as ratings history grows, after re-running the backtest:
//   npx tsx scripts/analyze-age-development.ts <cacheDir>        (downloads + caches the snapshots)
//   npx tsx scripts/backtest-potential-realization.ts <cacheDir> (judge the method)
//   npx tsx scripts/fit-potential-realization.ts <cacheDir> [--activate] [--label="..."]
//
// Without --activate it only prints the curve and writes <cacheDir>/realization_curve_all.json (usable with
// `compute-ratings.ts --dry-run --realization-file=...`). Writes nothing to the database.

const WINDOWS: [string, string][] = [
  ["2031-06-23", "2032-06-21"], ["2031-11-19", "2032-11-17"], ["2031-12-31", "2032-12-31"], ["2032-01-18", "2033-01-16"],
];
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

async function main() {
  const cacheDir = process.argv[2];
  if (!cacheDir || cacheDir.startsWith("--")) throw new Error("usage: fit-potential-realization.ts <cacheDir> [--activate] [--label=...]");
  const activate = process.argv.includes("--activate");
  const label = process.argv.find((a) => a.startsWith("--label="))?.slice("--label=".length) ?? `Age-aware Potential v1, fit ${new Date().toISOString().slice(0, 10)}`;
  const supabase = makeSupabaseClient();
  const leagueId = await getLeagueId(supabase, leagueSlugFromArgv());

  const players = await fetchAll<{ id: number; date_of_birth: string | null; pos: number | null }>((f, t) => supabase.from("players").select("id,date_of_birth,pos").eq("dsa_league_id", leagueId).order("id").range(f, t) as never);
  const dob = new Map(players.map((p) => [p.id, p.date_of_birth ? Date.parse(p.date_of_birth) : null]));
  const typeOf = new Map<number, PlayerType>(players.map((p) => [p.id, p.pos === 1 ? "P" : "H"]));
  const load = (date: string): Map<number, Comp> => {
    const f = path.join(cacheDir, `comp_${date}.json`);
    if (!fs.existsSync(f)) throw new Error(`missing ${f} -- run analyze-age-development.ts <cacheDir> first`);
    return new Map((JSON.parse(fs.readFileSync(f, "utf8")) as Comp[]).map((c) => [c.player_id, c]));
  };
  const pairs: RealizationPair[] = [];
  for (const [d0, d1] of WINDOWS) {
    const a = load(d0), b = load(d1);
    for (const [pid, x] of a) {
      const y = b.get(pid), born = dob.get(pid);
      if (!y || !born || x.overall == null || x.potential == null || y.overall == null) continue;
      pairs.push({ age: (Date.parse(d0) - born) / (365.25 * 86400000), type: typeOf.get(pid) ?? "H", o0: x.overall, p0: x.potential, o1: y.overall });
    }
  }
  console.log(`fitting on ${pairs.length} one-year observations from ${WINDOWS.length} windows`);
  const { curve, closure } = fitRealizationCurve(pairs);
  console.log("age\tH closure\tH R\t| P closure\tP R");
  for (let age = 17; age <= 30; age++) {
    const h = closure.find((r) => r.type === "H" && r.age === age), p = closure.find((r) => r.type === "P" && r.age === age);
    const R = (t: PlayerType) => curve.share[t][age - curve.minAge].toFixed(2);
    console.log(`${age}\t${h ? h.smoothed.toFixed(2) : "-"}\t${R("H")}\t| ${p ? p.smoothed.toFixed(2) : "-"}\t${R("P")}`);
  }
  fs.writeFileSync(path.join(cacheDir, "realization_curve_all.json"), JSON.stringify(curve));
  console.log(`wrote ${path.join(cacheDir, "realization_curve_all.json")}`);
  if (!activate) { console.log("(no --activate: nothing written to the database)"); return; }

  // --- store as the active set ---
  const notes = `Fit on ${pairs.length} one-year observations (windows ${WINDOWS.map((w) => w.join("->")).join(", ")}); chained closure, normalized at age 19, isotonic-smoothed from 22. See age-development-analysis.md.`;
  const { data: ins, error: insErr } = await supabase.from("potential_realization_sets").insert({ dsa_league_id: leagueId, label, notes, is_active: false } as never).select("id").single();
  if (insErr || !ins) throw new Error(`could not create the set (have the potential_realization_* tables been created?): ${insErr?.message}`);
  const setId = (ins as { id: number }).id;
  const rows = (["H", "P"] as PlayerType[]).flatMap((type) => curve.share[type].map((share, i) => ({ set_id: setId, player_type: type, age: curve.minAge + i, share: Math.round(share * 1e4) / 1e4 })));
  const { error: rowErr } = await supabase.from("potential_realization_rows").insert(rows as never[]);
  if (rowErr) throw new Error(`could not store the rows: ${rowErr.message} (set #${setId} left inactive)`);
  const { error: offErr } = await supabase.from("potential_realization_sets").update({ is_active: false } as never).eq("dsa_league_id", leagueId).eq("is_active", true);
  if (offErr) throw new Error(`could not deactivate the previous set: ${offErr.message} (set #${setId} left inactive)`);
  const { error: onErr } = await supabase.from("potential_realization_sets").update({ is_active: true } as never).eq("id", setId);
  if (onErr) throw new Error(`could not activate set #${setId}: ${onErr.message}`);
  console.log(`Activated set #${setId} "${label}" (${rows.length} rows). The next compute-ratings run will apply it.`);
}

main().catch((err) => {
  console.error("fit-potential-realization failed:", err);
  process.exit(1);
});
