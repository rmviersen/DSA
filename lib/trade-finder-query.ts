import { makeSupabaseClient } from "./supabase-client";
import { latestRefreshRunId } from "./queries";
import { ROLE_HEALTH_ROWS, topNAvg } from "./org-minors-query";
import { PITCHER_ROLES, computeAAV, type ContractSalaryFields } from "./contract-classification";
import { FIELD_POSITIONS, type FieldPosition } from "./lineup-optimizer-query";
import { yearsOfControl } from "./trade-value";

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
  pot_c: number | null; pot_1b: number | null; pot_2b: number | null; pot_3b: number | null;
  pot_ss: number | null; pot_lf: number | null; pot_cf: number | null; pot_rf: number | null;
  ifa: number | null; ifr: number | null;
  c_rating: number | null; inf_rating: number | null; of_rating: number | null;
  isLongInjured: boolean;
  daysLeft: number | null;
}

type RatingsFields = { pot_c: number | null; pot_1b: number | null; pot_2b: number | null; pot_3b: number | null; pot_ss: number | null; pot_lf: number | null; pot_cf: number | null; pot_rf: number | null; ifa: number | null; ifr: number | null };
type ComputedFields = { role: string | null; overall: number | null; batting: number | null; c_rating: number | null; inf_rating: number | null; of_rating: number | null; ph: "H" | "P" | null };
interface BasePlayer {
  id: number; name: string; organization_id: number;
  injury_is_injured: boolean | null; injury_left: number | null;
}

// Shared ratings+computed enrichment (2026-09-14, Step 2) -- factored out of
// fetchLeagueRoster so the trade-block fetch below can build the exact same
// LeaguePlayerRow shape for a specific id LIST (not "one org's active
// roster") without re-deriving the field set a second time.
async function enrichPlayers(leagueId: number, base: BasePlayer[]): Promise<LeaguePlayerRow[]> {
  const refreshRunId = await latestRefreshRunId(leagueId);
  const ids = base.map((p) => p.id);
  const ratingsById = new Map<number, RatingsFields>();
  const computedById = new Map<number, ComputedFields>();
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const [{ data: ratings, error: ratErr }, { data: computed, error: compErr }] = await Promise.all([
      supabase.from("player_ratings_snapshots").select("player_id,pot_c,pot_1b,pot_2b,pot_3b,pot_ss,pot_lf,pot_cf,pot_rf,ifa,ifr").eq("refresh_run_id", refreshRunId).in("player_id", chunk),
      supabase.from("player_computed").select("player_id,role,overall,batting,c_rating,inf_rating,of_rating,ph").eq("refresh_run_id", refreshRunId).in("player_id", chunk),
    ]);
    if (ratErr) throw ratErr;
    if (compErr) throw compErr;
    (ratings as ({ player_id: number } & RatingsFields)[]).forEach((r) => ratingsById.set(r.player_id, r));
    (computed as ({ player_id: number } & ComputedFields)[]).forEach((c) => computedById.set(c.player_id, c));
  }

  return base.map((p) => {
    const r = ratingsById.get(p.id);
    const c = computedById.get(p.id);
    return {
      id: p.id,
      name: p.name,
      organization_id: p.organization_id,
      role: c?.role ?? null,
      ph: c?.ph ?? null,
      overall: c?.overall ?? null,
      batting: c?.batting ?? null,
      pot_c: r?.pot_c ?? null, pot_1b: r?.pot_1b ?? null, pot_2b: r?.pot_2b ?? null, pot_3b: r?.pot_3b ?? null,
      pot_ss: r?.pot_ss ?? null, pot_lf: r?.pot_lf ?? null, pot_cf: r?.pot_cf ?? null, pot_rf: r?.pot_rf ?? null,
      ifa: r?.ifa ?? null, ifr: r?.ifr ?? null,
      c_rating: c?.c_rating ?? null, inf_rating: c?.inf_rating ?? null, of_rating: c?.of_rating ?? null,
      isLongInjured: p.injury_is_injured === true && (p.injury_left ?? 0) >= INJURY_DAYS_MIN,
      daysLeft: p.injury_left,
    };
  });
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

  return enrichPlayers(leagueId, activeRoster.map((p) => ({
    id: p.id, name: `${p.first_name} ${p.last_name}`, organization_id: p.organization_id as number,
    injury_is_injured: p.injury_is_injured, injury_left: p.injury_left,
  })));
}

