// Verification of the proportional durability discount (option B, 2026-10-07). Usage: first a dry run of the REAL engine, then this check on what it would have written:
//   npx tsx scripts/compute-ratings.ts --run=<id> --dry-run --dry-run-out=dry.json
//   npx tsx scripts/verify-durability-discount.ts dry.json
// Checks (a) every Fragile/Wrecked row's raw prospect potential equals potential - loss*(potential - replacement) + 0.25*overall - 12.5 exactly, (b) non-fragile rows are
// untouched by this rule (any difference is input drift, e.g. self-training weights updated after that run), (c) before/after top-100/200/500 mix and Maurer's rank.
// The constants below are the ones stored in rating_weights set #84; update them if the discount is retuned. Read-only.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { makeSupabaseClient } from "../lib/supabase-client";

const supabase = makeSupabaseClient();
async function fetchAll<T>(q: (f: number, t: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []; let from = 0;
  for (;;) { const { data, error } = await q(from, from + 999); if (error) throw error; if (!data?.length) break; out.push(...data); if (data.length < 1000) break; from += 1000; }
  return out;
}
type Row = { player_id: number; ph: string; role: string; potential: number; overall: number; prospect_potential: number; prospect_rank: number | null; potential_raw?: number; overall_raw?: number; prospect_potential_raw?: number };

(async () => {
  const dry = JSON.parse(readFileSync(process.argv[2], "utf8")) as Row[];
  const stored = await fetchAll<Row & { refresh_run_id: number }>((f, t) => supabase.from("player_computed").select("player_id,ph,role,potential,overall,prospect_potential,prospect_rank,potential_raw,overall_raw,prospect_potential_raw").eq("dsa_league_id", 1).eq("refresh_run_id", 128).range(f, t) as never);
  const ratings = await fetchAll<{ player_id: number; prone: string | null }>((f, t) => supabase.from("player_ratings_snapshots").select("player_id,prone").eq("dsa_league_id", 1).eq("refresh_run_id", 128).range(f, t) as never);
  const prone = new Map(ratings.map((r) => [r.player_id, r.prone]));
  const st = new Map(stored.map((r) => [r.player_id, r]));
  const P0: Record<string, number> = { H: 47.2, SP: 43.6, RP: 43.2 };
  const F: Record<string, Record<string, number>> = { Fragile: { H: 0.19, SP: 0.31, RP: 0.18 }, Wrecked: { H: 0.82, SP: 0.77, RP: 0.54 } };

  let nFrag = 0, maxRawErr = 0, nonFragMaxRawDiff = 0, nonFragMaxCalDiff = 0, nonFrag = 0;
  const fragMoves: { name: string; id: number; oldRank: number | null; newRank: number | null }[] = [];
  for (const d of dry) {
    const s = st.get(d.player_id); if (!s) continue;
    const pr = prone.get(d.player_id);
    const grp = d.ph === "P" ? (d.role === "SP" ? "SP" : "RP") : "H";
    if (pr === "Fragile" || pr === "Wrecked") {
      nFrag++;
      const expected = Number(d.potential_raw) - F[pr][grp] * Math.max(0, Number(d.potential_raw) - P0[grp]) + 0.25 * Number(d.overall_raw) - 12.5;
      maxRawErr = Math.max(maxRawErr, Math.abs(expected - Number(d.prospect_potential_raw)));
    } else {
      nonFrag++;
      nonFragMaxRawDiff = Math.max(nonFragMaxRawDiff, Math.abs(Number(d.prospect_potential_raw) - Number(s.prospect_potential_raw)));
      nonFragMaxCalDiff = Math.max(nonFragMaxCalDiff, Math.abs(Number(d.prospect_potential) - Number(s.prospect_potential)));
    }
  }
  console.log(`rows in dry run: ${dry.length}; fragile/wrecked checked: ${nFrag}; non-fragile compared: ${nonFrag}`);
  console.log(`Fragile/Wrecked: max |engine raw prospect potential - hand formula| = ${maxRawErr.toExponential(2)}  (must be ~0)`);
  console.log(`Non-fragile: max raw change vs stored = ${nonFragMaxRawDiff.toExponential(2)}; max calibrated change vs stored = ${nonFragMaxCalDiff.toFixed(3)} (anchor drift only)`);

  const maurer = dry.find((d) => d.player_id === 39084)!;
  const sm = st.get(39084)!;
  console.log(`\nZack Maurer: stored  rank ${sm.prospect_rank}, prospect potential ${Number(sm.prospect_potential).toFixed(2)} (raw ${Number(sm.prospect_potential_raw).toFixed(2)})`);
  console.log(`             new     rank ${maurer.prospect_rank}, prospect potential ${Number(maurer.prospect_potential).toFixed(2)} (raw ${Number(maurer.prospect_potential_raw).toFixed(2)})`);

  const inTop = (rows: { player_id: number; ph: string; role: string; prospect_rank: number | null }[], n: number) => {
    const t = rows.filter((r) => r.prospect_rank !== null && r.prospect_rank <= n);
    const frag = t.filter((r) => ["Fragile", "Wrecked"].includes(prone.get(r.player_id) ?? ""));
    const g = (x: typeof t, f: (r: typeof t[0]) => boolean) => x.filter(f).length;
    return `top ${n}: ${t.length} (hitters ${g(t, (r) => r.ph !== "P")}, SP ${g(t, (r) => r.ph === "P" && r.role === "SP")}, RP ${g(t, (r) => r.ph === "P" && r.role !== "SP")}) | fragile/wrecked inside: H ${g(frag, (r) => r.ph !== "P")}, SP ${g(frag, (r) => r.ph === "P" && r.role === "SP")}, RP ${g(frag, (r) => r.ph === "P" && r.role !== "SP")}`;
  };
  console.log("\nBEFORE (stored run 128): "); for (const n of [100, 200, 500]) console.log("  " + inTop(stored, n));
  console.log("AFTER  (new engine, dry run):"); for (const n of [100, 200, 500]) console.log("  " + inTop(dry, n));

  // biggest movers among fragile
  const movers = dry.filter((d) => ["Fragile", "Wrecked"].includes(prone.get(d.player_id) ?? "") && d.prospect_rank !== null && st.get(d.player_id)?.prospect_rank != null)
    .map((d) => ({ id: d.player_id, ph: d.ph, role: d.role, prone: prone.get(d.player_id), oldRank: st.get(d.player_id)!.prospect_rank!, newRank: d.prospect_rank! }))
    .sort((a, b) => (b.oldRank - b.newRank) - (a.oldRank - a.newRank));
  console.log("\nBiggest risers among Fragile/Wrecked (old -> new rank):");
  for (const m of movers.slice(0, 6)) console.log(`   player ${m.id} ${m.ph}/${m.role} ${m.prone}: ${m.oldRank} -> ${m.newRank}`);
  const wrecked = movers.filter((m) => m.prone === "Wrecked");
  console.log(`Wrecked (n=${wrecked.length}): average rank change ${(wrecked.reduce((s, m) => s + (m.newRank - m.oldRank), 0) / Math.max(1, wrecked.length)).toFixed(0)} places (positive = fell)`);
})();
