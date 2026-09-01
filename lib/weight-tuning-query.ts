import { makeSupabaseClient } from "./supabase-client";

// Data layer for /admin/weight-tuning (2026-09-02, Rees's ask: "visualize
// and track our regressions that are currently inputting into our current
// weights"). Reads the history scripts/compute-{hitting,baserunning,
// pitching}-weights.ts write every refresh into weight_tuning_runs/
// weight_tuning_coefficients -- this page doesn't compute anything itself,
// it only displays what those three scripts already found.
//
// makeSupabaseClient() deliberately NOT called at module top level -- same
// client-bundle-safety reasoning as rating-validation-query.ts/
// market-rate-query.ts (a "use client" component importing a real runtime
// export, not just a type, from this module would otherwise pull a
// server-only env var read into the browser bundle).

export type Stream = "hitting" | "baserunning" | "pitching" | "overall_blend" | "pitching_sp" | "pitching_rp" | "pitching_sp_war" | "pitching_rp_war" | "fielding_defensive";
export const STREAMS: { key: Stream; label: string }[] = [
  { key: "hitting", label: "Hitting" },
  { key: "baserunning", label: "Baserunning" },
  { key: "fielding_defensive", label: "Fielding (Defensive IP)" },
  { key: "pitching_sp", label: "Pitching (SP, FIP-)" },
  { key: "pitching_rp", label: "Pitching (RP, FIP-)" },
  { key: "pitching_sp_war", label: "Pitching (SP, WAR)" },
  { key: "pitching_rp_war", label: "Pitching (RP, WAR)" },
  { key: "overall_blend", label: "Batter Blend" },
];
// "pitching" (undifferentiated, pooled SP+RP) is retired as of 2026-09-02 in
// favor of the role-split streams above -- its historical rows are left in
// weight_tuning_runs, just no longer shown as a tab. Both FIP- and WAR/100 IP
// versions of the SP/RP split are kept side by side (2026-09-02, Rees's ask,
// for comparing how much the target metric itself changes the implied
// weights) -- same population/predictors, only the target differs.

export interface WeightTuningCoefficientRow {
  key: string;
  label: string;
  rawCoefficient: number;
  standardizedCoefficient: number;
  impliedWeight: number;
  // Two distinct things (2026-09-02 fix, Rees: "the current weight column
  // currently reflects the old... I want to show the actual current weights
  // that are being applied always, and then another column with the old
  // weights"): `weightAtRunTime` is a snapshot captured by the compute
  // script when this regression last ran -- goes stale the moment
  // rating_weights changes again afterward. `liveWeight` is looked up fresh
  // from the currently-active rating_weights row every time this page
  // loads, so it's never stale even if the underlying weight changes
  // without this regression being re-run.
  weightAtRunTime: number | null;
  liveWeight: number | null;
}

export interface WeightTuningSnapshot {
  stream: Stream;
  targetMetric: string;
  rSquared: number;
  sampleSize: number;
  computedAt: string;
  refreshRunId: number;
  coefficients: WeightTuningCoefficientRow[];
}

export interface WeightTuningHistoryPoint {
  stream: Stream;
  refreshRunId: number;
  computedAt: string;
  rSquared: number;
  sampleSize: number;
}

// Maps a (stream, variable key) pair to the live rating_weights column that
// actually governs it today. Kept in one place rather than scattered across
// each compute script, since this is purely a display concern -- the
// compute scripts already know their own historical snapshot value, they
// don't need to know the CURRENT column name too.
function liveWeightFor(stream: Stream, key: string, live: Record<string, number | null>): number | null {
  switch (stream) {
    case "hitting":
      return live[key] ?? null; // keys already match column names: contact/gap/power/eye/avoid_ks/speed
    case "baserunning":
      return live[`baserunning_${key}_weight`] ?? null; // speed/run/steal/stlrt
    case "pitching_sp": case "pitching_sp_war":
      return live[`sp_${key}`] ?? null; // stuff/movement/control/stamina
    case "pitching_rp": case "pitching_rp_war":
      return live[`rp_${key}`] ?? null;
    case "overall_blend":
      return live[key] ?? null; // batting/fielding/baserunning
    case "fielding_defensive":
      return live.fielding ?? null; // reference-only stream, shown for context, not a target to apply
    case "pitching":
      return null; // retired stream, no live column mapping needed
  }
}