// Exact-position eligibility/scoring, ALL 8 field positions (2026-09-14 for
// 2B/3B, generalized same day for Step 2's candidate matching -- "using the
// position requirements we laid out in the lineup"). Restated from lib/
// lineup-optimizer-query.ts's own module-private constants (ELIGIBILITY_MIN,
// POSITION_ARM_MIN, POSITION_RANGE_MIN, POS_FAMILY_RATING, OFFENSE_WEIGHT/
// DEFENSE_WEIGHT); that file's own values are the source of truth if these
// ever need to move together.
const FIELD_POS_KEY: Record<FieldPosition, keyof LeaguePlayerRow> = {
  C: "pot_c", "1B": "pot_1b", "2B": "pot_2b", "3B": "pot_3b",
  SS: "pot_ss", LF: "pot_lf", CF: "pot_cf", RF: "pot_rf",
};
const FIELD_POS_FAMILY_RATING: Record<FieldPosition, "c_rating" | "inf_rating" | "of_rating"> = {
  C: "c_rating", "1B": "inf_rating", "2B": "inf_rating", "3B": "inf_rating", SS: "inf_rating",
  LF: "of_rating", CF: "of_rating", RF: "of_rating",
};
const EXACT_POS_ELIGIBILITY_MIN: Record<FieldPosition, number> = {
  C: 50, "1B": 55, "2B": 55, "3B": 55, SS: 55, LF: 55, CF: 55, RF: 55,
};
const EXACT_POS_ARM_MIN: Partial<Record<FieldPosition, number>> = { SS: 50, "3B": 50 };
const EXACT_POS_RANGE_MIN: Partial<Record<FieldPosition, number>> = { SS: 65 };
const EXACT_POS_OFFENSE_WEIGHT = 0.8;
const EXACT_POS_DEFENSE_WEIGHT = 0.2;

function bestExactPositionScore(rows: LeaguePlayerRow[], orgId: number, pos: FieldPosition, excludeInjured: boolean): { score: number; playerId: number; name: string } | null {
  const potKey = FIELD_POS_KEY[pos];
  const familyKey = FIELD_POS_FAMILY_RATING[pos];
  const armMin = EXACT_POS_ARM_MIN[pos];
  const rangeMin = EXACT_POS_RANGE_MIN[pos];
  let best: { score: number; playerId: number; name: string } | null = null;
  for (const r of rows) {
    if (r.organization_id !== orgId || r.ph !== "H") continue;
    if (excludeInjured && r.isLongInjured) continue;
    const potVal = r[potKey] as number | null;
    if (potVal === null || potVal < EXACT_POS_ELIGIBILITY_MIN[pos]) continue;
    if (armMin !== undefined && (r.ifa === null || r.ifa < armMin)) continue;
    if (rangeMin !== undefined && (r.ifr === null || r.ifr < rangeMin)) continue;
    const familyVal = r[familyKey];
    if (r.batting === null || familyVal === null) continue;
    const score = r.batting * EXACT_POS_OFFENSE_WEIGHT + familyVal * EXACT_POS_DEFENSE_WEIGHT;
    if (!best || score > best.score) best = { score, playerId: r.id, name: r.name };
  }
  return best;
}

