import "dotenv/config";
import { appendFileSync } from "node:fs";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { getLeagueId, leagueSlugFromArgv } from "../lib/league.js";
import { fitRealizationCurve, type PlayerType, type RealizationCurve } from "../lib/potential-realization.js";
import {
  selectRunPairs, buildObservations, backtestGate, clampCurve, maxCurveDiff, shareAtAge,
  REFIT_MIN_OBSERVATIONS, REFIT_MIN_NEW_DAYS, REFIT_MAX_STEP, REFIT_MATERIAL_CHANGE,
  type RefitObservation, type SnapshotRow,
} from "../lib/potential-realization-refit.js";

// AUTOMATIC re-fit of the age-aware Potential curve (2026-10-16, Rees: "I want these factors to continue to update as we continue to collect more
// data"). Runs inside the refresh, BEFORE compute-ratings, so a new curve is applied to the current run straight away. Read lib/potential-realization-refit.ts
// for the three safeguards (backtest gate, per-refit movement limit, version history). Never fails the refresh: any problem => the active curve stays.
//
//   npx tsx scripts/auto-refit-potential-realization.ts [--dry-run] [--force] [--league=TBL]
//   --dry-run  fit + gate + print, write nothing.   --force  ignore the "at least 30 game days of new evidence" rate limit.
//
// WHAT IT FITS ON (Rees, 2026-10-16: "use the raw-score scale for the refit"): every ~45 days of game time, a pair of ratings snapshots about one year
// apart (player_computed, per refresh run), in the RAW scoring scale -- overall_raw and potential_unadjusted_raw. Raw scores involve no calibration
// anchors (rebuilt from players' CURRENT levels on a historical re-score, which collided and distorted history) and no cross-run weight drift, and
// they are the units the engine applies R in anyway. Fitting on the adjusted Potential would feed the curve its own output, so the audit column
// potential_unadjusted_raw is required: a run without it is skipped. The gate's thresholds are written in calibrated points, so they are converted:
// one calibrated point = (league raw SD / 10) raw points, per hitters/pitchers, from the newest run's stored hitter/pitcher_overall_sd.
// Activation: on by default; POTENTIAL_REFIT_ACTIVATE=0 is the kill switch (candidates are then stored inactive as PROPOSED).

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

type SetRow = { id: number; label: string; source: string; is_active: boolean; fit_through_game_date: string | null };

