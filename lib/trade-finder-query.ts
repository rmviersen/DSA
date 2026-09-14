import { makeSupabaseClient } from "./supabase-client";
import { latestRefreshRunId } from "./queries";
import { ROLE_HEALTH_ROWS, topNAvg } from "./org-minors-query";
import { PITCHER_ROLES } from "./contract-classification";

const supabase = makeSupabaseClient();

// Trade Finder (2026-09-14, Rees's ask): "let the analytics try and find
// those needs" -- positional/roster weaknesses detected from data already
// computed elsewhere, not manually specified. See the approved plan
// (splendid-spinning-wigderson.md) for the full design; this file is Step 1
// of that plan's sequencing (needs detection only -- candidate matching
// against the trade block and a broader leaguewide scan are separate,
// later steps).

// Bottom-third leaguewide, Rees's exact spec (2026-09-14) -- reuses the same
// rankPercentile shape as org-minors-query.ts (100 = best team, 0 = worst).
// Applied identically to the "weak/rebuilding seller team" heuristic planned
// for the later candidate-matching step.
const NEEDS_RANK_PCT_MAX = 33;

// 30+ days out, Rees's exact spec (2026-09-14) -- deliberately NOT the
// Lineup page's own 5-day threshold (isAvailableForLineup in lineup-
// optimizer-query.ts), which answers a different question ("exclude from
// THIS sim's lineup"). Used both to exclude a player from a role's rating
// pool (this file's own injury-adjustment, added same day per Rees's
// follow-up below) and, previously, to flag him standalone -- see that
// follow-up's comment for why the standalone flag was retired in favor of
// folding injuries into the rating itself.
const INJURY_DAYS_MIN = 30;

export interface RoleRankNeed {
  kind: "role-rank";
  // My Roster's own role taxonomy (ROLE_HEALTH_ROWS: SP/RP/C/1B/SS/CF/COF/
  // DH) for most rows, EXCEPT "INF" -- split into "2B"/"3B" (2026-09-14,
  // Rees's ask) using the Lineup optimizer's own exact-position eligibility
  // and scoring instead of My Roster's coarser 2B+3B+SS family bucket.
  role: string;
  // Injury-adjusted (2026-09-14, Rees's follow-up: "evaluate positional
  // strength factoring injuries where appropriate... a single injury does
  // not mean we need a replacement, but if that injury impacts our rating
  // strongly enough to be in the bottom third... we should look to
  // replace"). Computed with any 30+-day-injured player excluded from the
  // topN pool, for EVERY org (not just ours) -- an apples-to-apples
  // comparison, not just us being penalized while everyone else's injuries
  // go uncounted.
  rankPct: number;
  rank: number | null;
  totalTeams: number | null;
  rating: number | null;
  leagueAvg: number | null;
  // Transparency: what this same role's rank looked like WITHOUT excluding
  // any injured player (the site's usual "injury doesn't change a player's
  // talent grade" convention, e.g. My Roster/org-minors) -- lets a need be
  // labeled "this is only a need because of the injury below" (unadjusted
  // was fine, adjusted isn't) vs. "this role was already weak regardless"
  // (both sides agree). Null only if the unadjusted computation genuinely
  // had no one to rank (shouldn't happen if the adjusted side did).
  unadjustedRankPct: number | null;
  // Which of OUR players got excluded from the pool to produce the
  // adjusted numbers above -- empty if this role's own rating wasn't
  // affected by any of our injuries at all.
  excludedInjuredPlayers: { playerId: number; name: string; daysLeft: number | null }[];
}

export type Need = RoleRankNeed;

interface LeaguePlayerRow {
  id: number;
  name: string;
  organization_id: number;
  role: string | null;
  ph: "H" | "P" | null;
  overall: number | null;
  batting: number | null;
  pot_2b: number | null;
  pot_3b: number | null;
  ifa: number | null;
  inf_rating: number | null;
  isLongInjured: boolean;
  daysLeft: number | null;
}

