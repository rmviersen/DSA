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
  // My Roster's own role taxonomy (ROLE_HEALTH_ROWS: SP/RP/C/1B/SS/CF/COF/
  // DH) for most rows, EXCEPT "INF" -- split into "2B"/"3B" (2026-09-14,
  // Rees's ask) using the Lineup optimizer's own exact-position eligibility
  // and scoring instead of My Roster's coarser 2B+3B+SS family bucket. See
  // getExactPositionNeeds below.
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

// Exact-position eligibility/scoring for 2B and 3B (2026-09-14, Rees's ask:
// "using the position requirements we laid out in the lineup"). Restated
// from lib/lineup-optimizer-query.ts's own module-private constants rather
// than exported/imported -- same "duplicate a small stable rule" convention
// already used repeatedly in this codebase (see HANDOFF.md); that file's own
// values are the single source of truth if these two ever need to move
// together. Deliberately only 2B/3B here, not the full 8-position sweep --
// this is specifically about un-lumping My Roster's "INF" family bucket,
// which is the ONLY role bucket combining more than one real position that
// Rees flagged; SS/C/1B/CF/DH are already single positions in ROLE_HEALTH_
// ROWS, and COF (LF+RF) wasn't part of this ask.
const EXACT_POS_ELIGIBILITY_MIN: Record<"2B" | "3B", number> = { "2B": 55, "3B": 55 };
const EXACT_POS_ARM_MIN: Partial<Record<"2B" | "3B", number>> = { "3B": 50 };
const EXACT_POS_OFFENSE_WEIGHT = 0.8;
const EXACT_POS_DEFENSE_WEIGHT = 0.2;

interface LeagueHitterRow {
  id: number;
  organization_id: number | null;
  pot_2b: number | null;
  pot_3b: number | null;
  ifa: number | null;
  batting: number | null;
  inf_rating: number | null;
  ph: "H" | "P" | null;
}

