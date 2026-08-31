import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";

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

const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);
const rankDesc = <T,>(items: T[], key: (t: T) => number | null) => {
  const withKey = items.map((t) => ({ t, k: key(t) })).filter((x) => x.k !== null) as { t: T; k: number }[];
  withKey.sort((a, b) => b.k - a.k);
  return new Map(withKey.map((x, i) => [x.t, i + 1]));
};

// Blue-Chip + Depth scoring (2026-08-31, Rees's approved System Rankings
// methodology -- full write-up: system-rank-methodology.md). Takes a list
// of prospect values for one org's one H/P split, already sorted
// descending, and splits it into two pieces that get scored differently:
// the top `cutoff` count at FULL value ("Blue-Chip Score", undiluted star
// power -- a true difference-maker at #1 moves this a lot, three merely-
// good prospects don't), everyone past that decays as 1/(rank-cutoff)
// ("Depth Score" -- the next-best prospect counts in full, the one after
// at half, the one after that at a third, and so on). Both are SUMMED,
// deliberately not averaged: an average is bounded by group size and can
// never reward an org for simply HAVING more good prospects, which is
// exactly the gap this methodology exists to close (the old flat top-20
// average this replaces couldn't tell "three superstars, seventeen
// replacement-level guys" apart from "twenty solid-but-unspectacular
// ones," and gave zero credit to a 21st-ranked prospect no matter how
// good, even in a stacked system).
// Returns the two pieces separately (2026-08-31, needed once the System
// Rankings cards wanted to show Blue-Chip/Depth/Balance as their own
// visible grade breakdown, not just baked into one combined split score) --
// callers that only want the total still just add blueChip + depth.
function blueChipPlusDepth(valuesDesc: number[], cutoff: number): { blueChip: number; depth: number } {
  let blueChip = 0, depth = 0;
  valuesDesc.forEach((v, i) => {
    const rank = i + 1;
    if (rank <= cutoff) blueChip += v;
    else depth += v / (rank - cutoff);
  });
  return { blueChip, depth };
}

interface PlayerRow {
  player_id: number;
  overall: number;
  prospect_potential: number;
  ph: "H" | "P";
  prospect_org_rank: number | null;
  org_rank: number | null;
  organization_id: number | null;
}