// Every org's active-MLB roster leaguewide, with everything both the
// ROLE_HEALTH_ROWS sweep and the exact-2B/3B sweep need in one pass (one
// round trip instead of two near-identical ones). Same "real active roster,
// plus healed-but-still-on-IL" definition as lineup-optimizer-query.ts's
// rosterPlayers (organization_id+team_id+level=1+positive league_id,
// is_active OR is_on_dl-and-healed) -- restated here rather than exported,
// matching this codebase's established "duplicate a small stable rule"
// convention (see HANDOFF.md).
async function fetchLeagueRoster(leagueId: number): Promise<LeaguePlayerRow[]> {
  const refreshRunId = await latestRefreshRunId(leagueId);

  const { data: playersRaw, error: playersErr } = await supabase
    .from("players")
    .select("id,first_name,last_name,organization_id,team_id,is_active,is_on_dl,injury_is_injured,injury_left")
    .eq("dsa_league_id", leagueId).eq("level", 1).gt("league_id", 0)
    .not("organization_id", "is", null);
  if (playersErr) throw playersErr;
  const activeRoster = (playersRaw as {
    id: number; first_name: string; last_name: string; organization_id: number | null; team_id: number | null;
    is_active: boolean | null; is_on_dl: boolean | null; injury_is_injured: boolean | null; injury_left: number | null;
  }[])
    .filter((p) => p.organization_id !== null && p.organization_id === p.team_id)
    .filter((p) => p.is_active === true || (p.is_active === false && p.is_on_dl === true && p.injury_is_injured === false));

  const ids = activeRoster.map((p) => p.id);
  const ratingsById = new Map<number, { pot_2b: number | null; pot_3b: number | null; ifa: number | null }>();
  const computedById = new Map<number, { role: string | null; overall: number | null; batting: number | null; inf_rating: number | null; ph: "H" | "P" | null }>();
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const [{ data: ratings, error: ratErr }, { data: computed, error: compErr }] = await Promise.all([
      supabase.from("player_ratings_snapshots").select("player_id,pot_2b,pot_3b,ifa").eq("refresh_run_id", refreshRunId).in("player_id", chunk),
      supabase.from("player_computed").select("player_id,role,overall,batting,inf_rating,ph").eq("refresh_run_id", refreshRunId).in("player_id", chunk),
    ]);
    if (ratErr) throw ratErr;
    if (compErr) throw compErr;
    (ratings as { player_id: number; pot_2b: number | null; pot_3b: number | null; ifa: number | null }[]).forEach((r) => ratingsById.set(r.player_id, r));
    (computed as { player_id: number; role: string | null; overall: number | null; batting: number | null; inf_rating: number | null; ph: "H" | "P" | null }[]).forEach((c) => computedById.set(c.player_id, c));
  }

  return activeRoster.map((p) => {
    const r = ratingsById.get(p.id);
    const c = computedById.get(p.id);
    return {
      id: p.id,
      name: `${p.first_name} ${p.last_name}`,
      organization_id: p.organization_id as number,
      role: c?.role ?? null,
      ph: c?.ph ?? null,
      overall: c?.overall ?? null,
      batting: c?.batting ?? null,
      pot_2b: r?.pot_2b ?? null,
      pot_3b: r?.pot_3b ?? null,
      ifa: r?.ifa ?? null,
      inf_rating: c?.inf_rating ?? null,
      isLongInjured: p.injury_is_injured === true && (p.injury_left ?? 0) >= INJURY_DAYS_MIN,
      daysLeft: p.injury_left,
    };
  });
}

// Same 2B/3B eligibility/scoring as before -- "using the position
// requirements we laid out in the lineup" (2026-09-14). Restated from
// lib/lineup-optimizer-query.ts's own module-private constants; that file's
// own values are the source of truth if these two ever need to move
// together.
const EXACT_POS_ELIGIBILITY_MIN: Record<"2B" | "3B", number> = { "2B": 55, "3B": 55 };
const EXACT_POS_ARM_MIN: Partial<Record<"2B" | "3B", number>> = { "3B": 50 };
const EXACT_POS_OFFENSE_WEIGHT = 0.8;
const EXACT_POS_DEFENSE_WEIGHT = 0.2;

function bestExactPositionScore(rows: LeaguePlayerRow[], orgId: number, pos: "2B" | "3B", excludeInjured: boolean): { score: number; playerId: number; name: string } | null {
  const potKey = pos === "2B" ? "pot_2b" : "pot_3b";
  const armMin = EXACT_POS_ARM_MIN[pos];
  let best: { score: number; playerId: number; name: string } | null = null;
  for (const r of rows) {
    if (r.organization_id !== orgId || r.ph !== "H") continue;
    if (excludeInjured && r.isLongInjured) continue;
    const potVal = r[potKey];
    if (potVal === null || potVal < EXACT_POS_ELIGIBILITY_MIN[pos]) continue;
    if (armMin !== undefined && (r.ifa === null || r.ifa < armMin)) continue;
    if (r.batting === null || r.inf_rating === null) continue;
    const score = r.batting * EXACT_POS_OFFENSE_WEIGHT + r.inf_rating * EXACT_POS_DEFENSE_WEIGHT;
    if (!best || score > best.score) best = { score, playerId: r.id, name: r.name };
  }
  return best;
}

