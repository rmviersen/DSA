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

export type Stream = "hitting" | "baserunning" | "pitching";
export const STREAMS: { key: Stream; label: string }[] = [
  { key: "hitting", label: "Hitting" },
  { key: "baserunning", label: "Baserunning" },
  { key: "pitching", label: "Pitching" },
];

export interface WeightTuningCoefficientRow {
  key: string;
  label: string;
  rawCoefficient: number;
  standardizedCoefficient: number;
  impliedWeight: number;
  currentWeight: number | null;
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

export async function getLatestWeightTuningSnapshots(): Promise<Record<Stream, WeightTuningSnapshot | null>> {
  const supabase = makeSupabaseClient();

  const { data: runs, error } = await supabase
    .from("weight_tuning_runs")
    .select("id, refresh_run_id, stream, target_metric, r_squared, sample_size, computed_at")
    .order("refresh_run_id", { ascending: false });
  if (error) throw error;

  const result: Record<Stream, WeightTuningSnapshot | null> = { hitting: null, baserunning: null, pitching: null };
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
        impliedWeight: c.implied_weight, currentWeight: c.current_weight,
      }))
      .sort((a, b) => b.standardizedCoefficient - a.standardizedCoefficient);
    result[stream] = {
      stream, targetMetric: run.target_metric, rSquared: run.r_squared, sampleSize: run.sample_size,
      computedAt: run.computed_at, refreshRunId: run.refresh_run_id, coefficients,
    };
  }
  return result;
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