function getExactPositionNeeds(rows: LeaguePlayerRow[], orgId: number): RoleRankNeed[] {
  const orgIds = [...new Set(rows.map((r) => r.organization_id))];
  const needs: RoleRankNeed[] = [];
  // Needs detection only replaces "INF" (2B/3B) -- C/1B/SS/LF/CF/RF stay on
  // ROLE_HEALTH_ROWS's own already-calibrated Batting-only convention above
  // (getRoleHealthNeeds), unchanged. bestExactPositionScore itself is now
  // general across all 8 positions because Step 2's candidate matching
  // below needs that generality; needs detection just doesn't call it for
  // anything but 2B/3B.
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

// --- Step 2 (2026-09-14): trade-block matching ---------------------------
// "The trade block should highlight listed players that will improve our
// lineup and pitching staff." A candidate qualifies for a need if he clears
// that position/role's real eligibility (same gates as above) AND his score
// beats what we can ACTUALLY field today (injury-adjusted, matching how the
// need itself was computed) -- not beats the league-average bar, and not
// beats a healthy player who's currently hurt.

const smallestOf = (values: number[], n: number): number => {
  const top = [...values].sort((a, b) => b - a).slice(0, n);
  return top.length < n ? -Infinity : top[top.length - 1];
};

// What we can currently field at this need's role/position, injury-adjusted
// -- the real bar a trade-block candidate has to clear. Pitcher roles use
// the topN FLOOR (the worst player still inside the counted group), not the
// average -- beating the floor is exactly what raises the average; DH has
// no eligibility gate (every hitter qualifies) so it's a plain top-1 batting
// comparison; every other role is a real field position, using the same
// composite bestExactPositionScore already computes for needs detection.
function currentFloorForNeed(rows: LeaguePlayerRow[], orgId: number, need: RoleRankNeed): number {
  // Pitcher roles (SP/RP) first -- topN FLOOR via ROLE_HEALTH_ROWS, same as
  // needs detection. Checked before the FieldPosition branch below since
  // "SP"/"RP" are never real field positions.
  if (need.role === "SP" || need.role === "RP") {
    const row = SINGLE_POSITION_ROWS.find((r) => r.label === need.role)!;
    const values = roleValuesForOrg(rows, orgId, row.label, row.roles, true).map((v) => v.value);
    return smallestOf(values, row.topN);
  }
  if (need.role === "DH") {
    const values = rows.filter((r) => r.organization_id === orgId && r.ph === "H" && !r.isLongInjured && r.batting !== null).map((r) => r.batting as number);
    return smallestOf(values, 1);
  }
  // Every other role IS a real field position (C/1B/2B/3B/SS/LF/CF/RF) --
  // MUST use the same composite bestExactPositionScore candidateScoreForNeed
  // judges candidates by (batting * 0.8 + family fielding * 0.2, real
  // eligibility gates), not ROLE_HEALTH_ROWS' own Batting-only/role-
  // classification convention (checked first in an earlier draft of this
  // function, caught before shipping: that would have compared a candidate's
  // LINEUP-STYLE composite score against an apples-to-oranges Batting-only
  // floor for C/1B/SS/CF specifically, silently understating or overstating
  // the real upgrade bar for every one of those positions).
  return bestExactPositionScore(rows, orgId, need.role as FieldPosition, true)?.score ?? -Infinity;
}

// A trade-block candidate's own score for a specific need -- null if he
// doesn't even clear that position/role's eligibility at all (e.g. a
// corner-outfield bat with no real infield profile evaluated against a 3B
// need). Pitchers are matched on their OWN assigned role label (an SP
// candidate is only evaluated against an SP need, not RP's overflow rule --
// that rule is about OUR OWN roster's counted depth, not a acquisition
// target's fit).
function candidateScoreForNeed(c: LeaguePlayerRow, need: RoleRankNeed): number | null {
  if (need.role === "SP" || need.role === "RP") {
    if (c.ph !== "P" || c.role !== need.role || c.overall === null) return null;
    return c.overall;
  }
  if (need.role === "DH") {
    return c.ph === "H" && c.batting !== null ? c.batting : null;
  }
  if ((FIELD_POSITIONS as readonly string[]).includes(need.role)) {
    const pos = need.role as FieldPosition;
    if (c.ph !== "H") return null;
    const potVal = c[FIELD_POS_KEY[pos]] as number | null;
    if (potVal === null || potVal < EXACT_POS_ELIGIBILITY_MIN[pos]) return null;
    const armMin = EXACT_POS_ARM_MIN[pos];
    if (armMin !== undefined && (c.ifa === null || c.ifa < armMin)) return null;
    const rangeMin = EXACT_POS_RANGE_MIN[pos];
    if (rangeMin !== undefined && (c.ifr === null || c.ifr < rangeMin)) return null;
    const familyVal = c[FIELD_POS_FAMILY_RATING[pos]];
    if (c.batting === null || familyVal === null) return null;
    return c.batting * EXACT_POS_OFFENSE_WEIGHT + familyVal * EXACT_POS_DEFENSE_WEIGHT;
  }
  return null;
}

export interface TradeBlockCandidate {
  playerId: number;
  name: string;
  teamName: string | null;
  score: number;
  currentFloor: number;
  upgradeSize: number;
  yearsOfControl: number | null;
  contractAav: number | null;
  note: string;
}

export interface NeedWithTradeBlockCandidates {
  need: RoleRankNeed;
  candidates: TradeBlockCandidate[]; // sorted biggest upgrade first
}

// Latest trade-block scrape (scripts/scrape-trade-block.ts), enriched with
// the same LeaguePlayerRow shape as the roster fetch, plus team name and
// real remaining control. All rows from one scrape share the exact same
// `captured_at` timestamp (scrape-trade-block.ts stamps every row with one
// `capturedAt` const per run), so filtering on the single latest value is
// safe and exact -- no fuzzy "most recent N minutes" needed.
async function fetchTradeBlockRows(leagueId: number): Promise<{ row: LeaguePlayerRow; teamName: string | null; yearsOfControl: number | null; contractAav: number | null; note: string }[]> {
  const { data: latestCapRow, error: capErr } = await supabase
    .from("trade_block_snapshots").select("captured_at").eq("dsa_league_id", leagueId).order("captured_at", { ascending: false }).limit(1).maybeSingle();
  if (capErr) throw capErr;
  const latestCap = (latestCapRow as { captured_at: string } | null)?.captured_at;
  if (!latestCap) return [];

  const { data: blockRaw, error: blockErr } = await supabase
    .from("trade_block_snapshots").select("player_id,note").eq("dsa_league_id", leagueId).eq("captured_at", latestCap);
  if (blockErr) throw blockErr;
  const noteByPlayer = new Map((blockRaw as { player_id: number; note: string }[]).map((r) => [r.player_id, r.note]));
  const ids = [...noteByPlayer.keys()];
  if (ids.length === 0) return [];

  const { data: playersRaw, error: playersErr } = await supabase
    .from("players")
    .select("id,first_name,last_name,organization_id,team_id,injury_is_injured,injury_left,mlb_service_years")
    .eq("dsa_league_id", leagueId).in("id", ids);
  if (playersErr) throw playersErr;
  const players = playersRaw as { id: number; first_name: string; last_name: string; organization_id: number | null; team_id: number | null; injury_is_injured: boolean | null; injury_left: number | null; mlb_service_years: number | null }[];

  const teamIds = [...new Set(players.map((p) => p.team_id).filter((t): t is number => t !== null))];
  const { data: teamsRaw, error: teamsErr } = await supabase.from("teams").select("id,name").eq("dsa_league_id", leagueId).in("id", teamIds);
  if (teamsErr) throw teamsErr;
  const teamNameById = new Map((teamsRaw as { id: number; name: string }[]).map((t) => [t.id, t.name]));

  // Full salary schedule (not just years/current_year) so computeAAV can
  // give a real average-annual-value, not just a control-years count --
  // Rees's follow-up ask: "and contract information" alongside the note.
  const salaryCols = "player_id,years,current_year,salary0,salary1,salary2,salary3,salary4,salary5,salary6,salary7,salary8,salary9,salary10,salary11,salary12,salary13,salary14";
  const { data: contractsRaw, error: contractsErr } = await supabase
    .from("contracts").select(salaryCols).eq("dsa_league_id", leagueId).in("player_id", ids);
  if (contractsErr) throw contractsErr;
  type ContractRow = { player_id: number } & ContractSalaryFields & { current_year: number | null };
  const contractById = new Map((contractsRaw as never as ContractRow[]).map((c) => [c.player_id, c]));

  const enriched = await enrichPlayers(leagueId, players.map((p) => ({
    id: p.id, name: `${p.first_name} ${p.last_name}`, organization_id: p.organization_id ?? -1,
    injury_is_injured: p.injury_is_injured, injury_left: p.injury_left,
  })));
  const enrichedById = new Map(enriched.map((r) => [r.id, r]));

  return players.map((p) => {
    const contract = contractById.get(p.id) ?? null;
    return {
      row: enrichedById.get(p.id)!,
      teamName: p.team_id !== null ? (teamNameById.get(p.team_id) ?? null) : null,
      yearsOfControl: yearsOfControl({
        contractYears: contract?.years ?? null, contractCurrentYear: contract?.current_year ?? null, mlbServiceYears: p.mlb_service_years,
      }),
      contractAav: contract ? computeAAV(contract) : null,
      note: noteByPlayer.get(p.id) ?? "",
    };
  });
}

export async function getTradeBlockMatches(leagueId: number, orgId: number, needs: RoleRankNeed[]): Promise<NeedWithTradeBlockCandidates[]> {
  const [rows, block] = await Promise.all([fetchLeagueRoster(leagueId), fetchTradeBlockRows(leagueId)]);

  return needs.map((need) => {
    const floor = currentFloorForNeed(rows, orgId, need);
    const candidates: TradeBlockCandidate[] = block
      .filter((b) => b.row.organization_id !== orgId) // not already ours
      .map((b) => {
        const score = candidateScoreForNeed(b.row, need);
        if (score === null || score <= floor) return null;
        return {
          playerId: b.row.id, name: b.row.name, teamName: b.teamName,
          score, currentFloor: floor, upgradeSize: score - floor,
          yearsOfControl: b.yearsOfControl, contractAav: b.contractAav, note: b.note,
        };
      })
      .filter((c): c is TradeBlockCandidate => c !== null)
      .sort((a, b) => b.upgradeSize - a.upgradeSize);
    return { need, candidates };
  });
}

// --- Step 3 (2026-09-14): broader leaguewide "plausibly available" scan ---
// "I want to include broader leaguewide targets, but will need to work on
// logic for which players may be available like guys with one or two years
// left on their contract, or players on weak, rebuilding teams." Two real,
// existing-data-only signals -- no new ingestion, no invented metric:
//
// 1. Short remaining control (yearsOfControl <= 2, Rees's own "one or two
//    years" wording) -- reuses trade-value.ts's yearsOfControl(), already
//    the site's one real "how much control is left" answer.
// 2. A "weak/rebuilding" seller team -- team_computed.roster_rank (ranks
//    every team by team_ovr, its current MLB roster talent) in the bottom
//    third leaguewide, the SAME bottom-third bar as every other need in
//    this file. team_computed.w_rank/team_rank/power_ranking are confirmed
//    entirely unpopulated (no script writes them -- real win/loss standings
//    aren't in this pipeline at all), so roster_rank is the real, available
//    proxy, not a literal read of a team's record.
//
// A candidate qualifies if EITHER signal holds (not both) -- Rees listed
// them as two separate, independent reasons a player might be gettable, not
// a joint requirement. Anyone already surfaced via the trade block (Step 2)
// is excluded here, so a listed player isn't shown twice under two
// different framings.
const BROADER_SCAN_MAX_CONTROL_YEARS = 2;

// team_computed's own latest refresh_run_id -- NOT assumed to match player_
// computed's (compute-team-ratings.ts runs as its own step, same "can lag
// one run behind" pattern already documented for fielding_role_weights
// elsewhere in this codebase).
async function fetchSellerOrgIds(leagueId: number): Promise<Set<number>> {
  const { data: latestRow, error: latestErr } = await supabase
    .from("team_computed").select("refresh_run_id").eq("dsa_league_id", leagueId).order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  if (latestErr) throw latestErr;
  const refreshRunId = (latestRow as { refresh_run_id: number } | null)?.refresh_run_id;
  if (refreshRunId === undefined) return new Set();

  const { data, error } = await supabase
    .from("team_computed").select("team_id,roster_rank").eq("dsa_league_id", leagueId).eq("refresh_run_id", refreshRunId).not("roster_rank", "is", null);
  if (error) throw error;
  const rows = data as { team_id: number; roster_rank: number }[];
  const totalTeams = rows.length;
  const sellers = new Set<number>();
  for (const r of rows) {
    const rankPct = totalTeams > 1 ? ((totalTeams - r.roster_rank) / (totalTeams - 1)) * 100 : 50;
    if (rankPct <= NEEDS_RANK_PCT_MAX) sellers.add(r.team_id);
  }
  return sellers;
}

async function fetchControlYearsById(leagueId: number, ids: number[]): Promise<Map<number, { controlYears: number | null; contractAav: number | null }>> {
  const result = new Map<number, { controlYears: number | null; contractAav: number | null }>();
  const salaryCols = "player_id,years,current_year,salary0,salary1,salary2,salary3,salary4,salary5,salary6,salary7,salary8,salary9,salary10,salary11,salary12,salary13,salary14";
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const [{ data: contracts, error: contractErr }, { data: service, error: serviceErr }] = await Promise.all([
      supabase.from("contracts").select(salaryCols).eq("dsa_league_id", leagueId).in("player_id", chunk),
      supabase.from("players").select("id,mlb_service_years").eq("dsa_league_id", leagueId).in("id", chunk),
    ]);
    if (contractErr) throw contractErr;
    if (serviceErr) throw serviceErr;
    type ContractRow = { player_id: number } & ContractSalaryFields & { current_year: number | null };
    const contractById = new Map((contracts as never as ContractRow[]).map((c) => [c.player_id, c]));
    const serviceById = new Map((service as { id: number; mlb_service_years: number | null }[]).map((s) => [s.id, s.mlb_service_years]));
    for (const id of chunk) {
      const contract = contractById.get(id) ?? null;
      result.set(id, {
        controlYears: yearsOfControl({
          contractYears: contract?.years ?? null, contractCurrentYear: contract?.current_year ?? null, mlbServiceYears: serviceById.get(id) ?? null,
        }),
        contractAav: contract ? computeAAV(contract) : null,
      });
    }
  }
  return result;
}

