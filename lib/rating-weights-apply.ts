import type { SupabaseClient } from "@supabase/supabase-js";

// Self-training rating_weights (2026-09-15, Rees's ask -- "the weights and
// model are self-training on every sim"). This is the one place any script
// is allowed to WRITE to rating_weights -- every prior change to this table
// was a manual, hand-reviewed row (13 of them, each with a written
// rationale) with nothing automated. This wraps the atomic
// apply_rating_weight_update() Postgres function (see its own migration
// comment for why it has to be atomic: every reader does
// `.eq("is_active", true).single()`, which throws if zero or more than one
// row is ever active at once, so the deactivate-old/insert-new swap can't
// be two separate round trips from here).
// Largest change any ONE weight may make in a single automatic update (2026-10-06 guardrail). Real self-training
// steps have moved weights by <= ~0.07 per run (e.g. baserunning Speed 0.052 -> 0.119); a regression asking for
// more than this is far more likely a noisy/partial sample than a real shift, so it is refused and the live set is
// left untouched (the caller's script fails loudly in the pipeline log). Deliberate big changes are manual
// rating_weights rows, as they always were. The database ALSO refuses any active set whose weight groups don't
// each sum to 1 (constraint trigger rating_weights_invariants).
export const MAX_AUTO_WEIGHT_STEP = 0.15;

export async function applyRatingWeightUpdate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  leagueId: number,
  updates: Record<string, number>,
  label: string,
  notes: string
): Promise<number> {
  const { data: current, error: curErr } = await supabase.from("rating_weights").select("*").eq("dsa_league_id", leagueId).eq("is_active", true).maybeSingle();
  if (curErr) throw new Error(`applyRatingWeightUpdate: could not read the active weight set: ${curErr.message}`);
  if (current) {
    const tooBig = Object.entries(updates)
      .map(([key, next]) => ({ key, next, prev: Number((current as Record<string, unknown>)[key]) }))
      .filter((u) => Number.isFinite(u.prev) && Math.abs(u.next - u.prev) > MAX_AUTO_WEIGHT_STEP);
    if (tooBig.length > 0) {
      throw new Error(
        `applyRatingWeightUpdate refused: ${tooBig.map((u) => `${u.key} ${u.prev.toFixed(3)} -> ${u.next.toFixed(3)}`).join(", ")} ` +
        `exceeds the ${MAX_AUTO_WEIGHT_STEP} per-update limit. The live weight set was NOT changed.`
      );
    }
  }
  const { data, error } = await supabase.rpc("apply_rating_weight_update", {
    p_league_id: leagueId,
    p_updates: updates,
    p_label: label,
    p_notes: notes,
  });
  if (error) throw new Error(`apply_rating_weight_update failed: ${error.message}`);
  return data as number;
}
