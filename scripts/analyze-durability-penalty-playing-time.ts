// Durability-penalty investigation (2026-10-07), part 2/3: what does Fragile / Wrecked actually cost in playing time? Cohort = players on a roster at the
// START of a season (a per-run player_snapshots run, default 49 = 2032-03-15, so the grade is not an after-the-fact label), outcome = PA / IP over that season,
// OLS controlling for Overall and level. Env: COHORT_RUN, STATS_RUN, YEAR. Read-only. (2031 cannot be replayed cleanly: snapshots start 2031-11-18.)
import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client";

const supabase = makeSupabaseClient();
async function fetchAll<T>(q: (f: number, t: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []; let from = 0;
  for (;;) { const { data, error } = await q(from, from + 999); if (error) throw error; if (!data?.length) break; out.push(...data); if (data.length < 1000) break; from += 1000; }
  return out;
}

// OLS via normal equations (Gauss-Jordan).
function ols(X: number[][], y: number[]): { beta: number[]; se: number[] } {
  const k = X[0].length, n = X.length;
  const A = Array.from({ length: k }, () => Array(k).fill(0)), b = Array(k).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { b[a] += X[i][a] * y[i]; for (let c = 0; c < k; c++) A[a][c] += X[i][a] * X[i][c]; }
  const inv = A.map((r, i) => [...r, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < k; i++) {
    let p = i; for (let r = i + 1; r < k; r++) if (Math.abs(inv[r][i]) > Math.abs(inv[p][i])) p = r;
    [inv[i], inv[p]] = [inv[p], inv[i]];
    const d = inv[i][i]; for (let c = 0; c < 2 * k; c++) inv[i][c] /= d;
    for (let r = 0; r < k; r++) if (r !== i) { const f = inv[r][i]; for (let c = 0; c < 2 * k; c++) inv[r][c] -= f * inv[i][c]; }
  }
  const covInv = inv.map((r) => r.slice(k));
  const beta = covInv.map((row) => row.reduce((s, v, j) => s + v * b[j], 0));
  let sse = 0; for (let i = 0; i < n; i++) { const pred = X[i].reduce((s, v, j) => s + v * beta[j], 0); sse += (y[i] - pred) ** 2; }
  const sigma2 = sse / (n - k);
  return { beta, se: covInv.map((r, i) => Math.sqrt(sigma2 * r[i])) };
}

(async () => {
  const RUN = 49; // 2032-03-15: start of the 2032 season
  const [snaps, ratings, comp, bat, pit] = await Promise.all([
    fetchAll<{ player_id: number; level: number; league_id: number }>((f, t) => supabase.from("player_snapshots").select("player_id,level,league_id").eq("dsa_league_id", 1).eq("refresh_run_id", RUN).gte("level", 1).lte("level", 6).gt("league_id", 0).range(f, t) as never),
    fetchAll<{ player_id: number; prone: string | null }>((f, t) => supabase.from("player_ratings_snapshots").select("player_id,prone").eq("dsa_league_id", 1).eq("refresh_run_id", RUN).range(f, t) as never),
    fetchAll<{ player_id: number; ph: string; role: string; overall_raw: number }>((f, t) => supabase.from("player_computed").select("player_id,ph,role,overall_raw").eq("dsa_league_id", 1).eq("refresh_run_id", RUN).range(f, t) as never),
    fetchAll<{ player_id: number; pa: number | null }>((f, t) => supabase.from("player_batting_stats_snapshots").select("player_id,pa").eq("dsa_league_id", 1).eq("refresh_run_id", 128).eq("year", 2032).eq("split_id", 1).range(f, t) as never),
    fetchAll<{ player_id: number; outs: number | null }>((f, t) => supabase.from("player_pitching_stats_snapshots").select("player_id,outs").eq("dsa_league_id", 1).eq("refresh_run_id", 128).eq("year", 2032).eq("split_id", 1).range(f, t) as never),
  ]);
  const prone = new Map(ratings.map((r) => [r.player_id, r.prone]));
  const cm = new Map(comp.map((c) => [c.player_id, c]));
  const pa = new Map<number, number>(); bat.forEach((b) => pa.set(b.player_id, (pa.get(b.player_id) ?? 0) + (b.pa ?? 0)));
  const ip = new Map<number, number>(); pit.forEach((p) => ip.set(p.player_id, (ip.get(p.player_id) ?? 0) + (p.outs ?? 0) / 3));

  type Row = { grp: string; time: number; overall: number; lvl: number; frag: number; wreck: number };
  const rows: Row[] = [];
  for (const s of snaps) {
    const c = cm.get(s.player_id); if (!c) continue;
    const grp = c.ph === "H" ? "Hitters" : c.role === "SP" ? "SP" : "RP";
    const time = grp === "Hitters" ? (pa.get(s.player_id) ?? 0) : (ip.get(s.player_id) ?? 0);
    const pr = prone.get(s.player_id);
    rows.push({ grp, time, overall: c.overall_raw, lvl: s.level === 1 ? 0 : s.level <= 3 ? 1 : 2, frag: pr === "Fragile" ? 1 : 0, wreck: pr === "Wrecked" ? 1 : 0 });
  }
  for (const grp of ["Hitters", "SP", "RP"]) {
    const g = rows.filter((r) => r.grp === grp);
    const X = g.map((r) => [1, r.overall, r.lvl === 1 ? 1 : 0, r.lvl === 2 ? 1 : 0, r.frag, r.wreck]);
    const { beta, se } = ols(X, g.map((r) => r.time));
    const meanTimeNormal = g.filter((r) => !r.frag && !r.wreck).reduce((s, r) => s + r.time, 0) / g.filter((r) => !r.frag && !r.wreck).length;
    const nF = g.filter((r) => r.frag).length, nW = g.filter((r) => r.wreck).length;
    console.log(`${grp.padEnd(8)} n=${g.length} (Fragile ${nF}, Wrecked ${nW}); mean ${grp === "Hitters" ? "PA" : "IP"} of Normal/Durable = ${meanTimeNormal.toFixed(1)}`);
    console.log(`   quality-adjusted effect (controls for Overall + level): Fragile ${beta[4].toFixed(1)} (se ${se[4].toFixed(1)}) = ${(100 * beta[4] / meanTimeNormal).toFixed(1)}%   |   Wrecked ${beta[5].toFixed(1)} (se ${se[5].toFixed(1)}) = ${(100 * beta[5] / meanTimeNormal).toFixed(1)}%`);
  }
  // incidence in the whole 2032-start cohort
  for (const grp of ["Hitters", "SP", "RP"]) {
    const g = rows.filter((r) => r.grp === grp);
    console.log(`${grp.padEnd(8)} Fragile+Wrecked share of cohort: ${(100 * g.filter((r) => r.frag || r.wreck).length / g.length).toFixed(1)}%`);
  }
})();
