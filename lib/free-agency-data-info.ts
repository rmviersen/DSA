import { makeSupabaseClient } from "./supabase-client";

// Provenance line for the Free Agency page (2026-10-13, Rees: "update ... demands vs mkt rates"). Demands come from a
// MANUAL OOTP export and market rates from a MANUAL curve refit, and both go stale quickly during free agency, so the page
// should say which import / fit it is actually showing. Server-only (like free-agency-query.ts).
const supabase = makeSupabaseClient();

export interface FreeAgencyDataInfo {
  demandImportedAt: string | null;
  demandGameDate: string | null;
  demandsWithAsk: number;
  curveComputedAt: string | null;
  hitterCurveN: number | null;
  pitcherCurveN: number | null;
}

export async function getFreeAgencyDataInfo(leagueId: number): Promise<FreeAgencyDataInfo> {
  const { data: imp, error: impErr } = await supabase
    .from("free_agent_demand_imports").select("id,imported_at,game_date").eq("dsa_league_id", leagueId).order("id", { ascending: false }).limit(1).maybeSingle();
  if (impErr) throw impErr;
  const latest = imp as { id: number; imported_at: string; game_date: string | null } | null;
  let demandsWithAsk = 0;
  if (latest) {
    const { count, error } = await supabase
      .from("free_agent_demands").select("player_id", { count: "exact", head: true }).eq("import_id", latest.id).not("demand_salary", "is", null);
    if (error) throw error;
    demandsWithAsk = count ?? 0;
  }

  const { data: runRow } = await supabase
    .from("market_rate_curves").select("refresh_run_id").eq("dsa_league_id", leagueId).order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  let curveComputedAt: string | null = null, hitterCurveN: number | null = null, pitcherCurveN: number | null = null;
  if (runRow) {
    const { data: curves, error: curveErr } = await supabase
      .from("market_rate_curves").select("player_type,sample_size,computed_at").eq("dsa_league_id", leagueId).eq("refresh_run_id", (runRow as { refresh_run_id: number }).refresh_run_id);
    if (curveErr) throw curveErr;
    for (const c of (curves ?? []) as { player_type: string; sample_size: number; computed_at: string }[]) {
      curveComputedAt = c.computed_at;
      if (c.player_type === "hitter") hitterCurveN = c.sample_size;
      if (c.player_type === "pitcher") pitcherCurveN = c.sample_size;
    }
  }
  return { demandImportedAt: latest?.imported_at ?? null, demandGameDate: latest?.game_date ?? null, demandsWithAsk, curveComputedAt, hitterCurveN, pitcherCurveN };
}
