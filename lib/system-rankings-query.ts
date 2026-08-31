import { makeSupabaseClient } from "./supabase-client";
import { getOrgTeams } from "./queries";
import { teamLogoUrl } from "./display-helpers";

const supabase = makeSupabaseClient();

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function latestRefreshRunId(): Promise<number> {
  const { data, error } = await supabase
    .from("player_computed").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).single();
  if (error || !data) throw new Error(`No player_computed data found: ${error?.message}`);
  return (data as { refresh_run_id: number }).refresh_run_id;
}

const TOP_N_PER_SPLIT = 5;

// Word grades for the Blue-Chip/Depth/Balance breakdown (2026-08-31, for the
// System Rankings cards -- Rees's spec: "these grade breakdowns don't need
// to display the actual numerical metrics, I think rather just displaying
// grades would work here"). Deliberately a SEPARATE calibration from the
// player-level 20-80 grade word table in prospect-bio-style-guide.md, not a
// reuse of it -- these are league-PERCENTILE rankings of an org-aggregate
// score (a raw sum with no natural 20-80 bound), not individual 20-80 tool
// grades, so a fresh, round, symmetric percentile calibration is more
// honest than forcing them through the player-grade thresholds via some
// invented pseudo-grade conversion. Same 5-word vocabulary and the same
// color gradient (via percentileStyle in display-helpers.ts) as everywhere
// else on the site, though -- just a different scale underneath the words.
function percentileToGrade(percentile: number): string {
  if (percentile >= 90) return "Elite";
  if (percentile >= 70) return "Plus";
  if (percentile >= 30) return "Average";
  if (percentile >= 10) return "Below Average";
  return "Well Below Average";
}

// Balance Index gets an ABSOLUTE grade instead, deliberately NOT the
// percentile-among-orgs treatment above -- caught live 2026-08-31 checking
// this against real data: the whole league currently clusters tightly at
// 0.85-0.98 (every org this season genuinely has a well-rounded system, no
// truly lopsided ones at all), which meant a real 0.91 -- an objectively
// strong, honestly-balanced number -- was grading as "Below Average" purely
// because a few other orgs happened to sit even higher. Unlike Blue-Chip/
// Depth (arbitrary-unit sums with no meaning outside league context, where
// relative standing IS the only sensible frame), Balance Index is already a
// self-explanatory 0-1 ratio (1 = perfectly balanced) with real absolute
// meaning on its own, so it's graded against fixed thresholds instead of
// wherever the league happens to sit this run. `percentile` on the returned
// grade is still a 0-100 value for percentileStyle()'s color, just derived
// from the absolute scale (index * 100) rather than a real percentile, so
// the color always agrees with the word instead of the two telling
// different stories.
function balanceIndexToGrade(index: number): SystemRankingGrade {
  const word = index >= 0.90 ? "Elite" : index >= 0.75 ? "Plus" : index >= 0.55 ? "Average" : index >= 0.35 ? "Below Average" : "Well Below Average";
  return { word, percentile: Math.max(0, Math.min(100, index * 100)) };
}

// Rank (1 = best) among `total` orgs -> a 0-100 percentile, 100 = best, for
// percentileStyle()'s color gradient. `total <= 1` returns 50 (neutral) --
// there's no real "relative to the league" signal with 0 or 1 orgs.
function rankToPercentile(rank: number | null, total: number): number | null {
  if (rank === null || total <= 1) return rank === null ? null : 50;
  return (100 * (total - rank)) / (total - 1);
}

export interface SystemRankingProspect {
  player_id: number;
  rank: number | null; // league-wide prospect_rank, not the org-relative slot
  role: string | null;
  name: string;
}

export interface SystemRankingGrade {
  word: string;
  percentile: number; // 0-100, feed directly to percentileStyle()
}

