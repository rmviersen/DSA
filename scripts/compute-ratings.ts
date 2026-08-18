import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { computeRatings, type RatingsInput, type WeightSet } from "../lib/rating-engine.js";

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

async function main() {
  const supabase = makeSupabaseClient();

  console.log("Loading active weight set...");
  const { data: weightRow, error: weightErr } = await supabase.from("rating_weights").select("*").eq("is_active", true).single();
  if (weightErr || !weightRow) throw new Error(`No active weight set found: ${weightErr?.message}`);
  const weights: WeightSet = weightRow as WeightSet;
  console.log(`Using weight set #${weights.id}: "${(weightRow as { label: string }).label}"`);

  console.log("Finding latest succeeded refresh run with ratings...");
  const { data: runRow, error: runErr } = await supabase
    .from("refresh_runs")
    .select("id")
    .eq("status", "succeeded")
    .eq("ratings_included", true)
    .order("id", { ascending: false })
    .limit(1)
    .single();
  if (runErr || !runRow) throw new Error(`No succeeded refresh run with ratings found: ${runErr?.message}`);
  const refreshRunId = (runRow as { id: number }).id;
  console.log(`Computing against refresh_run_id ${refreshRunId}`);

  console.log("Loading ratings snapshot...");
  const ratings = await fetchAll<RatingsInput & { player_id: number }>((from, to) =>
    supabase.from("player_ratings_snapshots").select("*").eq("refresh_run_id", refreshRunId).range(from, to) as never
  );
  console.log(`  ${ratings.length} ratings rows`);

  console.log("Loading players (for org/rookie-eligibility context)...");
  const players = await fetchAll<{ id: number; organization_id: number | null; mlb_service_days: number | null; last_team_id: number | null }>((from, to) =>
    supabase.from("players").select("id, organization_id, mlb_service_days, last_team_id").range(from, to) as never
  );
  const playerById = new Map(players.map((p) => [p.id, p]));
  console.log(`  ${players.length} players`);

  console.log("Computing core ratings...");
  const capturedAt = new Date().toISOString();
  const computed = ratings.map((r) => {
    const c = computeRatings(r, weights);
    return { player_id: r.player_id, ...c };
  });

  // "Current year" for ETA math — no field gives us this directly, so we use
  // the most recent season we actually have stats for in this refresh. Falls
  // back to the captured_at year if no stats snapshot exists (e.g. first run
  // with --skip-ratings-only stats never pulled).
  const { data: yearRow } = await supabase
    .from("player_batting_stats_snapshots").select("year")
    .eq("refresh_run_id", refreshRunId).order("year", { ascending: false }).limit(1).maybeSingle();
  const currentYear = (yearRow as { year: number } | null)?.year ?? new Date().getFullYear();
  console.log(`Using current_year=${currentYear} for ETA calculations`);

  // RLB ETA: how many years out a prospect projects to debut, as a step
  // function of how far their computed Overall sits below a 65 bar (RLB's
  // original threshold, kept as-is — not something the "future" question
  // this formula answers has a natural per-weight-set tuning knob for).
  function estimateEta(overall: number): number {
    const gap = overall - 65;
    if (gap > 0) return currentYear;
    if (gap > -3) return currentYear + 1;
    if (gap > -6) return currentYear + 2;
    if (gap > -9) return currentYear + 3;
    if (gap > -12) return currentYear + 3;
    if (gap > -15) return currentYear + 4;
    if (gap > -20) return currentYear + 5;
    return currentYear + 5;
  }

  // --- ranks ---------------------------------------------------------
  // League-wide, by our computed Overall / Potential.
  const byOverallDesc = [...computed].sort((a, b) => b.overall - a.overall);
  const rankByPlayer = new Map(byOverallDesc.map((c, i) => [c.player_id, i + 1]));

  const byPotentialDesc = [...computed].sort((a, b) => b.potential - a.potential);
  const potentialRankByPlayer = new Map(byPotentialDesc.map((c, i) => [c.player_id, i + 1]));

  // Prospect pool: still rookie-eligible (RLB's "MLD < 45", mapped to
  // mlb_service_days — see note above) AND either currently in an org, or a
  // genuine free agent with real pro history (last_team_id set). This second
  // condition is the 2026-08-18 fix: without it, "free agent" alone also
  // swept in ~3,700 amateur draft-pool players who've never been rostered —
  // confirmed empirically that free agents with NO last_team_id are almost
  // entirely future-class amateurs (2,697 of 3,735 weren't even in the most
  // recent actual draft class), while free agents WITH a last_team_id are
  // legitimately rare (1,236 total) and never overlap the draft pool at all.
  // Those amateur/future-class players belong on the Draft page, not here.
  const prospectPool = computed.filter((c) => {
    const p = playerById.get(c.player_id);
    if (!p || (p.mlb_service_days ?? 0) >= 45) return false;
    return p.organization_id !== null || (p.last_team_id !== null && p.last_team_id !== 0);
  });
  const byProspectPotentialDesc = [...prospectPool].sort((a, b) => b.prospect_potential - a.prospect_potential);
  const prospectRankByPlayer = new Map(byProspectPotentialDesc.map((c, i) => [c.player_id, i + 1]));

  // Org rank: by Overall, scoped to each org.
  const orgRankByPlayer = new Map<number, number>();
  const byOrg = new Map<number, typeof computed>();
  for (const c of computed) {
    const orgId = playerById.get(c.player_id)?.organization_id;
    if (orgId == null) continue;
    if (!byOrg.has(orgId)) byOrg.set(orgId, []);
    byOrg.get(orgId)!.push(c);
  }
  for (const [, group] of byOrg) {
    const sorted = [...group].sort((a, b) => b.overall - a.overall);
    sorted.forEach((c, i) => orgRankByPlayer.set(c.player_id, i + 1));
  }

  // Prospect org rank: same idea, scoped to the prospect pool only.
  const prospectOrgRankByPlayer = new Map<number, number>();
  const prospectByOrg = new Map<number, typeof prospectPool>();
  for (const c of prospectPool) {
    const orgId = playerById.get(c.player_id)?.organization_id;
    if (orgId == null) continue;
    if (!prospectByOrg.has(orgId)) prospectByOrg.set(orgId, []);
    prospectByOrg.get(orgId)!.push(c);
  }
  for (const [, group] of prospectByOrg) {
    const sorted = [...group].sort((a, b) => b.prospect_potential - a.prospect_potential);
    sorted.forEach((c, i) => prospectOrgRankByPlayer.set(c.player_id, i + 1));
  }

  const rows = computed.map((c) => ({
    refresh_run_id: refreshRunId,
    player_id: c.player_id,
    weights_id: c.weights_id,
    batting: c.batting, batting_p: c.batting_p, fielding: c.fielding,
    pitching: c.pitching, pitching_p: c.pitching_p, qp: c.qp, qpp: c.qpp,
    c_rating: c.c_rating, inf_rating: c.inf_rating, of_rating: c.of_rating,
    overall: c.overall, potential: c.potential, prospect_potential: c.prospect_potential,
    ph: c.ph, role: c.role, sp_rp: c.sp_rp, tbl_pos: c.tbl_pos, platoon: c.platoon,
    rank: rankByPlayer.get(c.player_id) ?? null,
    potential_rank: potentialRankByPlayer.get(c.player_id) ?? null,
    prospect_rank: prospectRankByPlayer.get(c.player_id) ?? null,
    org_rank: orgRankByPlayer.get(c.player_id) ?? null,
    prospect_org_rank: prospectOrgRankByPlayer.get(c.player_id) ?? null,
    eta: prospectRankByPlayer.has(c.player_id) ? estimateEta(c.overall) : null,
    captured_at: capturedAt,
  }));

  console.log(`Writing ${rows.length} rows to player_computed...`);
  const MAX_ATTEMPTS = 3;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    let lastErr: unknown;
    let ok = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
      const { error } = await supabase.from("player_computed").insert(batch as never[]);
      if (!error) { ok = true; break; }
      lastErr = error;
      console.warn(`player_computed insert (rows ${i}-${i + batch.length}) failed on attempt ${attempt}/${MAX_ATTEMPTS}: ${error.message}`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    if (!ok) throw new Error(`player_computed insert failed at row ${i}: ${lastErr}`);
  }

  console.log(`Done. Top 5 by computed Overall:`);
  byOverallDesc.slice(0, 5).forEach((c, i) => console.log(`  ${i + 1}. player ${c.player_id} — Overall ${c.overall.toFixed(2)}`));
}

main().catch((err) => {
  console.error("compute-ratings failed:", err);
  process.exit(1);
});
