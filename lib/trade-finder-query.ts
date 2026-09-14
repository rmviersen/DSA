import { makeSupabaseClient } from "./supabase-client";
import { latestRefreshRunId } from "./queries";
import { getMyRosterAnalysis } from "./my-roster-query";

const supabase = makeSupabaseClient();

// Trade Finder (2026-09-14, Rees's ask): "let the analytics try and find
// those needs" -- positional/roster weaknesses detected from data already
// computed elsewhere, not manually specified. See the approved plan
// (splendid-spinning-wigderson.md) for the full design; this file is Step 1
// of that plan's sequencing (needs detection only -- candidate matching
// against the trade block and a broader leaguewide scan are separate,
// later steps).

// Bottom-third leaguewide, Rees's exact spec (2026-09-14) -- reuses My
// Roster's own already-calibrated CURRENT rankPct (rankPercentile: 100 =
// best team at that role, 0 = worst -- see org-minors-query.ts), not a new
// metric. Applied identically to the "weak/rebuilding seller team" heuristic
// in the later candidate-matching step, per the plan.
const NEEDS_RANK_PCT_MAX = 33;

// 30+ days out, Rees's exact spec (2026-09-14) -- deliberately NOT the
// Lineup page's own 5-day threshold (isAvailableForLineup in lineup-
// optimizer-query.ts), which answers a different question ("exclude from
// THIS sim's lineup"). A trade is worth making for an absence long enough
// that a rental target would actually see meaningful time before the
// injured player is back.
const INJURY_DAYS_MIN = 30;

export interface RoleRankNeed {
  kind: "role-rank";
  // My Roster's own role taxonomy (ROLE_HEALTH_ROWS: SP/RP/C/1B/INF/SS/CF/
  // COF/DH) -- NOT the Lineup optimizer's exact-position granularity (which
  // splits INF into 2B/3B/SS and COF into LF/RF). Needs detection stays at
  // this coarser, already-calibrated level; the later candidate-matching
  // step is where position-player candidates get evaluated against the
  // Lineup optimizer's exact-position criteria, per Rees's own split ask.
  role: string;
  rankPct: number;
  rank: number | null;
  totalTeams: number | null;
  rating: number | null;
  leagueAvg: number | null;
}

export interface InjuryNeed {
  kind: "injury";
  // Resolved from the injured player's own player_computed.role -- same
  // taxonomy as RoleRankNeed.role, so the two need kinds line up for a
  // shared "needs at this role" view even though they're detected two
  // different ways. Null only if player_computed genuinely has no role for
  // this player (shouldn't happen for a real active-roster hitter, but not
  // assumed away).
  role: string | null;
  playerId: number;
  playerName: string;
  daysLeft: number | null;
}

export type Need = RoleRankNeed | InjuryNeed;

export async function getPositionalNeeds(leagueId: number, orgId: number): Promise<Need[]> {
  const roleCards = await getMyRosterAnalysis(leagueId, orgId);

  const roleRankNeeds: RoleRankNeed[] = roleCards
    .filter((card) => card.current.rankPct !== null && card.current.rankPct <= NEEDS_RANK_PCT_MAX)
    .map((card) => ({
      kind: "role-rank",
      role: card.label,
      rankPct: card.current.rankPct as number,
      rank: card.current.rank,
      totalTeams: card.current.totalTeams,
      rating: card.current.rating,
      leagueAvg: card.current.leagueAvg,
    }));

  // Injury needs -- BOTH hitters and pitchers (2026-09-14 correction, caught
  // during this step's own verification: getOptimalLineups().injuredOut is
  // hitters-only BY DESIGN there -- pitchers never enter the Lineup page's
  // world at all -- but Rees explicitly asked Trade Finder to cover "the
  // pitching staff... including covering for longer term injuries" too. A
  // real, current case that would have been silently missed: Bill Roark,
  // partially torn labrum, 96 days left, confirmed live on StatsPlus's own
  // IL page the same session the Ramirez case was investigated. Built as its
  // own direct roster+injury scan rather than reusing injuredOut, covering
  // both ph. Same active-roster-plus-eligible-to-return definition as
  // lineup-optimizer-query.ts's rosterPlayers (organization_id+team_id+
  // level=1+positive league_id, is_active OR healed-but-still-on-IL) --
  // restated here rather than exported, matching this codebase's own
  // established "duplicate a small stable rule" convention (see HANDOFF.md).
  const refreshRunId = await latestRefreshRunId(leagueId);
  const rosterRaw = await supabase
    .from("players")
    .select("id,first_name,last_name,is_active,injury_is_injured,injury_left")
    .eq("dsa_league_id", leagueId)
    .eq("organization_id", orgId).eq("team_id", orgId).eq("level", 1)
    .gt("league_id", 0);
  if (rosterRaw.error) throw rosterRaw.error;
  const longInjured = (rosterRaw.data as { id: number; first_name: string; last_name: string; is_active: boolean | null; injury_is_injured: boolean | null; injury_left: number | null }[])
    .filter((p) => p.injury_is_injured === true && (p.injury_left ?? 0) >= INJURY_DAYS_MIN);

  let injuryNeeds: InjuryNeed[] = [];
  if (longInjured.length > 0) {
    const { data, error } = await supabase
      .from("player_computed").select("player_id,role")
      .eq("refresh_run_id", refreshRunId).in("player_id", longInjured.map((p) => p.id));
    if (error) throw error;
    const roleById = new Map((data as { player_id: number; role: string | null }[]).map((r) => [r.player_id, r.role]));
    injuryNeeds = longInjured.map((p) => ({
      kind: "injury",
      role: roleById.get(p.id) ?? null,
      playerId: p.id,
      playerName: `${p.first_name} ${p.last_name}`,
      daysLeft: p.injury_left,
    }));
  }

  return [...roleRankNeeds, ...injuryNeeds];
}