async function loadCurve(supabase: ReturnType<typeof makeSupabaseClient>, setId: number): Promise<RealizationCurve> {
  const rows = await fetchAll<{ player_type: string; age: number; share: number }>((f, t) =>
    supabase.from("potential_realization_rows").select("player_type,age,share").eq("set_id", setId).order("age").range(f, t) as never);
  if (rows.length === 0) throw new Error(`set #${setId} has no rows`);
  const minAge = Math.min(...rows.map((r) => r.age)), maxAge = Math.max(...rows.map((r) => r.age));
  const build = (type: PlayerType): number[] => {
    const byAge = new Map(rows.filter((r) => r.player_type === type).map((r) => [r.age, Number(r.share)]));
    const out: number[] = [];
    for (let a = minAge; a <= maxAge; a++) out.push(byAge.get(a) ?? out[out.length - 1] ?? 1);
    return out;
  };
  return { minAge, share: { H: build("H"), P: build("P") } };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run"), force = process.argv.includes("--force");
  const supabase = makeSupabaseClient();
  const leagueId = await getLeagueId(supabase, leagueSlugFromArgv());
  console.log(`Auto-refit of the age-aware Potential curve${dryRun ? " (DRY RUN -- nothing will be written)" : ""}...`);

  // --- the active curve and when the evidence behind the last fit ended ---
  const sets = await fetchAll<SetRow>((f, t) => supabase.from("potential_realization_sets").select("id,label,source,is_active,fit_through_game_date").eq("dsa_league_id", leagueId).range(f, t) as never);
  const active = sets.find((s) => s.is_active);
  if (!active) { console.log("No active curve set -- nothing to refit (activate or seed one first)."); return; }
  const lastFitMs = Math.max(0, ...sets.map((s) => (s.fit_through_game_date ? Date.parse(s.fit_through_game_date) : 0)));
  const prev = await loadCurve(supabase, active.id);

  // --- the snapshot pairs ---
  const runs = await fetchAll<{ id: number; game_date: string | null }>((f, t) =>
    supabase.from("refresh_runs").select("id,game_date").eq("dsa_league_id", leagueId).eq("status", "succeeded").eq("ratings_included", true).order("id").range(f, t) as never);
  // Only runs that actually have computed ratings can anchor a pair (a run can be "succeeded" yet have none -- e.g. the 2032 token outage).
  const usable: typeof runs = [];
  for (const r of runs) {
    const { count } = await supabase.from("player_computed").select("player_id", { count: "exact", head: true }).eq("refresh_run_id", r.id);
    if ((count ?? 0) > 5000) usable.push(r);
  }
  const pairs = selectRunPairs(usable);
  if (pairs.length === 0) { console.log("No pair of ratings snapshots about a year apart yet -- nothing to fit."); return; }
  const newestEvidence = pairs.map((p) => p.r1.game_date).sort().slice(-1)[0];
  const daysNew = (Date.parse(newestEvidence) - lastFitMs) / 86400000;
  console.log(`${pairs.length} snapshot pairs (about a year apart); newest evidence ends ${newestEvidence}; last fit used evidence through ${lastFitMs ? new Date(lastFitMs).toISOString().slice(0, 10) : "(none)"}.`);
  if (!force && daysNew < REFIT_MIN_NEW_DAYS) {
    console.log(`Only ${Math.max(0, Math.round(daysNew))} game days of new evidence (< ${REFIT_MIN_NEW_DAYS}) -- keeping set #${active.id}. (--force overrides.)`);
    return;
  }

  const players = await fetchAll<{ id: number; date_of_birth: string | null; pos: number | null }>((f, t) =>
    supabase.from("players").select("id,date_of_birth,pos").eq("dsa_league_id", leagueId).order("id").range(f, t) as never);
  const dob = new Map(players.map((p) => [p.id, p.date_of_birth ? Date.parse(p.date_of_birth) : null]));
  const typeOf = new Map<number, PlayerType>(players.map((p) => [p.id, p.pos === 1 ? "P" : "H"]));

  // Raw-scale units: one calibrated point = (raw SD / 10) raw points (calibrate() is 10 * (raw - mean) / sd above the mean).
  const { data: sdRow, error: sdErr } = await supabase.from("refresh_runs").select("id,hitter_overall_sd,pitcher_overall_sd").eq("dsa_league_id", leagueId)
    .not("hitter_overall_sd", "is", null).not("pitcher_overall_sd", "is", null).order("id", { ascending: false }).limit(1).maybeSingle();
  if (sdErr || !sdRow) throw new Error(`no run with a stored raw Overall SD to convert the gate thresholds (${sdErr?.message ?? "none found"})`);
  const sd = sdRow as { id: number; hitter_overall_sd: number; pitcher_overall_sd: number };
  const unit = { H: Number(sd.hitter_overall_sd) / 10, P: Number(sd.pitcher_overall_sd) / 10 };
  console.log(`Raw scale: 1 calibrated point = ${unit.H.toFixed(3)} raw (hitters) / ${unit.P.toFixed(3)} raw (pitchers), from run ${sd.id}.`);

  const cache = new Map<number, Map<number, SnapshotRow>>();
  const snapshot = async (runId: number): Promise<Map<number, SnapshotRow>> => {
    const hit = cache.get(runId);
    if (hit) return hit;
    type Row = { player_id: number; overall_raw: number | null; potential_unadjusted_raw: number | null };
    const rows = await fetchAll<Row>((f, t) =>
      supabase.from("player_computed").select("player_id,overall_raw,potential_unadjusted_raw").eq("refresh_run_id", runId).order("player_id").range(f, t) as never);
    // potential_unadjusted_raw null (a run scored before any curve existed) => no raw Potential on record => that player-run is skipped.
    const m = new Map<number, SnapshotRow>(rows.map((r) => [r.player_id, {
      overall: r.overall_raw == null ? null : Number(r.overall_raw),
      potential: r.potential_unadjusted_raw == null ? null : Number(r.potential_unadjusted_raw),
    }]));
    cache.set(runId, m);
    return m;
  };
  const obs: RefitObservation[] = [];
  for (const { r0, r1 } of pairs) {
    const [a, b] = [await snapshot(r0.id), await snapshot(r1.id)];
    const o = buildObservations(Date.parse(r0.game_date), a, b, dob, typeOf);
    console.log(`  pair run ${r0.id} (${r0.game_date}) -> run ${r1.id} (${r1.game_date}): ${o.length} players`);
    obs.push(...o);
  }
  console.log(`${obs.length} observations in total.`);

  const nPairs = pairs.length;
  const base = { dsa_league_id: leagueId, source: "auto", fit_through_game_date: newestEvidence, n_pairs: nPairs };
  const record = async (label: string, notes: string, gateReport: unknown, rows?: RealizationCurve, activateIt?: boolean): Promise<number | null> => {
    if (dryRun) return null;
    const { data: ins, error } = await supabase.from("potential_realization_sets").insert({ ...base, label, notes, is_active: false, gate_report: gateReport } as never).select("id").single();
    if (error || !ins) throw new Error(`could not record the attempt: ${error?.message}`);
    const setId = (ins as { id: number }).id;
    if (rows) {
      const out = (["H", "P"] as PlayerType[]).flatMap((type) => rows.share[type].map((share, i) => ({ set_id: setId, player_type: type, age: rows.minAge + i, share })));
      const { error: rowErr } = await supabase.from("potential_realization_rows").insert(out as never[]);
      if (rowErr) throw new Error(`could not store set #${setId}'s rows: ${rowErr.message} (left inactive; the previous curve stays)`);
    }
    if (activateIt) {
      const { error: actErr } = await supabase.rpc("activate_potential_realization_set" as never, { p_set_id: setId } as never);
      if (actErr) throw new Error(`could not activate set #${setId}: ${(actErr as { message: string }).message} (the previous curve stays)`);
    }
    return setId;
  };
  const today = new Date().toISOString().slice(0, 10);

  if (obs.length < REFIT_MIN_OBSERVATIONS) {
    console.log(`Only ${obs.length} observations (< ${REFIT_MIN_OBSERVATIONS}) -- not enough to refit; keeping set #${active.id}.`);
    return;
  }

  // --- fit, limit the move, judge ---
  const fit = fitRealizationCurve(obs, { gapMin: { H: 3 * unit.H, P: 3 * unit.P } });
  const applied = clampCurve(prev, fit.curve, REFIT_MAX_STEP);
  const gate = backtestGate(obs, unit);
  console.log(`\nBacktest gate: ${gate.pass ? "PASSED" : "FAILED"} (${gate.evaluated - gate.failed}/${gate.evaluated} checks passed)`);
  for (const c of gate.checks.filter((x) => !x.pass)) console.log(`   FAIL  ${c.name}: ${c.detail}`);
  console.log("\nage\tH active\tH fitted\tH applied\t| P active\tP fitted\tP applied");
  for (let age = 19; age <= 30; age++) {
    const g = (c: RealizationCurve, t: PlayerType) => shareAtAge(c, t, age).toFixed(2);
    console.log(`${age}\t${g(prev, "H")}\t${g(fit.curve, "H")}\t${g(applied, "H")}\t| ${g(prev, "P")}\t${g(fit.curve, "P")}\t${g(applied, "P")}`);
  }
  const change = maxCurveDiff(prev, applied);
  console.log(`\nLargest single change vs the active curve: ${change.toFixed(3)} (limit ${REFIT_MAX_STEP} per refit)`);
  const report = { gate_pass: gate.pass, checks_passed: gate.evaluated - gate.failed, checks_total: gate.evaluated, failed: gate.checks.filter((c) => !c.pass), observations: obs.length, pairs: nPairs, max_change: Number(change.toFixed(4)), candidate_unclamped: fit.curve };
  const setNote = `Auto-refit ${today} on ${obs.length} observations from ${nPairs} snapshot pairs (evidence through ${newestEvidence}); each R moved at most ${REFIT_MAX_STEP} from set #${active.id}.`;

  if (!gate.pass) {
    const id = await record(`Auto-refit ${today} REJECTED (backtest gate failed)`, `${setNote} Gate failed ${gate.failed} of ${gate.evaluated} checks; the active curve (#${active.id}) stays.`, report);
    console.log(dryRun ? "DRY RUN: would reject and keep the active curve." : `Rejected candidate recorded as set #${id}; active curve #${active.id} unchanged.`);
    return;
  }
  if (change < REFIT_MATERIAL_CHANGE) {
    if (!dryRun) {
      const { error } = await supabase.from("potential_realization_sets").update({ fit_through_game_date: newestEvidence, n_pairs: nPairs, gate_report: report } as never).eq("id", active.id);
      if (error) throw new Error(`could not advance the evidence date on set #${active.id}: ${error.message}`);
    }
    console.log(`Gate passed, but the curve barely moves (${change.toFixed(3)} < ${REFIT_MATERIAL_CHANGE}) -- keeping set #${active.id}${dryRun ? " (dry run)" : "; evidence date advanced"}.`);
    return;
  }
  // Kill switch: POTENTIAL_REFIT_ACTIVATE=0 stores a passing candidate as an INACTIVE "PROPOSED" set and leaves the active curve alone.
  if (process.env.POTENTIAL_REFIT_ACTIVATE === "0") {
    const pid = await record(`Auto-refit ${today} PROPOSED (activation switched off)`, `${setNote} Passed the gate but NOT activated: POTENTIAL_REFIT_ACTIVATE=0.`, report, applied, false);
    console.log(dryRun ? "DRY RUN: would store this candidate as a PROPOSED (inactive) set." : `PROPOSED set #${pid} stored inactive (activation is switched off); active curve #${active.id} unchanged.`);
    return;
  }
  const id = await record(`Auto-refit ${today}`, setNote, report, applied, true);
  console.log(dryRun ? "DRY RUN: would activate the applied curve." : `ACTIVATED set #${id}. compute-ratings (next step) applies it to the current run; history needs a re-score (compute-ratings --all) to match.`);
  if (!dryRun && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "curve_changed=true\n");
}

main().catch((err) => {
  // Never block the refresh: the active curve simply stays.
  console.error("auto-refit-potential-realization failed (active curve unchanged):", err);
  process.exit(0);
});
