import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { fitMultipleLinear } from "../lib/regression.js";
import { persistWeightTuningRun } from "../lib/weight-tuning-persist.js";

// Pitching weight-tuning (rebuilt 2026-09-02, Rees's corrections to the
// original version). Runs BOTH targets side by side (Rees's follow-up ask,
// same day, before deciding whether to ship) -- FIP- AND WAR/100 IP, each
// split by SP/RP, same population/predictors, only the target differs. All
// four persist to their own weight_tuning_runs stream so they're all
// visible together on /admin/weight-tuning, not just FIP-'s word for it.
//
// 1. Target is FIP- (park-adjusted), not WAR -- WAR bakes in real runs
//    allowed, which is heavily influenced by defense/luck/sequencing on
//    balls in play. FIP only counts K/BB/HBP/HR -- outcomes far more under
//    the pitcher's own control -- making it the pitching-side equivalent of
//    why OPS+ (not raw batting runs) was the right hitting target. Built
//    from scratch the same way OPS+ was (no fip column exists at the
//    player-stat level in this schema): FIP = (13*HR + 3*(BB+HBP) - 2*K)/IP
//    + a constant that anchors league-average FIP to league-average ERA,
//    then indexed against the league exactly like real ERA-/FIP- (100 =
//    league average, LOWER = better -- the opposite convention from every
//    other metric this session, which is why the fit below regresses
//    against NEGATIVE FIP-, so "higher standardized coefficient = better
//    pitching" stays consistent with every other script).
// 2. Park-adjusted the same way OPS+ was -- HR allowed is real and
//    meaningfully park-driven; BB/HBP/K are left unadjusted (not
//    meaningfully park-driven, same reasoning as leaving walks/HBP
//    unadjusted on the hitting side). Same per-stint, half-factor-deviation
//    convention as compute-hitting-weights.ts.
// 3. Split by role (SP vs RP) instead of pooled -- Rees's ask, following a
//    real baseball-logic distinction (relievers lean on pure stuff over
//    short stints; starters need to hold up and manage a lineup multiple
//    times through). Confirmed empirically safe first: Stamina's SD is
//    10.7 (SP) / 13.9 (RP) -- real, wide variance in BOTH buckets (not the
//    ifr/ofr-style near-total compression that killed the original
//    role-calibrated fielding attempt) -- because the SP/RP gate is an OR
//    of two criteria (stamina threshold OR quality-pitch-count minimum), so
//    a player can land in RP on failing just the pitch-count side while
//    still carrying a wide range of real stamina. Rees's correction to an
//    earlier assumption here -- verified directly before building on it,
//    not just taken on faith.
// 4. Stuff/Movement/Control/Stamina are the four core predictors (PBABIP
//    dropped as a separate predictor -- Movement already bakes in PBABIP+
//    HRA as a composite, confirmed with Rees earlier this session, so
//    including both would just reproduce the Contact/Avoid-Ks collinearity
//    pattern). A "quality pitches" (qp) count is tested SEPARATELY as a
//    5-variable exploratory variant, not the primary persisted fit -- Rees
//    flagged directly that qp is likely built from the same underlying
//    per-pitch-type grades that roll up into Stuff, so it risks the same
//    kind of collinearity, and we have no visibility into exactly how
//    Stuff/qp are each aggregated to know how much overlap there really is.
//    Printed for context, not persisted, until that's better understood.

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

const MIN_IP_SP = 75;
const MIN_IP_RP = 30;

interface PitchCategories { bb: number; hp: number; k: number; hr: number; ip: number; er: number }
function fip(totals: PitchCategories, constant: number): number {
  return totals.ip > 0 ? (13 * totals.hr + 3 * (totals.bb + totals.hp) - 2 * totals.k) / totals.ip + constant : constant;
}
function era(totals: PitchCategories): number {
  return totals.ip > 0 ? (totals.er * 9) / totals.ip : 0;
}
function emptyTotals(): PitchCategories { return { bb: 0, hp: 0, k: 0, hr: 0, ip: 0, er: 0 }; }
function addTotals(a: PitchCategories, b: PitchCategories): PitchCategories {
  return { bb: a.bb + b.bb, hp: a.hp + b.hp, k: a.k + b.k, hr: a.hr + b.hr, ip: a.ip + b.ip, er: a.er + b.er };
}

