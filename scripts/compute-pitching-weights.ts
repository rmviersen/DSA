import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { fitMultipleLinear } from "../lib/regression.js";
import { persistWeightTuningRun } from "../lib/weight-tuning-persist.js";

// Pitching half of the decomposed weight-tuning work (2026-09-02, part of
// "visualize and track our regressions" -- see compute-hitting-weights.ts
// and compute-baserunning-weights.ts for the other two streams).
//
// Target is real WAR per 100 IP, not a from-scratch park/level-neutral
// metric like FIP- -- unlike OPS+, that didn't exist anywhere in this
// schema before this session and needed building; a real FIP-/ERA- needs
// its own league-average-by-level-and-year run-environment work (see
// HANDOFF.md's "Not built yet" list) and is a separate, bigger piece, not
// assumed here. WAR/100 IP is the same target and role-dependent innings
// floor (75 IP for SP, 30 IP for RP) /admin/rating-validation already
// uses, and pooling SP+RP together for this regression is safe from
// restriction of range for the same reason hitting was: SP/RP role
// assignment is gated on `stm`/pitch-count thresholds, never on
// Stuff/Movement/Control/PBABIP -- so none of these five predictors lose
// variance to a role gate the way ifr/ofr did for Fielding.

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

async function main() {
  const supabase = makeSupabaseClient();

  console.log("Finding latest refresh run with player_computed (for grades/role)...");
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

  console.log("Loading players (for the real-MLB-roster filter: league_id=200, mlb_service_days>0)...");
  const players = await fetchAll<{ id: number; league_id: number | null; mlb_service_days: number | null }>((from, to) =>
    supabase.from("players").select("id, league_id, mlb_service_days").range(from, to) as never
  );
  const playerMeta = new Map(players.map((p) => [p.id, p]));
  const isRealMlbPlayer = (playerId: number) => {
    const meta = playerMeta.get(playerId);
    return !!meta && meta.league_id === 200 && (meta.mlb_service_days ?? 0) > 0;
  };

  console.log("Loading 2031 MLB pitching stats (ip, war)...");
  const pitchingRows = await fetchAll<{ player_id: number; ip: number | null; war: number | null }>((from, to) =>
    supabase.from("player_pitching_stats_snapshots").select("player_id, ip, war")
      .eq("year", 2031).eq("level_id", 1).eq("split_id", 1).eq("refresh_run_id", statsRunId)
      .range(from, to) as never
  );
  const byPlayer = new Map<number, { ip: number; war: number }>();
  for (const p of pitchingRows) {
    if (!isRealMlbPlayer(p.player_id)) continue;
    const cur = byPlayer.get(p.player_id) ?? { ip: 0, war: 0 };
    cur.ip += p.ip ?? 0;
    cur.war += p.war ?? 0; // sum within this one run -- same multi-stint-trade handling as everywhere else
    byPlayer.set(p.player_id, cur);
  }
  console.log(`  ${byPlayer.size} real MLB pitchers with any 2031 IP`);

  console.log("Loading pitching grades (stf, mov, ctrl, pbabip, stm)...");
  const ratings = await fetchAll<{ player_id: number; stf: number | null; mov: number | null; ctrl: number | null; pbabip: number | null; stm: number | null }>((from, to) =>
    supabase.from("player_ratings_snapshots").select("player_id, stf, mov, ctrl, pbabip, stm").eq("refresh_run_id", computedRunId).range(from, to) as never
  );
  const ratingsByPlayer = new Map(ratings.map((r) => [r.player_id, r]));

  console.log("Loading roles (pitchers only)...");
  const computed = await fetchAll<{ player_id: number; role: string | null }>((from, to) =>
    supabase.from("player_computed").select("player_id, role").eq("refresh_run_id", computedRunId).range(from, to) as never
  );
  const roleByPlayer = new Map(computed.map((c) => [c.player_id, c.role]));
  const PITCHER_ROLES = new Set(["SP", "RP", "CL"]);

  interface Row { playerId: number; warRate: number; stf: number; mov: number; ctrl: number; pbabip: number; stm: number; ip: number }
  const rows: Row[] = [];
  for (const [playerId, p] of byPlayer) {
    const role = roleByPlayer.get(playerId);
    if (!role || !PITCHER_ROLES.has(role)) continue;
    const minIp = role === "SP" ? MIN_IP_SP : MIN_IP_RP;
    if (p.ip < minIp) continue;
    const r = ratingsByPlayer.get(playerId);
    if (!r || r.stf == null || r.mov == null || r.ctrl == null || r.pbabip == null || r.stm == null) continue;
    rows.push({ playerId, warRate: (p.war / p.ip) * 100, stf: r.stf, mov: r.mov, ctrl: r.ctrl, pbabip: r.pbabip, stm: r.stm, ip: p.ip });
  }
  console.log(`  ${rows.length} qualifying pitchers (>=${MIN_IP_SP} IP for SP / >=${MIN_IP_RP} IP for RP, real grades) for the regression`);
  if (rows.length < 30) throw new Error(`Only ${rows.length} qualifying pitchers -- too small to trust a 5-variable regression. Aborting.`);

  const fit = fitMultipleLinear(rows.map((r) => ({ x: [r.stf, r.mov, r.ctrl, r.pbabip, r.stm], y: r.warRate })));
  const labels = ["Stuff", "Movement", "Control", "PBABIP", "Stamina"];

  console.log(`\nRegression: WAR-per-100-IP ~ Stuff + Movement + Control + PBABIP + Stamina  (n=${rows.length}, R²=${fit.rSquared.toFixed(3)})`);
  console.log(`Intercept: ${fit.intercept.toFixed(4)}`);
  for (let i = 0; i < labels.length; i++) {
    console.log(`  ${labels[i].padEnd(10)} raw coef=${fit.coefficients[i].toFixed(4)} WAR-pts/100IP per grade-pt   standardized=${fit.standardizedCoefficients[i].toFixed(3)}`);
  }

  const clamped = fit.standardizedCoefficients.map((c) => Math.max(0, c));
  const sum = clamped.reduce((s, c) => s + c, 0);
  const normalized = sum > 0 ? clamped.map((c) => c / sum) : clamped.map(() => 0);

  console.log("\nLoading the live active weight set (for the current-weight comparison column)...");
  const { data: weightRow } = await supabase.from("rating_weights").select("stuff, movement, control, pbabip, stamina").eq("is_active", true).maybeSingle();
  const current = weightRow as { stuff: number; movement: number; control: number; pbabip: number; stamina: number } | null;
  const currentByLabel: Record<string, number | null> = {
    Stuff: current?.stuff ?? null, Movement: current?.movement ?? null, Control: current?.control ?? null,
    PBABIP: current?.pbabip ?? null, Stamina: current?.stamina ?? null,
  };

  console.log("\nImplied weight vector if normalized to sum to 1 (diagnostic -- not written to rating_weights):");
  for (let i = 0; i < labels.length; i++) {
    console.log(`  ${labels[i].padEnd(10)} implied=${normalized[i].toFixed(3)}   current=${(currentByLabel[labels[i]] ?? NaN).toFixed(3)}`);
  }

  console.log("\nSaving this run to weight_tuning_runs/weight_tuning_coefficients (for /admin/weight-tuning)...");
  await persistWeightTuningRun(supabase, {
    refreshRunId: computedRunId,
    stream: "pitching",
    targetMetric: "WAR / 100 IP",
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

  console.log("\nDone -- rating_weights itself is untouched; this only saved the diagnostic history.");
}

main().catch((err) => {
  console.error("compute-pitching-weights failed:", err);
  process.exit(1);
});