// One RoleRankNeed-shaped card per exact position, built the same way
// getMyRosterAnalysis builds "INF" -- just scoped to ONE real position
// (top-1, "one real everyday guy," matching SS/C/CF/DH's own convention)
// instead of the top-3-across-any-infield-spot family blend. Score =
// batting * 0.8 + inf_rating * 0.2 -- the SAME composite shape and weights
// as the Lineup optimizer's own scoring (battingVsHand there is hand-split;
// this uses the flat, already handedness-blended `batting` from player_
// computed instead, since a season-long "how strong is this position"
// question isn't matchup-specific the way a single lineup card is).
async function getExactPositionNeeds(leagueId: number, orgId: number): Promise<RoleRankNeed[]> {
  const refreshRunId = await latestRefreshRunId(leagueId);

  // Every org's active-MLB-roster hitters leaguewide -- same "real active
  // roster, plus healed-but-still-on-IL" definition as lineup-optimizer-
  // query.ts's rosterPlayers, just leaguewide (grouped by organization_id)
  // instead of scoped to one org.
  const { data: playersRaw, error: playersErr } = await supabase
    .from("players")
    .select("id,organization_id,team_id,is_active,is_on_dl,injury_is_injured")
    .eq("dsa_league_id", leagueId).eq("level", 1).gt("league_id", 0)
    .not("organization_id", "is", null);
  if (playersErr) throw playersErr;
  const activeRoster = (playersRaw as { id: number; organization_id: number | null; team_id: number | null; is_active: boolean | null; is_on_dl: boolean | null; injury_is_injured: boolean | null }[])
    .filter((p) => p.organization_id !== null && p.organization_id === p.team_id)
    .filter((p) => p.is_active === true || (p.is_active === false && p.is_on_dl === true && p.injury_is_injured === false));
  const ids = activeRoster.map((p) => p.id);
  const orgById = new Map(activeRoster.map((p) => [p.id, p.organization_id as number]));

  const ratingsById = new Map<number, { pot_2b: number | null; pot_3b: number | null; ifa: number | null }>();
  const computedById = new Map<number, { batting: number | null; inf_rating: number | null; ph: "H" | "P" | null }>();
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const [{ data: ratings, error: ratErr }, { data: computed, error: compErr }] = await Promise.all([
      supabase.from("player_ratings_snapshots").select("player_id,pot_2b,pot_3b,ifa").eq("refresh_run_id", refreshRunId).in("player_id", chunk),
      supabase.from("player_computed").select("player_id,batting,inf_rating,ph").eq("refresh_run_id", refreshRunId).in("player_id", chunk),
    ]);
    if (ratErr) throw ratErr;
    if (compErr) throw compErr;
    (ratings as { player_id: number; pot_2b: number | null; pot_3b: number | null; ifa: number | null }[]).forEach((r) => ratingsById.set(r.player_id, r));
    (computed as { player_id: number; batting: number | null; inf_rating: number | null; ph: "H" | "P" | null }[]).forEach((c) => computedById.set(c.player_id, c));
  }

  const rows: LeagueHitterRow[] = activeRoster.map((p) => ({
    id: p.id,
    organization_id: orgById.get(p.id) ?? null,
    pot_2b: ratingsById.get(p.id)?.pot_2b ?? null,
    pot_3b: ratingsById.get(p.id)?.pot_3b ?? null,
    ifa: ratingsById.get(p.id)?.ifa ?? null,
    batting: computedById.get(p.id)?.batting ?? null,
    inf_rating: computedById.get(p.id)?.inf_rating ?? null,
    ph: computedById.get(p.id)?.ph ?? null,
  }));

  const needs: RoleRankNeed[] = [];
  for (const pos of ["2B", "3B"] as const) {
    const potKey = pos === "2B" ? "pot_2b" : "pot_3b";
    const armMin = EXACT_POS_ARM_MIN[pos];
    const eligible = rows.filter((r) =>
      r.ph === "H" &&
      r[potKey] !== null && (r[potKey] as number) >= EXACT_POS_ELIGIBILITY_MIN[pos] &&
      (armMin === undefined || (r.ifa !== null && r.ifa >= armMin)) &&
      r.batting !== null && r.inf_rating !== null
    );
    const scoreByOrg = new Map<number, number>();
    for (const r of eligible) {
      const score = (r.batting as number) * EXACT_POS_OFFENSE_WEIGHT + (r.inf_rating as number) * EXACT_POS_DEFENSE_WEIGHT;
      const orgId2 = r.organization_id as number;
      if (score > (scoreByOrg.get(orgId2) ?? -Infinity)) scoreByOrg.set(orgId2, score);
    }
    const scores = [...scoreByOrg.values()].sort((a, b) => b - a);
    const totalTeams = scores.length;
    const ourScore = scoreByOrg.get(orgId) ?? null;
    const leagueAvg = totalTeams > 0 ? scores.reduce((a, b) => a + b, 0) / totalTeams : null;
    const rank = ourScore !== null ? scores.indexOf(ourScore) + 1 : null;
    const rankPct = rank !== null && totalTeams > 1 ? ((totalTeams - rank) / (totalTeams - 1)) * 100 : (rank !== null ? 50 : null);
    if (rankPct !== null && rankPct <= NEEDS_RANK_PCT_MAX) {
      needs.push({ kind: "role-rank", role: pos, rankPct, rank, totalTeams, rating: ourScore, leagueAvg });
    }
  }
  return needs;
}

export async function getPositionalNeeds(leagueId: number, orgId: number): Promise<Need[]> {
  const [roleCards, exactPosNeeds] = await Promise.all([
    getMyRosterAnalysis(leagueId, orgId),
    getExactPositionNeeds(leagueId, orgId),
  ]);

  // "INF" excluded here entirely -- replaced by getExactPositionNeeds' own
  // 2B/3B breakdown above, per Rees's explicit ask.
  const roleRankNeeds: RoleRankNeed[] = roleCards
    .filter((card) => card.label !== "INF" && card.current.rankPct !== null && card.current.rankPct <= NEEDS_RANK_PCT_MAX)
    .map((card) => ({
      kind: "role-rank",
      role: card.label,
      rankPct: card.current.rankPct as number,
      rank: card.current.rank,
      totalTeams: card.current.totalTeams,
      rating: card.current.rating,
      leagueAvg: card.current.leagueAvg,
    }));
  roleRankNeeds.push(...exactPosNeeds);

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