export interface SystemRankingCardRow {
  team_id: number;
  name: string;
  nickname: string;
  logoUrl: string | null;
  minorsRank: number | null;
  minorsRankPercentile: number | null;
  battingProspectRank: number | null;
  battingRankPercentile: number | null;
  pitchingProspectRank: number | null;
  pitchingRankPercentile: number | null;
  readinessRank: number | null;
  readinessRankPercentile: number | null;
  blueChip: SystemRankingGrade | null;
  depth: SystemRankingGrade | null;
  balance: SystemRankingGrade | null;
  topHitters: SystemRankingProspect[];
  topPitchers: SystemRankingProspect[];
  // Hand/AI-written system-analysis paragraph, per org_system_bios -- same
  // infrastructure pattern as ProspectRow's bio/bioStale/bioDate (see
  // getTopProspectsDetailed). Null bio_text is the expected, common state
  // until the actual writing pass happens -- this feature ships with the
  // table empty, same as prospect_bios originally did.
  bio: string | null;
  bioStale: boolean;
  bioDate: string | null;
}

export async function getSystemRankingsDetailed(): Promise<SystemRankingCardRow[]> {
  const orgTeams = await getOrgTeams();
  const teamIds = orgTeams.map((t) => t.id);
  if (teamIds.length === 0) return [];
  const refreshRunId = await latestRefreshRunId();

  interface TeamComputedRow {
    team_id: number; minors_rank: number | null; batting_prospect_rank: number | null; pitching_prospect_rank: number | null;
    tbl_readiness_rank: number | null; blue_chip_score: number | null; depth_score: number | null; balance_index: number | null;
  }
  const { data: tcData, error: tcErr } = await supabase.from("team_computed")
    .select("team_id,minors_rank,batting_prospect_rank,pitching_prospect_rank,tbl_readiness_rank,blue_chip_score,depth_score,balance_index")
    .eq("refresh_run_id", refreshRunId).in("team_id", teamIds);
  if (tcErr) throw tcErr;
  const tcByTeam = new Map((tcData as TeamComputedRow[]).map((r) => [r.team_id, r]));
  const teamsWithScore = [...tcByTeam.values()].filter((r) => r.minors_rank !== null).length;

  // Percentile ranks for Blue-Chip/Depth/Balance -- these three are raw
  // values, not stored ranks, so they're ranked here in JS (cheap, ~30 orgs)
  // the same way scripts/compute-team-ratings.ts ranks everything else.
  function percentileRank<K extends "blue_chip_score" | "depth_score">(key: K): Map<number, number> {
    const withValue = [...tcByTeam.entries()].filter(([, r]) => r[key] !== null) as [number, TeamComputedRow][];
    withValue.sort((a, b) => (b[1][key] as number) - (a[1][key] as number));
    const out = new Map<number, number>();
    withValue.forEach(([teamId], i) => {
      const pct = withValue.length > 1 ? (100 * (withValue.length - 1 - i)) / (withValue.length - 1) : 50;
      out.set(teamId, pct);
    });
    return out;
  }
  const blueChipPercentileByTeam = percentileRank("blue_chip_score");
  const depthPercentileByTeam = percentileRank("depth_score");

  // Prospect pool for the top-5-hitters/top-5-pitchers columns -- fetched
  // separately from `players` (not an embedded players(...) join off
  // player_computed) deliberately, same reasoning as fetchComputedPlayers in
  // queries.ts: avoids the PGRST201 ambiguity class of bug entirely (see
  // HANDOFF.md gotcha 34) rather than needing the explicit-constraint-name
  // workaround on yet another call site.
  const prospectRows = await fetchAll<{
    player_id: number; ph: "H" | "P" | null; prospect_potential: number; prospect_rank: number | null;
    prospect_org_rank: number | null; role: string | null;
  }>((from, to) =>
    supabase.from("player_computed")
      .select("player_id,ph,prospect_potential,prospect_rank,prospect_org_rank,role")
      .eq("refresh_run_id", refreshRunId).not("prospect_org_rank", "is", null)
      .range(from, to) as never
  );
  const prospectIds = prospectRows.map((r) => r.player_id);
  const playersById = new Map<number, { first_name: string; last_name: string; organization_id: number | null }>();
  for (let i = 0; i < prospectIds.length; i += 500) {
    const chunk = prospectIds.slice(i, i + 500);
    const { data, error } = await supabase.from("players").select("id,first_name,last_name,organization_id").in("id", chunk);
    if (error) throw error;
    (data as { id: number; first_name: string; last_name: string; organization_id: number | null }[])
      .forEach((p) => playersById.set(p.id, p));
  }

  const hittersByOrg = new Map<number, SystemRankingProspect[]>();
  const pitchersByOrg = new Map<number, SystemRankingProspect[]>();
  const byOrgSplit = new Map<string, { player_id: number; prospect_potential: number; prospect_rank: number | null; role: string | null; name: string }[]>();
  for (const r of prospectRows) {
    const p = playersById.get(r.player_id);
    if (!p || p.organization_id === null || !r.ph) continue;
    const key = `${p.organization_id}|${r.ph}`;
    const list = byOrgSplit.get(key) ?? [];
    list.push({ player_id: r.player_id, prospect_potential: r.prospect_potential, prospect_rank: r.prospect_rank, role: r.role, name: `${p.first_name} ${p.last_name}` });
    byOrgSplit.set(key, list);
  }
  for (const [key, list] of byOrgSplit) {
    const [orgIdStr, ph] = key.split("|");
    const orgId = Number(orgIdStr);
    const top = list.sort((a, b) => b.prospect_potential - a.prospect_potential).slice(0, TOP_N_PER_SPLIT)
      .map((r) => ({ player_id: r.player_id, rank: r.prospect_rank, role: r.role, name: r.name }));
    (ph === "H" ? hittersByOrg : pitchersByOrg).set(orgId, top);
  }

  // System-analysis bios, same pattern as ProspectRow's bio/bioStale/bioDate
  // in getTopProspectsDetailed -- see org_system_bios's own comment for why
  // this ships empty and gets filled in by a separate writing pass.
  const { data: bioData, error: bioErr } = await supabase.from("org_system_bios")
    .select("organization_id,bio_text,refresh_run_id").in("organization_id", teamIds);
  if (bioErr) throw bioErr;
  const bioByOrg = new Map((bioData as { organization_id: number; bio_text: string; refresh_run_id: number }[])
    .map((b) => [b.organization_id, b]));
  const bioRunIds = [...new Set([...bioByOrg.values()].map((b) => b.refresh_run_id))];
  const bioRunGameDateById = new Map<number, string | null>();
  if (bioRunIds.length > 0) {
    const { data, error } = await supabase.from("refresh_runs").select("id,game_date").in("id", bioRunIds);
    if (error) throw error;
    (data as { id: number; game_date: string | null }[]).forEach((r) => bioRunGameDateById.set(r.id, r.game_date));
  }

  const grade = (percentile: number | undefined): SystemRankingGrade | null =>
    percentile === undefined ? null : { word: percentileToGrade(percentile), percentile };

  return orgTeams
    .map((t) => {
      const tc = tcByTeam.get(t.id);
      const bio = bioByOrg.get(t.id);
      return {
        team_id: t.id,
        name: t.name,
        nickname: t.nickname,
        logoUrl: teamLogoUrl(t.name, t.nickname),
        minorsRank: tc?.minors_rank ?? null,
        minorsRankPercentile: rankToPercentile(tc?.minors_rank ?? null, teamsWithScore),
        battingProspectRank: tc?.batting_prospect_rank ?? null,
        battingRankPercentile: rankToPercentile(tc?.batting_prospect_rank ?? null, teamsWithScore),
        pitchingProspectRank: tc?.pitching_prospect_rank ?? null,
        pitchingRankPercentile: rankToPercentile(tc?.pitching_prospect_rank ?? null, teamsWithScore),
        readinessRank: tc?.tbl_readiness_rank ?? null,
        readinessRankPercentile: rankToPercentile(tc?.tbl_readiness_rank ?? null, teamsWithScore),
        blueChip: grade(blueChipPercentileByTeam.get(t.id)),
        depth: grade(depthPercentileByTeam.get(t.id)),
        balance: tc?.balance_index != null ? balanceIndexToGrade(tc.balance_index) : null,
        topHitters: hittersByOrg.get(t.id) ?? [],
        topPitchers: pitchersByOrg.get(t.id) ?? [],
        bio: bio?.bio_text ?? null,
        bioStale: bio ? bio.refresh_run_id < refreshRunId : false,
        bioDate: bio ? (bioRunGameDateById.get(bio.refresh_run_id) ?? null) : null,
      };
    })
    .sort((a, b) => (a.minorsRank ?? 999) - (b.minorsRank ?? 999));
}