async function main() {
  const supabase = makeSupabaseClient();

  console.log("Finding latest refresh run with player_computed...");
  const { data: computedRunRow } = await supabase
    .from("player_computed").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  if (!computedRunRow) throw new Error("No player_computed rows found.");
  const computedRunId = (computedRunRow as { refresh_run_id: number }).refresh_run_id;

  console.log("Finding latest refresh run with 2031 MLB pitching stats...");
  const { data: statsRunRow } = await supabase
    .from("player_pitching_stats_snapshots").select("refresh_run_id").eq("year", 2031).eq("level_id", 1).eq("split_id", 1)
    .order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  if (!statsRunRow) throw new Error("No 2031 MLB pitching stats found.");
  const statsRunId = (statsRunRow as { refresh_run_id: number }).refresh_run_id;

  console.log("Loading ballpark factors (latest snapshot per team)...");
  const parkRows = await fetchAll<{ team_id: number; refresh_run_id: number; home_runs: number | null }>((from, to) =>
    supabase.from("ballpark_factor_snapshots").select("team_id, refresh_run_id, home_runs").range(from, to) as never
  );
  const hrFactorByTeam = new Map<number, number>();
  const parkRunIdByTeam = new Map<number, number>();
  for (const p of parkRows) {
    if (p.home_runs == null) continue;
    if (p.refresh_run_id <= (parkRunIdByTeam.get(p.team_id) ?? -1)) continue;
    hrFactorByTeam.set(p.team_id, p.home_runs);
    parkRunIdByTeam.set(p.team_id, p.refresh_run_id);
  }

  console.log("Loading players (for the real-MLB-roster filter: league_id=200, mlb_service_days>0)...");
  const players = await fetchAll<{ id: number; league_id: number | null; mlb_service_days: number | null }>((from, to) =>
    supabase.from("players").select("id, league_id, mlb_service_days").range(from, to) as never
  );
  const playerMeta = new Map(players.map((p) => [p.id, p]));
  const isRealMlbPlayer = (playerId: number) => {
    const meta = playerMeta.get(playerId);
    return !!meta && meta.league_id === 200 && (meta.mlb_service_days ?? 0) > 0;
  };

  console.log("Loading 2031 MLB pitching stats (bb, hp, k, hra, ip, er, war)...");
  const pitchingRows = await fetchAll<{ player_id: number; team_id: number | null; bb: number | null; hp: number | null; k: number | null; hra: number | null; ip: number | null; er: number | null; war: number | null }>((from, to) =>
    supabase.from("player_pitching_stats_snapshots").select("player_id, team_id, bb, hp, k, hra, ip, er, war")
      .eq("year", 2031).eq("level_id", 1).eq("split_id", 1).eq("refresh_run_id", statsRunId)
      .range(from, to) as never
  );

  const byPlayerRaw = new Map<number, PitchCategories>();
  const byPlayerAdjusted = new Map<number, PitchCategories>();
  const warByPlayer = new Map<number, number>(); // unadjusted -- Rees's ask is to compare against WAR/100 IP as-is, not a park-adjusted version of it
  for (const p of pitchingRows) {
    if (!isRealMlbPlayer(p.player_id)) continue;
    const stint: PitchCategories = { bb: p.bb ?? 0, hp: p.hp ?? 0, k: p.k ?? 0, hr: p.hra ?? 0, ip: p.ip ?? 0, er: p.er ?? 0 };
    byPlayerRaw.set(p.player_id, addTotals(byPlayerRaw.get(p.player_id) ?? emptyTotals(), stint));
    const hrFactor = p.team_id != null ? hrFactorByTeam.get(p.team_id) : undefined;
    const adjustedHr = hrFactor != null ? stint.hr / (1 + (hrFactor - 1) * 0.5) : stint.hr;
    byPlayerAdjusted.set(p.player_id, addTotals(byPlayerAdjusted.get(p.player_id) ?? emptyTotals(), { ...stint, hr: adjustedHr }));
    warByPlayer.set(p.player_id, (warByPlayer.get(p.player_id) ?? 0) + (p.war ?? 0));
  }
  console.log(`  ${byPlayerRaw.size} real MLB pitchers with any 2031 IP`);

  // League baseline stays RAW/unadjusted (same reasoning as the hitting
  // side) -- the real, observed run environment, not itself park-adjusted.
  let leagueTotals = emptyTotals();
  for (const t of byPlayerRaw.values()) leagueTotals = addTotals(leagueTotals, t);
  const leagueEra = era(leagueTotals);
  // FIP constant: anchors league-average FIP (using RAW, unadjusted HR --
  // consistent with the league baseline being unadjusted) to league-average
  // ERA, the standard real-sabermetric FIP construction.
  const fipConstant = leagueEra - (13 * leagueTotals.hr + 3 * (leagueTotals.bb + leagueTotals.hp) - 2 * leagueTotals.k) / leagueTotals.ip;
  const leagueFip = fip(leagueTotals, fipConstant);
  console.log(`League baseline (real 2031 MLB pitchers): ERA=${leagueEra.toFixed(2)}, FIP=${leagueFip.toFixed(2)} (constant=${fipConstant.toFixed(3)})`);

  console.log("Loading pitching grades + role...");
  const ratings = await fetchAll<{ player_id: number; stf: number | null; mov: number | null; ctrl: number | null; stm: number | null }>((from, to) =>
    supabase.from("player_ratings_snapshots").select("player_id, stf, mov, ctrl, stm").eq("refresh_run_id", computedRunId).range(from, to) as never
  );
  const ratingsByPlayer = new Map(ratings.map((r) => [r.player_id, r]));
  const computed = await fetchAll<{ player_id: number; role: string | null; qp: number | null }>((from, to) =>
    supabase.from("player_computed").select("player_id, role, qp").eq("refresh_run_id", computedRunId).range(from, to) as never
  );
  const computedByPlayer = new Map(computed.map((c) => [c.player_id, c]));

  interface Row { playerId: number; fipMinus: number; warRate: number; stf: number; mov: number; ctrl: number; stm: number; qp: number; ip: number }
  const spRows: Row[] = [];
  const rpRows: Row[] = [];
  for (const [playerId, adjusted] of byPlayerAdjusted) {
    const c = computedByPlayer.get(playerId);
    if (!c || (c.role !== "SP" && c.role !== "RP")) continue;
    const minIp = c.role === "SP" ? MIN_IP_SP : MIN_IP_RP;
    if (adjusted.ip < minIp) continue;
    const r = ratingsByPlayer.get(playerId);
    if (!r || r.stf == null || r.mov == null || r.ctrl == null || r.stm == null || c.qp == null) continue;
    const fipMinus = 100 * (fip(adjusted, fipConstant) / leagueFip);
    const warRate = ((warByPlayer.get(playerId) ?? 0) / adjusted.ip) * 100;
    const row: Row = { playerId, fipMinus, warRate, stf: r.stf, mov: r.mov, ctrl: r.ctrl, stm: r.stm, qp: c.qp, ip: adjusted.ip };
    (c.role === "SP" ? spRows : rpRows).push(row);
  }
  console.log(`  ${spRows.length} qualifying SP (>=${MIN_IP_SP} IP), ${rpRows.length} qualifying RP (>=${MIN_IP_RP} IP)`);

  const labels = ["Stuff", "Movement", "Control", "Stamina"];

  // Runs one role x one target combination. `getY` returns the value to
  // regress against, already sign-adjusted so higher is always better (FIP-
  // is inverted by the caller since it's a lower-is-better stat -- see call
  // sites below) -- keeps every persisted coefficient's sign meaning
  // identical regardless of which of the two targets produced it.
  async function runOne(
    roleLabel: "SP" | "RP", rows: Row[], stream: "pitching_sp" | "pitching_rp" | "pitching_sp_war" | "pitching_rp_war",
    targetLabel: string, getY: (r: Row) => number
  ) {
    if (rows.length < 30) {
      console.log(`\n${roleLabel} / ${targetLabel}: only ${rows.length} qualifying pitchers -- too small to trust a 4-variable regression. Skipping.`);
      return;
    }
    const fit = fitMultipleLinear(rows.map((r) => ({ x: [r.stf, r.mov, r.ctrl, r.stm], y: getY(r) })));
    console.log(`\n${roleLabel} vs. ${targetLabel}  (n=${rows.length}, R²=${fit.rSquared.toFixed(3)})`);
    for (let i = 0; i < labels.length; i++) {
      console.log(`  ${labels[i].padEnd(10)} standardized=${fit.standardizedCoefficients[i].toFixed(3)}`);
    }
    // Implied weight uses RAW coefficients, not standardized ones -- bug
    // fixed 2026-09-02 (see compute-overall-blend-weights.ts's comment for
    // the full story). Low practical impact here -- these four are all
    // individual 20-80 grades -- but fixed for consistency regardless.
    const clamped = fit.coefficients.map((c) => Math.max(0, c));
    const sum = clamped.reduce((s, c) => s + c, 0);
    const normalized = sum > 0 ? clamped.map((c) => c / sum) : clamped.map(() => 0);

    const { data: weightRow } = await supabase.from("rating_weights").select("stuff, movement, control, stamina").eq("is_active", true).maybeSingle();
    const current = weightRow as { stuff: number; movement: number; control: number; stamina: number } | null;
    const currentByLabel: Record<string, number | null> = {
      Stuff: current?.stuff ?? null, Movement: current?.movement ?? null, Control: current?.control ?? null, Stamina: current?.stamina ?? null,
    };
    console.log(`  Implied weight vector (sums to 1): ${labels.map((l, i) => `${l}=${normalized[i].toFixed(3)}`).join(", ")}`);

    // Exploratory 5-variable variant with "quality pitches" (qp) added --
    // printed for context only, NOT persisted (see the file-level comment
    // on why: likely collinear with Stuff, magnitude of overlap unknown).
    const fitWithQp = fitMultipleLinear(rows.map((r) => ({ x: [r.stf, r.mov, r.ctrl, r.stm, r.qp], y: getY(r) })));
    console.log(`  Exploratory, with QP count added (R²=${fitWithQp.rSquared.toFixed(3)}): ${[...labels, "QP count"].map((l, i) => `${l}=${fitWithQp.standardizedCoefficients[i].toFixed(3)}`).join(", ")}`);

    await persistWeightTuningRun(supabase, {
      refreshRunId: computedRunId,
      stream,
      targetMetric: `${targetLabel} (${roleLabel} only)`,
      rSquared: fit.rSquared,
      sampleSize: rows.length,
      coefficients: labels.map((label, i) => ({
        key: label.toLowerCase(),
        label,
        rawCoefficient: fit.coefficients[i],
        standardizedCoefficient: fit.standardizedCoefficients[i],
        impliedWeight: normalized[i],
        currentWeight: currentByLabel[label],
      })),
    });
  }

  // Both targets, both roles -- Rees's ask, to compare side by side on
  // /admin/weight-tuning how much the target metric itself moves the
  // implied weights, not just take FIP-'s word for it.
  await runOne("SP", spRows, "pitching_sp", "FIP- (park-adjusted)", (r) => -r.fipMinus);
  await runOne("RP", rpRows, "pitching_rp", "FIP- (park-adjusted)", (r) => -r.fipMinus);
  await runOne("SP", spRows, "pitching_sp_war", "WAR / 100 IP", (r) => r.warRate);
  await runOne("RP", rpRows, "pitching_rp_war", "WAR / 100 IP", (r) => r.warRate);

  console.log("\nDone -- rating_weights itself is untouched; this only saved the diagnostic history.");
}

main().catch((err) => {
  console.error("compute-pitching-weights failed:", err);
  process.exit(1);
});
