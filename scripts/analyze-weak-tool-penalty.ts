import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { fitMultipleLinear } from "../lib/regression.js";

// One-off diagnostic (2026-09-02, Rees's question: "should we expand the
// weak-tool penalty concept to Power too?"). NOT wired into refresh.ts, NOT
// persisted anywhere -- this is purely to check, before building anything,
// whether the data shows the same kind of nonlinear cliff at low Power that
// presumably justified the existing Contact gate (lib/rating-engine.ts's
// `gate()`, added 2026-08-27 off a real case: a hitter/pitcher with elite
// secondary skills but an unplayable primary tool scored far too high under
// a plain weighted sum).
//
// Method: fit the exact same linear model compute-hitting-weights.ts fits
// (OPS+ ~ Contact+Gap+Power+Eye+AvoidKs+Speed, same population/filters), then
// look at each player's RESIDUAL (actual OPS+ minus what the linear model
// predicts) binned by their raw Power grade. A linear model already gives
// low-Power players a low predicted OPS+ via the Power coefficient -- so
// "residual" here isolates whatever ISN'T already explained linearly. If
// low-Power players are systematically WORSE than even the linear model
// expects (large negative residuals concentrated at the low end), that's
// real evidence of a cliff a linear weight can't capture -- the same
// argument that justified gating Contact. Also runs the identical check on
// Contact itself as a validation control -- if the method is sound, it
// should surface Contact's already-known, already-gated cliff too.

