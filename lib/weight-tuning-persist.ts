import type { SupabaseClient } from "@supabase/supabase-js";

// Shared persistence for the three weight-tuning regressions (2026-09-02,
// Rees's ask -- "visualize and track our regressions"). Each of
// compute-hitting-weights.ts / compute-baserunning-weights.ts /
// compute-pitching-weights.ts calls this once per run instead of only
// printing to the console, so /admin/weight-tuning has real history to
// show, not just whatever the last manual run happened to print.

export interface WeightTuningCoefficient {
  key: string;
  label: string;
  rawCoefficient: number;
  standardizedCoefficient: number;
  impliedWeight: number;
  currentWeight: number | null; // the live rating_weights value AT THE TIME this ran -- captured, not recomputed later, so history stays honest if weights change
}

export async function persistWeightTuningRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  opts: {
    refreshRunId: number;
    stream: "hitting" | "baserunning" | "pitching" | "overall_blend" | "pitching_sp" | "pitching_rp" | "pitching_sp_war" | "pitching_rp_war";
    targetMetric: string;
    rSquared: number;
    sampleSize: number;
    coefficients: WeightTuningCoefficient[];
  }
): Promise<void> {
  const { data: runRow, error: runErr } = await supabase
    .from("weight_tuning_runs")
    .upsert(
      {
        refresh_run_id: opts.refreshRunId,
        stream: opts.stream,
        target_metric: opts.targetMetric,
        r_squared: opts.rSquared,
        sample_size: opts.sampleSize,
      } as never,
      { onConflict: "refresh_run_id,stream" }
    )
    .select("id")
    .single();
  if (runErr || !runRow) throw new Error(`weight_tuning_runs upsert failed: ${runErr?.message}`);
  const runId = (runRow as { id: number }).id;

  const { error: coefErr } = await supabase.from("weight_tuning_coefficients").upsert(
    opts.coefficients.map((c) => ({
      weight_tuning_run_id: runId,
      variable_key: c.key,
      variable_label: c.label,
      raw_coefficient: c.rawCoefficient,
      standardized_coefficient: c.standardizedCoefficient,
      implied_weight: c.impliedWeight,
      current_weight: c.currentWeight,
    })) as never[],
    { onConflict: "weight_tuning_run_id,variable_key" }
  );
  if (coefErr) throw new Error(`weight_tuning_coefficients upsert failed: ${coefErr.message}`);
}