async function main() {
  const supabase = makeSupabaseClient();

  console.log("Finding latest refresh run with computed player ratings...");
  const { data: pcRow, error: pcErr } = await supabase
    .from("player_computed").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).single();
  if (pcErr || !pcRow) throw new Error(`No player_computed rows found: ${pcErr?.message}`);
  const refreshRunId = (pcRow as { refresh_run_id: number }).refresh_run_id;
  console.log(`Computing team ratings against refresh_run_id ${refreshRunId}`);

  console.log("Loading active system-rank weight set...");
  const { data: srwRow, error: srwErr } = await supabase.from("system_rank_weights").select("*").eq("is_active", true).single();
  if (srwErr || !srwRow) throw new Error(`No active system_rank_weights found: ${srwErr?.message}`);
  const srw = srwRow as { id: number; label: string; blue_chip_cutoff: number; balance_penalty: number };
  console.log(`Using system-rank weight set #${srw.id}: "${srw.label}" (blueChipCutoff=${srw.blue_chip_cutoff}, balancePenalty=${srw.balance_penalty})`);

  console.log("Loading player_computed + org context...");
  const raw = await fetchAll<{
    player_id: number; overall: number; prospect_potential: number; ph: "H" | "P";
    prospect_org_rank: number | null; org_rank: number | null;
    players: { organization_id: number | null } | null;
  }>((from, to) =>
    // "players!player_computed_player_id_fkey" (not the bare "players"
    // shorthand), 2026-08-31 gotcha: player_computed gained a second
    // foreign key to players (comp_player_id, for the player-comp feature)
    // the same day, so PostgREST can no longer infer which relationship a
    // bare "players(...)" embed means -- it started hard-erroring with
    // PGRST201 on every run since, silently stalling team_computed on the
    // last refresh that succeeded before the migration landed (confirmed:
    // team_computed was stuck on refresh_run_id 23 while refresh_runs had
    // already moved on to 24). Same fix already applied to the equivalent
    // embeds in lib/queries.ts's getOrgTeams().
    supabase.from("player_computed")
      .select("player_id, overall, prospect_potential, ph, prospect_org_rank, org_rank, players!player_computed_player_id_fkey(organization_id)")
      .eq("refresh_run_id", refreshRunId)
      .range(from, to) as never
  );
  const rows: PlayerRow[] = raw.map((r) => ({ ...r, organization_id: r.players?.organization_id ?? null }));
  console.log(`  ${rows.length} rows`);

  console.log("Loading teams...");
  const teams = await fetchAll<{ id: number }>((from, to) => supabase.from("teams").select("id").range(from, to) as never);

  const byOrg = new Map<number, PlayerRow[]>();
  for (const r of rows) {
    if (r.organization_id == null) continue;
    if (!byOrg.has(r.organization_id)) byOrg.set(r.organization_id, []);
    byOrg.get(r.organization_id)!.push(r);
  }

  interface TeamAgg {
    team_id: number;
    minor_league_rating: number | null;
    minor_league_batting_rating: number | null;
    minor_league_pitching_rating: number | null;
    minor_league_readiness_rating: number | null;
    balance_index: number | null;
    blue_chip_score: number | null;
    depth_score: number | null;
    team_ovr: number | null;
  }

  const aggs: TeamAgg[] = teams.map((t) => {
    const orgRows = byOrg.get(t.id) ?? [];

    // The org's real prospect pool (same population the old flat-average
    // methodology used -- prospect_org_rank is only ever set for players
    // already in the leaguewide prospect pool), re-split by H/P and
    // ranked WITHIN that split -- there's no stored "rank within org+ph"
    // column, so it's computed fresh here, same as the old top-10-hitters/
    // pitchers logic this replaces used to.
    const prospectsInOrg = orgRows.filter((r) => r.prospect_org_rank !== null);
    const hittersDesc = prospectsInOrg.filter((r) => r.ph === "H").sort((a, b) => b.prospect_potential - a.prospect_potential);
    const pitchersDesc = prospectsInOrg.filter((r) => r.ph === "P").sort((a, b) => b.prospect_potential - a.prospect_potential);

    const battingSplit = hittersDesc.length > 0 ? blueChipPlusDepth(hittersDesc.map((r) => r.prospect_potential), srw.blue_chip_cutoff) : null;
    const pitchingSplit = pitchersDesc.length > 0 ? blueChipPlusDepth(pitchersDesc.map((r) => r.prospect_potential), srw.blue_chip_cutoff) : null;
    const battingScore = battingSplit ? battingSplit.blueChip + battingSplit.depth : null;
    const pitchingScore = pitchingSplit ? pitchingSplit.blueChip + pitchingSplit.depth : null;

    // System Score: batting + pitching, minus a penalty for the GAP between
    // them -- a lopsided system (all bat, no arm, or vice versa) can no
    // longer out-rank a well-rounded one with the same total value. Treats
    // a missing split as a real 0, not null-propagation: an org with real
    // hitting prospects and zero pitching prospects is about as lopsided as
    // it gets, and should be scored (and penalized) accordingly rather than
    // silently dropped from the ranking.
    const battingForMath = battingScore ?? 0;
    const pitchingForMath = pitchingScore ?? 0;
    const minorLeagueRating = (battingScore !== null || pitchingScore !== null)
      ? battingForMath + pitchingForMath - srw.balance_penalty * Math.abs(battingForMath - pitchingForMath)
      : null;

    // Balance Index (display-only context, NOT part of the ranking math
    // above -- the penalty already is): weaker split / stronger split,
    // 0-1, 1 = perfectly balanced. Null (not 0 or 1) when there's no real
    // signal either way (an org with no prospects in either split at all).
    const strongerSplit = Math.max(battingForMath, pitchingForMath);
    const weakerSplit = Math.min(battingForMath, pitchingForMath);
    const balanceIndex = strongerSplit > 0 ? weakerSplit / strongerSplit : null;

    // Blue-Chip Score / Depth Score, combined across BOTH splits (2026-08-31,
    // for the System Rankings cards' 3-way grade breakdown -- Blue-Chip vs.
    // Depth vs. Balance) -- purely a display decomposition of the SAME
    // batting+pitching totals already summed into minor_league_rating above,
    // not a new or different number. Null only when the org has literally no
    // prospects in either split at all.
    const blueChipScore = (battingSplit || pitchingSplit) ? (battingSplit?.blueChip ?? 0) + (pitchingSplit?.blueChip ?? 0) : null;
    const depthScore = (battingSplit || pitchingSplit) ? (battingSplit?.depth ?? 0) + (pitchingSplit?.depth ?? 0) : null;

    // Readiness: same Blue-Chip + Depth shape, using CURRENT Overall
    // instead of Potential -- "how much of this system's value is already
    // realized, not just projected." No balance penalty here -- that
    // concept is about the main ceiling-based ranking above, not this one.
    const battingReadinessSplit = hittersDesc.length > 0 ? blueChipPlusDepth(hittersDesc.map((r) => r.overall), srw.blue_chip_cutoff) : null;
    const pitchingReadinessSplit = pitchersDesc.length > 0 ? blueChipPlusDepth(pitchersDesc.map((r) => r.overall), srw.blue_chip_cutoff) : null;
    const battingReadiness = battingReadinessSplit ? battingReadinessSplit.blueChip + battingReadinessSplit.depth : 0;
    const pitchingReadiness = pitchingReadinessSplit ? pitchingReadinessSplit.blueChip + pitchingReadinessSplit.depth : 0;
    const minorLeagueReadiness = (hittersDesc.length > 0 || pitchersDesc.length > 0) ? battingReadiness + pitchingReadiness : null;

    // Top 18 players org-wide by Overall (RLB's "Team OVR" gate) -- UNCHANGED,
    // out of scope for this methodology rework (current MLB roster strength,
    // a different concept from farm-system ranking). NOTE: RLB also excluded
    // players with a "Serious Inj" flag here -- that was a text-parsing
    // heuristic on an injury description string RLB had that we don't carry
    // over from StatsPlus in the same form. Skipped for this pass; flagged below.
    const top18 = orgRows.filter((r) => r.org_rank !== null && r.org_rank <= 18);
    const teamOvr = avg(top18.map((r) => r.overall));

    return {
      team_id: t.id,
      minor_league_rating: minorLeagueRating,
      minor_league_batting_rating: battingScore,
      minor_league_pitching_rating: pitchingScore,
      minor_league_readiness_rating: minorLeagueReadiness,
      balance_index: balanceIndex,
      blue_chip_score: blueChipScore,
      depth_score: depthScore,
      team_ovr: teamOvr,
    };
  });

  const minorsRankByTeam = rankDesc(aggs, (a) => a.minor_league_rating);
  const battingProspectRankByTeam = rankDesc(aggs, (a) => a.minor_league_batting_rating);
  const pitchingProspectRankByTeam = rankDesc(aggs, (a) => a.minor_league_pitching_rating);
  const readinessRankByTeam = rankDesc(aggs, (a) => a.minor_league_readiness_rating);
  const rosterRankByTeam = rankDesc(aggs, (a) => a.team_ovr);

  const capturedAt = new Date().toISOString();
  const outRows = aggs
    .filter((a) => a.minor_league_rating !== null || a.team_ovr !== null) // skip teams with no players at all
    .map((a) => ({
      refresh_run_id: refreshRunId,
      team_id: a.team_id,
      minor_league_rating: a.minor_league_rating,
      minors_rank: minorsRankByTeam.get(a) ?? null,
      minor_league_batting_rating: a.minor_league_batting_rating,
      batting_prospect_rank: battingProspectRankByTeam.get(a) ?? null,
      minor_league_pitching_rating: a.minor_league_pitching_rating,
      pitching_prospect_rank: pitchingProspectRankByTeam.get(a) ?? null,
      minor_league_readiness_rating: a.minor_league_readiness_rating,
      tbl_readiness_rank: readinessRankByTeam.get(a) ?? null,
      balance_index: a.balance_index,
      blue_chip_score: a.blue_chip_score,
      depth_score: a.depth_score,
      system_rank_weights_id: srw.id,
      team_ovr: a.team_ovr,
      roster_rank: rosterRankByTeam.get(a) ?? null,
      captured_at: capturedAt,
    }));

  console.log(`Writing ${outRows.length} rows to team_computed...`);
  const MAX_ATTEMPTS = 3;
  for (let i = 0; i < outRows.length; i += 500) {
    const batch = outRows.slice(i, i + 500);
    let ok = false, lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
      // upsert, not insert (2026-08-28, same fix as compute-ratings.ts,
      // gotcha 31 -- never ported here until a live GitHub Actions run
      // caught it): confirmed via direct query that the very first
      // "failed" attempt against refresh_run_id 13 had actually already
      // written all 32 rows -- a transient network hiccup lost the success
      // response client-side, so the retry collided with its own prior
      // write on the (refresh_run_id, team_id) unique constraint. The data
      // was correct the whole time; only the error handling was wrong.
      // onConflict makes a retry (transient or a deliberate re-tune)
      // overwrite in place instead of colliding.
      const { error } = await supabase.from("team_computed").upsert(batch as never[], { onConflict: "refresh_run_id,team_id" });
      if (!error) { ok = true; break; }
      lastErr = error;
      console.warn(`team_computed upsert (rows ${i}-${i + batch.length}) failed on attempt ${attempt}/${MAX_ATTEMPTS}: ${error.message}`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    if (!ok) throw new Error(`team_computed upsert failed at row ${i}: ${lastErr}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("compute-team-ratings failed:", err);
  process.exit(1);
});