export async function getLatestWeightTuningSnapshots(): Promise<Record<Stream, WeightTuningSnapshot | null>> {
  const supabase = makeSupabaseClient();

  const { data: liveWeightRow } = await supabase
    .from("rating_weights")
    .select("contact, gap, power, eye, avoid_ks, speed, batting, fielding, baserunning, sp_stuff, sp_movement, sp_control, sp_stamina, rp_stuff, rp_movement, rp_control, rp_stamina, baserunning_speed_weight, baserunning_run_weight, baserunning_steal_weight, baserunning_stlrt_weight")
    .eq("is_active", true)
    .maybeSingle();
  const liveWeights = (liveWeightRow ?? {}) as Record<string, number | null>;

  const { data: runs, error } = await supabase
    .from("weight_tuning_runs")
    .select("id, refresh_run_id, stream, target_metric, r_squared, sample_size, computed_at")
    .order("refresh_run_id", { ascending: false });
  if (error) throw error;

  const result: Record<Stream, WeightTuningSnapshot | null> = {
    hitting: null, baserunning: null, pitching: null, overall_blend: null,
    pitching_sp: null, pitching_rp: null, pitching_sp_war: null, pitching_rp_war: null,
    fielding_defensive: null,
  };
  const latestRunRowByStream = new Map<Stream, { id: number; refresh_run_id: number; target_metric: string; r_squared: number; sample_size: number; computed_at: string }>();
  for (const r of (runs ?? []) as { id: number; refresh_run_id: number; stream: Stream; target_metric: string; r_squared: number; sample_size: number; computed_at: string }[]) {
    if (!latestRunRowByStream.has(r.stream)) latestRunRowByStream.set(r.stream, r);
  }
  if (latestRunRowByStream.size === 0) return result;

  const runIds = [...latestRunRowByStream.values()].map((r) => r.id);
  const { data: coefRows, error: coefErr } = await supabase
    .from("weight_tuning_coefficients")
    .select("weight_tuning_run_id, variable_key, variable_label, raw_coefficient, standardized_coefficient, implied_weight, current_weight")
    .in("weight_tuning_run_id", runIds);
  if (coefErr) throw coefErr;

  for (const [stream, run] of latestRunRowByStream) {
    const coefficients = (coefRows ?? [])
      .filter((c) => c.weight_tuning_run_id === run.id)
      .map((c) => ({
        key: c.variable_key, label: c.variable_label,
        rawCoefficient: c.raw_coefficient, standardizedCoefficient: c.standardized_coefficient,
        impliedWeight: c.implied_weight, weightAtRunTime: c.current_weight,
        liveWeight: liveWeightFor(stream, c.variable_key, liveWeights),
      }))
      .sort((a, b) => b.standardizedCoefficient - a.standardizedCoefficient);
    result[stream] = {
      stream, targetMetric: run.target_metric, rSquared: run.r_squared, sampleSize: run.sample_size,
      computedAt: run.computed_at, refreshRunId: run.refresh_run_id, coefficients,
    };
  }
  return result;
}

export interface RatingDistributionPoint {
  role: string;
  overall: number;
  potential: number;
}

// Real Overall/Potential distribution per role (2026-09-02, Rees's ask --
// visualize the shape of each role's rating distribution at the bottom of
// this page, ahead of the hitter/pitcher rescale so the "before" picture is
// on record and the "after" can be compared against it directly). Scoped to
// real MLB roster players (league_id=200, mlb_service_days>0), the same
// reference population every hitter/pitcher-scale comparison this session
// has used -- a prospect/minor-league population would need its own
// level-aware analysis, not folded in here.
export async function getRatingDistributionPoints(): Promise<RatingDistributionPoint[]> {
  const supabase = makeSupabaseClient();

  const { data: computedRunRow } = await supabase
    .from("player_computed").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  if (!computedRunRow) return [];
  const refreshRunId = (computedRunRow as { refresh_run_id: number }).refresh_run_id;

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

  const [computed, players] = await Promise.all([
    fetchAll<{ player_id: number; overall: number | null; potential: number | null; role: string | null }>((from, to) =>
      supabase.from("player_computed").select("player_id, overall, potential, role").eq("refresh_run_id", refreshRunId).range(from, to) as never
    ),
    fetchAll<{ id: number; league_id: number | null; mlb_service_days: number | null }>((from, to) =>
      supabase.from("players").select("id, league_id, mlb_service_days").range(from, to) as never
    ),
  ]);
  const playerMeta = new Map(players.map((p) => [p.id, p]));

  const points: RatingDistributionPoint[] = [];
  for (const c of computed) {
    if (c.overall == null || c.potential == null || !c.role) continue;
    const meta = playerMeta.get(c.player_id);
    if (!meta || meta.league_id !== 200 || (meta.mlb_service_days ?? 0) <= 0) continue;
    points.push({ role: c.role, overall: c.overall, potential: c.potential });
  }
  return points;
}

// Full R²-over-time history per stream, for the "track" half of the ask --
// one point per refresh_run_id these scripts have ever run against.
export async function getWeightTuningHistory(): Promise<WeightTuningHistoryPoint[]> {
  const supabase = makeSupabaseClient();
  const { data, error } = await supabase
    .from("weight_tuning_runs")
    .select("stream, refresh_run_id, computed_at, r_squared, sample_size")
    .order("refresh_run_id", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    stream: r.stream as Stream, refreshRunId: r.refresh_run_id, computedAt: r.computed_at,
    rSquared: r.r_squared, sampleSize: r.sample_size,
  }));
}