export interface BroaderCandidate {
  playerId: number;
  name: string;
  teamName: string | null;
  score: number;
  currentFloor: number;
  upgradeSize: number;
  yearsOfControl: number | null;
  contractAav: number | null;
  availabilitySignal: "short-control" | "weak-team" | "both";
}

export interface NeedWithBroaderCandidates {
  need: RoleRankNeed;
  candidates: BroaderCandidate[]; // sorted biggest upgrade first
}

export async function getBroaderTargets(leagueId: number, orgId: number, needs: RoleRankNeed[]): Promise<NeedWithBroaderCandidates[]> {
  const [rows, sellerOrgIds, block] = await Promise.all([
    fetchLeagueRoster(leagueId),
    fetchSellerOrgIds(leagueId),
    fetchTradeBlockRows(leagueId),
  ]);
  const onBlockIds = new Set(block.map((b) => b.row.id));
  const candidateRows = rows.filter((r) => r.organization_id !== orgId && !onBlockIds.has(r.id));

  const controlById = await fetchControlYearsById(leagueId, candidateRows.map((r) => r.id));

  const teamIds = [...new Set(candidateRows.map((r) => r.organization_id))];
  const { data: teamsRaw, error: teamsErr } = await supabase.from("teams").select("id,name").eq("dsa_league_id", leagueId).in("id", teamIds);
  if (teamsErr) throw teamsErr;
  const teamNameById = new Map((teamsRaw as { id: number; name: string }[]).map((t) => [t.id, t.name]));

  return needs.map((need) => {
    const floor = currentFloorForNeed(rows, orgId, need);
    const candidates: BroaderCandidate[] = candidateRows
      .map((c) => {
        const score = candidateScoreForNeed(c, need);
        if (score === null || score <= floor) return null;
        const controlInfo = controlById.get(c.id) ?? null;
        const control = controlInfo?.controlYears ?? null;
        const shortControl = control !== null && control <= BROADER_SCAN_MAX_CONTROL_YEARS;
        const weakTeam = sellerOrgIds.has(c.organization_id);
        if (!shortControl && !weakTeam) return null;
        return {
          playerId: c.id, name: c.name, teamName: teamNameById.get(c.organization_id) ?? null,
          score, currentFloor: floor, upgradeSize: score - floor, yearsOfControl: control, contractAav: controlInfo?.contractAav ?? null,
          availabilitySignal: (shortControl && weakTeam ? "both" : shortControl ? "short-control" : "weak-team") as BroaderCandidate["availabilitySignal"],
        };
      })
      .filter((c): c is BroaderCandidate => c !== null)
      .sort((a, b) => b.upgradeSize - a.upgradeSize);
    return { need, candidates };
  });
}