const PAGE_SIZE = 1000;
async function fetchAll<T>(query: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

const MIN_PA = 100;

interface HitCategories { ab: number; bb: number; hp: number; sf: number; singles: number; doubles: number; triples: number; hr: number }
function obpSlg(b: HitCategories) {
  const h = b.singles + b.doubles + b.triples + b.hr;
  const obDenom = b.ab + b.bb + b.hp + b.sf;
  const obp = obDenom > 0 ? (h + b.bb + b.hp) / obDenom : 0;
  const totalBases = b.singles + 2 * b.doubles + 3 * b.triples + 4 * b.hr;
  const slg = b.ab > 0 ? totalBases / b.ab : 0;
  return { obp, slg };
}
interface ParkFactors { average: number; doubles: number; triples: number; homeRuns: number }
function applyParkFactor(stint: { ab: number; bb: number; hp: number; sf: number; h: number; d: number; t: number; hr: number }, pf: ParkFactors | undefined): HitCategories {
  const singles = stint.h - stint.d - stint.t - stint.hr;
  if (!pf) return { ab: stint.ab, bb: stint.bb, hp: stint.hp, sf: stint.sf, singles, doubles: stint.d, triples: stint.t, hr: stint.hr };
  const half = (f: number) => 1 + (f - 1) * 0.5;
  return { ab: stint.ab, bb: stint.bb, hp: stint.hp, sf: stint.sf, singles: singles / half(pf.average), doubles: stint.d / half(pf.doubles), triples: stint.t / half(pf.triples), hr: stint.hr / half(pf.homeRuns) };
}
function addCategories(a: HitCategories, b: HitCategories): HitCategories {
  return { ab: a.ab + b.ab, bb: a.bb + b.bb, hp: a.hp + b.hp, sf: a.sf + b.sf, singles: a.singles + b.singles, doubles: a.doubles + b.doubles, triples: a.triples + b.triples, hr: a.hr + b.hr };
}
const emptyCategories = (): HitCategories => ({ ab: 0, bb: 0, hp: 0, sf: 0, singles: 0, doubles: 0, triples: 0, hr: 0 });

function bin(rows: { grade: number; residual: number }[], edges: number[]): void {
  for (let i = 0; i < edges.length; i++) {
    const lo = edges[i], hi = i + 1 < edges.length ? edges[i + 1] : Infinity;
    const inBin = rows.filter((r) => r.grade >= lo && r.grade < hi);
    if (inBin.length === 0) continue;
    const meanResidual = inBin.reduce((s, r) => s + r.residual, 0) / inBin.length;
    const label = hi === Infinity ? `${lo}+` : `${lo}-${hi - 1}`;
    console.log(`    grade ${label.padEnd(7)} n=${String(inBin.length).padEnd(4)} mean residual=${meanResidual >= 0 ? "+" : ""}${meanResidual.toFixed(2)}`);
  }
}

async function main() {
  const supabase = makeSupabaseClient();

  const { data: computedRunRow } = await supabase.from("player_computed").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  const computedRunId = (computedRunRow as { refresh_run_id: number }).refresh_run_id;
  const { data: statsRunRow } = await supabase.from("player_batting_stats_snapshots").select("refresh_run_id").eq("year", 2031).eq("level_id", 1).eq("split_id", 1).order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  const statsRunId = (statsRunRow as { refresh_run_id: number }).refresh_run_id;

  const allBatting = await fetchAll<{ player_id: number; team_id: number | null; pa: number | null; ab: number | null; h: number | null; bb: number | null; hp: number | null; sf: number | null; d: number | null; t: number | null; hr: number | null }>((from, to) =>
    supabase.from("player_batting_stats_snapshots").select("player_id, team_id, pa, ab, h, bb, hp, sf, d, t, hr").eq("year", 2031).eq("level_id", 1).eq("split_id", 1).eq("refresh_run_id", statsRunId).range(from, to) as never
  );
  const parkRows = await fetchAll<{ team_id: number; refresh_run_id: number; average: number | null; doubles: number | null; triples: number | null; home_runs: number | null }>((from, to) =>
    supabase.from("ballpark_factor_snapshots").select("team_id, refresh_run_id, average, doubles, triples, home_runs").range(from, to) as never
  );
  const parkByTeam = new Map<number, ParkFactors>();
  const parkRunIdByTeam = new Map<number, number>();
  for (const p of parkRows) {
    if (p.average == null || p.doubles == null || p.triples == null || p.home_runs == null) continue;
    if (p.refresh_run_id <= (parkRunIdByTeam.get(p.team_id) ?? -1)) continue;
    parkByTeam.set(p.team_id, { average: p.average, doubles: p.doubles, triples: p.triples, homeRuns: p.home_runs });
    parkRunIdByTeam.set(p.team_id, p.refresh_run_id);
  }

  const players = await fetchAll<{ id: number; league_id: number | null; mlb_service_days: number | null }>((from, to) => supabase.from("players").select("id, league_id, mlb_service_days").range(from, to) as never);
  const playerMeta = new Map(players.map((p) => [p.id, p]));
  const isRealMlbPlayer = (playerId: number) => { const m = playerMeta.get(playerId); return !!m && m.league_id === 200 && (m.mlb_service_days ?? 0) > 0; };

  const byPlayerAdjusted = new Map<number, HitCategories>();
  const byPlayerRaw = new Map<number, HitCategories>();
  const paByPlayer = new Map<number, number>();
  for (const b of allBatting) {
    if (!isRealMlbPlayer(b.player_id)) continue;
    const stint = { ab: b.ab ?? 0, bb: b.bb ?? 0, hp: b.hp ?? 0, sf: b.sf ?? 0, h: b.h ?? 0, d: b.d ?? 0, t: b.t ?? 0, hr: b.hr ?? 0 };
    const rawCats: HitCategories = { ab: stint.ab, bb: stint.bb, hp: stint.hp, sf: stint.sf, singles: stint.h - stint.d - stint.t - stint.hr, doubles: stint.d, triples: stint.t, hr: stint.hr };
    byPlayerRaw.set(b.player_id, addCategories(byPlayerRaw.get(b.player_id) ?? emptyCategories(), rawCats));
    byPlayerAdjusted.set(b.player_id, addCategories(byPlayerAdjusted.get(b.player_id) ?? emptyCategories(), applyParkFactor(stint, b.team_id != null ? parkByTeam.get(b.team_id) : undefined)));
    paByPlayer.set(b.player_id, (paByPlayer.get(b.player_id) ?? 0) + (b.pa ?? 0));
  }
  let leagueTotals = emptyCategories();
  for (const b of byPlayerRaw.values()) leagueTotals = addCategories(leagueTotals, b);
  const league = obpSlg(leagueTotals);

  const ratings = await fetchAll<{ player_id: number; cntct: number | null; gap: number | null; pow: number | null; eye: number | null; ks: number | null; speed: number | null }>((from, to) =>
    supabase.from("player_ratings_snapshots").select("player_id, cntct, gap, pow, eye, ks, speed").eq("refresh_run_id", computedRunId).range(from, to) as never
  );
  const ratingsByPlayer = new Map(ratings.map((r) => [r.player_id, r]));
  const computed = await fetchAll<{ player_id: number; role: string | null }>((from, to) => supabase.from("player_computed").select("player_id, role").eq("refresh_run_id", computedRunId).range(from, to) as never);
  const roleByPlayer = new Map(computed.map((c) => [c.player_id, c.role]));
  const PITCHER_ROLES = new Set(["SP", "RP", "CL"]);

  interface Row { playerId: number; opsPlus: number; cntct: number; gap: number; pow: number; eye: number; ks: number; speed: number }
  const rows: Row[] = [];
  for (const [playerId, adjusted] of byPlayerAdjusted) {
    const pa = paByPlayer.get(playerId) ?? 0;
    if (pa < MIN_PA) continue;
    const role = roleByPlayer.get(playerId);
    if (!role || PITCHER_ROLES.has(role)) continue;
    const r = ratingsByPlayer.get(playerId);
    if (!r || r.cntct == null || r.gap == null || r.pow == null || r.eye == null || r.ks == null || r.speed == null) continue;
    const { obp, slg } = obpSlg(adjusted);
    rows.push({ playerId, opsPlus: 100 * (obp / league.obp + slg / league.slg - 1), cntct: r.cntct, gap: r.gap, pow: r.pow, eye: r.eye, ks: r.ks, speed: r.speed });
  }
  console.log(`${rows.length} qualifying hitters.\n`);

  const fit = fitMultipleLinear(rows.map((r) => ({ x: [r.cntct, r.gap, r.pow, r.eye, r.ks, r.speed], y: r.opsPlus })));
  const predicted = (r: Row) => fit.intercept + fit.coefficients[0] * r.cntct + fit.coefficients[1] * r.gap + fit.coefficients[2] * r.pow + fit.coefficients[3] * r.eye + fit.coefficients[4] * r.ks + fit.coefficients[5] * r.speed;
  const withResiduals = rows.map((r) => ({ ...r, residual: r.opsPlus - predicted(r) }));

  const edges = [20, 30, 35, 40, 45, 50, 55, 60, 70];
  console.log("Mean residual (actual OPS+ minus linear-model-predicted OPS+) by POWER grade:");
  console.log("  (negative = players in this bin do WORSE than the linear model already expects -- a cliff the linear coefficient alone doesn't capture)");
  bin(withResiduals.map((r) => ({ grade: r.pow, residual: r.residual })), edges);

  console.log("\nSame check on CONTACT, as a validation control (this is the grade already gated in production):");
  bin(withResiduals.map((r) => ({ grade: r.cntct, residual: r.residual })), edges);

  console.log("\nDone -- diagnostic only, no writes.");
}

main().catch((err) => { console.error("analyze-weak-tool-penalty failed:", err); process.exit(1); });