function getExactPositionNeeds(rows: LeaguePlayerRow[], orgId: number): RoleRankNeed[] {
  const orgIds = [...new Set(rows.map((r) => r.organization_id))];
  const needs: RoleRankNeed[] = [];
  for (const pos of ["2B", "3B"] as const) {
    const adjustedByOrg = new Map(orgIds.map((oid) => [oid, bestExactPositionScore(rows, oid, pos, true)]));
    const adjustedScores = [...adjustedByOrg.values()].filter((v): v is NonNullable<typeof v> => v !== null).map((v) => v.score).sort((a, b) => b - a);
    const ourAdjusted = adjustedByOrg.get(orgId) ?? null;
    const totalTeams = adjustedScores.length;
    const leagueAvg = totalTeams > 0 ? adjustedScores.reduce((a, b) => a + b, 0) / totalTeams : null;
    const rank = ourAdjusted !== null ? adjustedScores.indexOf(ourAdjusted.score) + 1 : null;
    const rankPct = rank !== null && totalTeams > 1 ? ((totalTeams - rank) / (totalTeams - 1)) * 100 : (rank !== null ? 50 : null);
    if (rankPct === null || rankPct > NEEDS_RANK_PCT_MAX) continue;

    // Unadjusted side, for transparency, and to find which of our players
    // (if any) the exclusion actually removed.
    const unadjustedByOrg = new Map(orgIds.map((oid) => [oid, bestExactPositionScore(rows, oid, pos, false)]));
    const unadjustedScores = [...unadjustedByOrg.values()].filter((v): v is NonNullable<typeof v> => v !== null).map((v) => v.score).sort((a, b) => b - a);
    const ourUnadjusted = unadjustedByOrg.get(orgId) ?? null;
    const unadjustedTotal = unadjustedScores.length;
    const unadjustedRank = ourUnadjusted !== null ? unadjustedScores.indexOf(ourUnadjusted.score) + 1 : null;
    const unadjustedRankPct = unadjustedRank !== null && unadjustedTotal > 1 ? ((unadjustedTotal - unadjustedRank) / (unadjustedTotal - 1)) * 100 : (unadjustedRank !== null ? 50 : null);

    const excluded = ourUnadjusted !== null && ourAdjusted !== null && ourUnadjusted.playerId !== ourAdjusted.playerId
      ? rows.find((r) => r.id === ourUnadjusted.playerId)
      : (ourUnadjusted !== null && ourAdjusted === null ? rows.find((r) => r.id === ourUnadjusted.playerId) : undefined);

    needs.push({
      kind: "role-rank", role: pos, rankPct, rank, totalTeams,
      rating: ourAdjusted?.score ?? null, leagueAvg, unadjustedRankPct,
      excludedInjuredPlayers: excluded ? [{ playerId: excluded.id, name: excluded.name, daysLeft: excluded.daysLeft }] : [],
    });
  }
  return needs;
}

// SP/RP/C/1B/SS/CF/COF/DH -- ROLE_HEALTH_ROWS minus "INF" (replaced by the
// exact-position sweep above), "P Tot"/"H Tot" (aggregates, not real
// positions).
const SINGLE_POSITION_ROWS = ROLE_HEALTH_ROWS.filter((r) => r.label !== "INF" && r.label !== "P Tot" && r.label !== "H Tot");
const SP_TOP_N = ROLE_HEALTH_ROWS.find((r) => r.label === "SP")!.topN;