// --- Full trade-block table (2026-09-14, Rees's ask) -----------------------
// "A full trade block table... at the bottom of all of the listed players,
// their ratings, stats, and potential positions" -- plus two same-day
// follow-ups: "the related note from the trade block" and "contract
// information." Ratings/stats/sort/filter (including a role filter) are
// already exactly what PlayerTable.tsx + fetchComputedPlayers (lib/
// queries.ts) provide -- reused directly, not rebuilt (the page calls
// fetchComputedPlayers with every block player id). What that shared
// infrastructure doesn't carry -- potential positions, the listing note,
// and this specific listing's contract/AAV -- is computed here and merged
// onto PlayerRow by the page.

function eligiblePositionsFor(r: LeaguePlayerRow): FieldPosition[] {
  if (r.ph !== "H") return [];
  return FIELD_POSITIONS.filter((pos) => {
    const potVal = r[FIELD_POS_KEY[pos]] as number | null;
    if (potVal === null || potVal < EXACT_POS_ELIGIBILITY_MIN[pos]) return false;
    const armMin = EXACT_POS_ARM_MIN[pos];
    if (armMin !== undefined && (r.ifa === null || r.ifa < armMin)) return false;
    const rangeMin = EXACT_POS_RANGE_MIN[pos];
    if (rangeMin !== undefined && (r.ifr === null || r.ifr < rangeMin)) return false;
    return true;
  });
}

export interface TradeBlockPlayerMeta {
  eligiblePositions: FieldPosition[];
  note: string;
  contractAav: number | null;
  yearsOfControl: number | null;
}

// One call gives the page everything it needs to build the full table
// beyond what fetchComputedPlayers already covers: which player ids are on
// the block (map keys, for fetchComputedPlayers itself), each one's real
// eligible positions, listing note, and contract.
export async function getTradeBlockMeta(leagueId: number): Promise<Map<number, TradeBlockPlayerMeta>> {
  const block = await fetchTradeBlockRows(leagueId);
  return new Map(block.map((b) => [b.row.id, {
    eligiblePositions: eligiblePositionsFor(b.row),
    note: b.note,
    contractAav: b.contractAav,
    yearsOfControl: b.yearsOfControl,
  }]));
}
