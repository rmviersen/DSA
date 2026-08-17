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

  console.log("Loading player_computed + org context...");
  const raw = await fetchAll<{
    player_id: number; overall: number; prospect_potential: number; ph: "H" | "P";
    prospect_org_rank: number | null; org_rank: number | null;
    players: { organization_id: number | null } | null;
  }>((from, to) =>
    supabase.from("player_computed")
      .select("player_id, overall, prospect_potential, ph, prospect_org_rank, org_rank, players(organization_id)")
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
    team_ovr: number | null;
  }

  const aggs: TeamAgg[] = teams.map((t) => {
    const orgRows = byOrg.get(t.id) ?? [];

    // Top 20 prospects org-wide (by prospect_org_rank, already computed) — this
    // is RLB Teams' "Minor League Rating" / "Minor League Readiness Rating" gate.
    const top20Prospects = orgRows.filter((r) => r.prospect_org_rank !== null && r.prospect_org_rank <= 20);
    const minorLeagueRating = avg(top20Prospects.map((r) => r.prospect_potential));
    const minorLeagueReadiness = avg(top20Prospects.map((r) => r.overall));

    // Top 10 hitters / pitchers within the org's prospect pool, re-ranked
    // within their own PH split (RLB's "Prospect ORG PH Rank" concept —
    // computed fresh here rather than stored, since it's only used for this).
    const prospectsInOrg = orgRows.filter((r) => r.prospect_org_rank !== null);
    const hitters = prospectsInOrg.filter((r) => r.ph === "H").sort((a, b) => b.prospect_potential - a.prospect_potential).slice(0, 10);
    const pitchers = prospectsInOrg.filter((r) => r.ph === "P").sort((a, b) => b.prospect_potential - a.prospect_potential).slice(0, 10);
    const minorLeagueBatting = avg(hitters.map((r) => r.prospect_potential));
    const minorLeaguePitching = avg(pitchers.map((r) => r.prospect_potential));

    // Top 18 players org-wide by Overall (RLB's "Team OVR" gate). NOTE: RLB also
    // excluded players with a "Serious Inj" flag here — that was a text-parsing
    // heuristic on an injury description string RLB had that we don't carry
    // over from StatsPlus in the same form. Skipped for this pass; flagged below.
    const top18 = orgRows.filter((r) => r.org_rank !== null && r.org_rank <= 18);
    const teamOvr = avg(top18.map((r) => r.overall));

    return {
      team_id: t.id,
      minor_league_rating: minorLeagueRating,
      minor_league_batting_rating: minorLeagueBatting,
      minor_league_pitching_rating: minorLeaguePitching,
      minor_league_readiness_rating: minorLeagueReadiness,
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
      const { error } = await supabase.from("team_computed").insert(batch as never[]);
      if (!error) { ok = true; break; }
      lastErr = error;
      console.warn(`team_computed insert (rows ${i}-${i + batch.length}) failed on attempt ${attempt}/${MAX_ATTEMPTS}: ${error.message}`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    if (!ok) throw new Error(`team_computed insert failed at row ${i}: ${lastErr}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("compute-team-ratings failed:", err);
  process.exit(1);
});
