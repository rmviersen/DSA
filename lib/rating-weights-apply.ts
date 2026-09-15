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
export async function applyRatingWeightUpdate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  leagueId: number,
  updates: Record<string, number>,
  label: string,
  notes: string
): Promise<number> {
  const { data, error } = await supabase.rpc("apply_rating_weight_update", {
    p_league_id: leagueId,
    p_updates: updates,
    p_label: label,
    p_notes: notes,
  });
  if (error) throw new Error(`apply_rating_weight_update failed: ${error.message}`);
  return data as number;
}
