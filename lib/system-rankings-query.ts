import { makeSupabaseClient } from "./supabase-client";
import { getOrgTeams } from "./queries";
import { teamLogoUrl, effectiveLevel, levelLabel } from "./display-helpers";

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

async function latestRefreshRunId(leagueId: number): Promise<number> {
  const { data, error } = await supabase
    .from("player_computed").select("refresh_run_id").eq("dsa_league_id", leagueId).order("refresh_run_id", { ascending: false }).limit(1).single();
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
//
// Balance Index uses this SAME percentile treatment as Blue-Chip/Depth --
// NOT the absolute fixed-threshold version tried the same day and reverted
// hours later (Rees's explicit call): an absolute scale made Steam's
// balance grade "Plus" despite a #27 (of ~32) pitching rank next to a #3
// batting rank -- a real, competitively-lopsided system by any relative
// measure, just one whose raw ratio (0.85) still looked fine in isolation
// because ~nobody in this particular league happens to be badly imbalanced
// this season. Rees's call: balance should read as bad when a system is
// relatively lopsided vs. its peers, even if the whole league's actual
// spread is tight -- consistent with Blue-Chip/Depth already being
// league-relative, not absolute. If a future season ever produces a wide,
// varied spread of balance indices, this will naturally look more
// differentiated again; it's the SAME mechanism as Blue-Chip/Depth, not a
// special case.
function percentileToGrade(percentile: number): string {
  if (percentile >= 90) return "Elite";
  if (percentile >= 70) return "Plus";
  if (percentile >= 30) return "Average";
  if (percentile >= 10) return "Below Average";
  return "Well Below Average";
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
  // Age, current level and WAR (2026-09-18, Rees's ask). WAR is this season's if
  // the player has any stat row yet, otherwise his most recent completed
  // season's (warYear says which; warIsFallback flags the older one) -- same
  // per-player fallback rule as Top Prospects' stat line.
  age: number | null;
  level: string;
  war: number | null;
  warYear: number | null;
  warIsFallback: boolean;
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
  // Current MLB record + division position (2026-09-18, Rees's ask), from the
  // latest team_standings_snapshots run. Null if no standings captured yet.
  record: string | null; // "27-21"
  standing: string | null; // "4th in the FC Topaz"
  // # of this org's players in the leaguewide top 100 / top 200 prospects.
  top100Count: number;
  top200Count: number;
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

export async function getSystemRankingsDetailed(leagueId: number): Promise<SystemRankingCardRow[]> {
  const orgTeams = await getOrgTeams(leagueId);
  const teamIds = orgTeams.map((t) => t.id);
  if (teamIds.length === 0) return [];
  const refreshRunId = await latestRefreshRunId(leagueId);

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
  function percentileRank<K extends "blue_chip_score" | "depth_score" | "balance_index">(key: K): Map<number, number> {
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
  const balancePercentileByTeam = percentileRank("balance_index");

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
  const playersById = new Map<number, { first_name: string; last_name: string; organization_id: number | null; age: number | null; level: number | null; league_id: number | null }>();
  for (let i = 0; i < prospectIds.length; i += 500) {
    const chunk = prospectIds.slice(i, i + 500);
    const { data, error } = await supabase.from("players").select("id,first_name,last_name,organization_id,age,level,league_id").eq("dsa_league_id", leagueId).in("id", chunk);
    if (error) throw error;
    (data as { id: number; first_name: string; last_name: string; organization_id: number | null; age: number | null; level: number | null; league_id: number | null }[])
      .forEach((p) => playersById.set(p.id, p));
  }

  // WAR for the displayed players only (the top 5 hitters + 5 pitchers per org, decided
  // by the same sort used below), current season if any row exists else the most
  // recent completed season -- per player, so a minor leaguer whose season hasn't
  // started falls back on his own while an MLB player doesn't. Summed across
  // stints/levels (split_id 1), hitters from batting WAR, pitchers from pitching WAR.
  const shownIds = new Map<number, "H" | "P">();
  {
    const tmp = new Map<string, typeof prospectRows>();
    for (const r of prospectRows) {
      const p = playersById.get(r.player_id);
      if (!p || p.organization_id === null || !r.ph) continue;
      const k = p.organization_id + "|" + r.ph;
      tmp.set(k, [...(tmp.get(k) ?? []), r]);
    }
    for (const list of tmp.values()) list.sort((a, b) => b.prospect_potential - a.prospect_potential).slice(0, TOP_N_PER_SPLIT).forEach((r) => shownIds.set(r.player_id, r.ph as "H" | "P"));
  }
  const { data: curYearRow } = await supabase.from("player_batting_stats_snapshots").select("year").eq("refresh_run_id", refreshRunId).order("year", { ascending: false }).limit(1).maybeSingle();
  const currentYear = (curYearRow as { year: number } | null)?.year ?? null;
  let fbQuery = supabase.from("player_batting_stats_snapshots").select("year,refresh_run_id").eq("dsa_league_id", leagueId);
  if (currentYear !== null) fbQuery = fbQuery.lt("year", currentYear);
  const { data: fbRow } = await fbQuery.order("year", { ascending: false }).order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  const fallbackSeason = fbRow as { year: number; refresh_run_id: number } | null;
  async function warFor(year: number, runId: number, ids: number[], table: "player_batting_stats_snapshots" | "player_pitching_stats_snapshots") {
    const out = new Map<number, number>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase.from(table).select("player_id,war").eq("refresh_run_id", runId).eq("year", year).eq("split_id", 1).in("player_id", ids.slice(i, i + 200));
      if (error) throw error;
      for (const r of data as { player_id: number; war: number | null }[]) if (r.war !== null) out.set(r.player_id, (out.get(r.player_id) ?? 0) + r.war);
    }
    return out;
  }
  const hIds = [...shownIds].filter(([, ph]) => ph === "H").map(([id]) => id);
  const pIds = [...shownIds].filter(([, ph]) => ph === "P").map(([id]) => id);
  const none = () => Promise.resolve(new Map<number, number>());
  const [curH, curP, fbH, fbP] = await Promise.all([
    currentYear !== null ? warFor(currentYear, refreshRunId, hIds, "player_batting_stats_snapshots") : none(),
    currentYear !== null ? warFor(currentYear, refreshRunId, pIds, "player_pitching_stats_snapshots") : none(),
    fallbackSeason ? warFor(fallbackSeason.year, fallbackSeason.refresh_run_id, hIds, "player_batting_stats_snapshots") : none(),
    fallbackSeason ? warFor(fallbackSeason.year, fallbackSeason.refresh_run_id, pIds, "player_pitching_stats_snapshots") : none(),
  ]);
  const warByPlayer = new Map<number, { war: number; year: number; isFallback: boolean }>();
  for (const [id, ph] of shownIds) {
    const cur = (ph === "H" ? curH : curP).get(id);
    if (cur !== undefined && currentYear !== null) { warByPlayer.set(id, { war: cur, year: currentYear, isFallback: false }); continue; }
    const fb = (ph === "H" ? fbH : fbP).get(id);
    if (fb !== undefined && fallbackSeason) warByPlayer.set(id, { war: fb, year: fallbackSeason.year, isFallback: true });
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
    const top: SystemRankingProspect[] = list.sort((a, b) => b.prospect_potential - a.prospect_potential).slice(0, TOP_N_PER_SPLIT)
      .map((r) => {
        const p = playersById.get(r.player_id)!;
        const w = warByPlayer.get(r.player_id);
        return {
          player_id: r.player_id, rank: r.prospect_rank, role: r.role, name: r.name,
          age: p.age, level: levelLabel(effectiveLevel(p.level, p.league_id, leagueId)),
          war: w?.war ?? null, warYear: w?.year ?? null, warIsFallback: w?.isFallback ?? false,
        };
      });
    (ph === "H" ? hittersByOrg : pitchersByOrg).set(orgId, top);
  }

  // System-analysis bios, same pattern as ProspectRow's bio/bioStale/bioDate
  // in getTopProspectsDetailed -- see org_system_bios's own comment for why
  // this ships empty and gets filled in by a separate writing pass.
  const { data: bioData, error: bioErr } = await supabase.from("org_system_bios")
    .select("organization_id,bio_text,refresh_run_id").eq("dsa_league_id", leagueId).in("organization_id", teamIds);
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

  // MLB standings (2026-09-18) -- latest run that captured any (a failed/partial
  // refresh may not have), scoped to this league.
  const { data: latestStandingsRow } = await supabase.from("team_standings_snapshots")
    .select("refresh_run_id").eq("dsa_league_id", leagueId).order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  const standingsByTeam = new Map<number, { wins: number; losses: number; division_name: string; division_rank: number }>();
  if (latestStandingsRow) {
    const { data: st, error: stErr } = await supabase.from("team_standings_snapshots")
      .select("team_id,wins,losses,division_name,division_rank")
      .eq("dsa_league_id", leagueId).eq("refresh_run_id", (latestStandingsRow as { refresh_run_id: number }).refresh_run_id);
    if (stErr) throw stErr;
    (st as { team_id: number; wins: number; losses: number; division_name: string; division_rank: number }[]).forEach((r) => standingsByTeam.set(r.team_id, r));
  }
  // "Fire Conference Topaz Division" -> "FC Topaz"; anything unexpected falls back to the raw name.
  const shortDivision = (name: string) => {
    const m = name.match(/^(\w+) Conference (.+) Division$/);
    return m ? `${m[1][0]}C ${m[2]}` : name;
  };
  const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10 < 4 ? n % 10 : 0]}`;

  // Top 100 / top 200 prospect counts per org (prospectRows already covers every
  // ranked prospect, and anyone in the top 200 has an org rank).
  const top100ByOrg = new Map<number, number>();
  const top200ByOrg = new Map<number, number>();
  for (const r of prospectRows) {
    const orgId = playersById.get(r.player_id)?.organization_id;
    if (orgId == null || r.prospect_rank == null) continue;
    if (r.prospect_rank <= 200) top200ByOrg.set(orgId, (top200ByOrg.get(orgId) ?? 0) + 1);
    if (r.prospect_rank <= 100) top100ByOrg.set(orgId, (top100ByOrg.get(orgId) ?? 0) + 1);
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
        record: standingsByTeam.has(t.id) ? `${standingsByTeam.get(t.id)!.wins}-${standingsByTeam.get(t.id)!.losses}` : null,
        standing: standingsByTeam.has(t.id) ? `${ordinal(standingsByTeam.get(t.id)!.division_rank)} in the ${shortDivision(standingsByTeam.get(t.id)!.division_name)}` : null,
        top100Count: top100ByOrg.get(t.id) ?? 0,
        top200Count: top200ByOrg.get(t.id) ?? 0,
        blueChip: grade(blueChipPercentileByTeam.get(t.id)),
        depth: grade(depthPercentileByTeam.get(t.id)),
        balance: grade(balancePercentileByTeam.get(t.id)),
        topHitters: hittersByOrg.get(t.id) ?? [],
        topPitchers: pitchersByOrg.get(t.id) ?? [],
        bio: bio?.bio_text ?? null,
        bioStale: bio ? bio.refresh_run_id < refreshRunId : false,
        bioDate: bio ? (bioRunGameDateById.get(bio.refresh_run_id) ?? null) : null,
      };
    })
    .sort((a, b) => (a.minorsRank ?? 999) - (b.minorsRank ?? 999));
}