// Same RP-borrows-SP-overflow rule as my-roster-query.ts's pickRoleDepth
// (CURRENT side, allowRpOverflow: true) -- a team's SP depth beyond its own
// top-5 rotation is real bullpen-quality pitching, credited to RP too.
// Restated here (values only, not full candidate identity) since this file
// needs org-grouped, injury-excludable arrays, not pickRoleDepth's
// display-oriented shape.
function roleValuesForOrg(rows: LeaguePlayerRow[], orgId: number, rowLabel: string, rowRoles: string[], excludeInjured: boolean): { value: number; playerId: number; name: string; daysLeft: number | null }[] {
  const isPitcherRow = PITCHER_ROLES.has(rowRoles[0]);
  const metricOf = (r: LeaguePlayerRow) => (isPitcherRow || rowLabel === "P Tot" ? r.overall : r.batting);
  const pool = rows.filter((r) => r.organization_id === orgId && (!excludeInjured || !r.isLongInjured));
  if (rowLabel !== "RP") {
    return pool
      .filter((r) => r.role !== null && rowRoles.includes(r.role) && metricOf(r) !== null)
      .map((r) => ({ value: metricOf(r) as number, playerId: r.id, name: r.name, daysLeft: r.daysLeft }));
  }
  const sp = pool
    .filter((r) => r.role === "SP" && r.overall !== null)
    .map((r) => ({ value: r.overall as number, playerId: r.id, name: r.name, daysLeft: r.daysLeft }))
    .sort((a, b) => b.value - a.value);
  const spSurplus = sp.slice(SP_TOP_N);
  const rp = pool
    .filter((r) => r.role === "RP" && r.overall !== null)
    .map((r) => ({ value: r.overall as number, playerId: r.id, name: r.name, daysLeft: r.daysLeft }));
  return [...spSurplus, ...rp];
}

function getRoleHealthNeeds(rows: LeaguePlayerRow[], orgId: number): RoleRankNeed[] {
  const orgIds = [...new Set(rows.map((r) => r.organization_id))];
  const needs: RoleRankNeed[] = [];

  for (const row of SINGLE_POSITION_ROWS) {
    const adjustedByOrg = new Map(
      orgIds.map((oid) => [oid, topNAvg(roleValuesForOrg(rows, oid, row.label, row.roles, true).map((v) => v.value), row.topN)])
    );
    const adjustedScores = [...adjustedByOrg.values()].filter((v): v is number => v !== null).sort((a, b) => b - a);
    const ourAdjusted = adjustedByOrg.get(orgId) ?? null;
    const totalTeams = adjustedScores.length;
    const leagueAvg = totalTeams > 0 ? adjustedScores.reduce((a, b) => a + b, 0) / totalTeams : null;
    const rank = ourAdjusted !== null ? adjustedScores.indexOf(ourAdjusted) + 1 : null;
    const rankPct = rank !== null && totalTeams > 1 ? ((totalTeams - rank) / (totalTeams - 1)) * 100 : (rank !== null ? 50 : null);
    if (rankPct === null || rankPct > NEEDS_RANK_PCT_MAX) continue;

    const unadjustedByOrg = new Map(
      orgIds.map((oid) => [oid, topNAvg(roleValuesForOrg(rows, oid, row.label, row.roles, false).map((v) => v.value), row.topN)])
    );
    const unadjustedScores = [...unadjustedByOrg.values()].filter((v): v is number => v !== null).sort((a, b) => b - a);
    const ourUnadjusted = unadjustedByOrg.get(orgId) ?? null;
    const unadjustedTotal = unadjustedScores.length;
    const unadjustedRank = ourUnadjusted !== null ? unadjustedScores.indexOf(ourUnadjusted) + 1 : null;
    const unadjustedRankPct = unadjustedRank !== null && unadjustedTotal > 1 ? ((unadjustedTotal - unadjustedRank) / (unadjustedTotal - 1)) * 100 : (unadjustedRank !== null ? 50 : null);

    // Which of our OWN long-injured players actually fed this role's pool
    // (whether or not excluding them changed whether we clear the topN --
    // e.g. a deep role might absorb the loss with its own overflow; still
    // worth showing which real injuries are involved).
    const ourLongInjuredHere = roleValuesForOrg(rows, orgId, row.label, row.roles, false)
      .filter((v) => rows.find((r) => r.id === v.playerId)?.isLongInjured === true)
      .map((v) => ({ playerId: v.playerId, name: v.name, daysLeft: v.daysLeft }));

    needs.push({
      kind: "role-rank", role: row.label, rankPct, rank, totalTeams,
      rating: ourAdjusted, leagueAvg, unadjustedRankPct,
      excludedInjuredPlayers: ourLongInjuredHere,
    });
  }
  return needs;
}

export async function getPositionalNeeds(leagueId: number, orgId: number): Promise<Need[]> {
  const rows = await fetchLeagueRoster(leagueId);
  return [...getRoleHealthNeeds(rows, orgId), ...getExactPositionNeeds(rows, orgId)];
}
