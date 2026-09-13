import { makeSupabaseClient } from "./supabase-client";
import { latestRefreshRunId } from "./queries";
import { fetchAll } from "./org-minors-query";
import { computeBattingVsHand } from "./rating-engine";
import { optimalAssignment } from "./assignment";

const supabase = makeSupabaseClient();

// /lineup (2026-09-10, Rees's ask): "optimize my lineup versus lefties and
// righties... top players well capable of playing the position (min 55) and
// optimized for batting vs each type and overall defensive strength...
// feature the top backup (not included in the lineup). Our league runs fully
// with a DH always in the lineup." Two independent optimal 9-man lineups
// (one per pitcher handedness), each solved as a real assignment problem
// (see assignment.ts) rather than picking the best bat per position
// independently -- a hitter eligible at more than one spot (a 1B/3B masher,
// a CF who also grades out in a corner) needs the whole lineup considered at
// once, or a greedy pick can leave a worse total lineup on the table.
//
// Decisions made answering Rees's own clarifying questions (2026-09-10):
// - Eligibility checks the POTENTIAL position grade (pot_c/pot_1b/etc.),
//   min 55 at every position except catcher, which Rees corrected to 50
//   (2026-09-10 follow-up) -- matching this engine's own existing TBL Pos
//   classification elsewhere, which already treats catcher as a real,
//   separate, lower bar rather than folding it into the same number as
//   every other position.
// - Once eligible, "overall defensive strength" is the CURRENT position
//   grade (pos_c/pos_1b/etc.) -- the same position-specific number, not the
//   coarser c_rating/inf_rating/of_rating tool composite shared across a
//   whole family of positions.
// - "Top backup" = one per position (9 total): the best remaining eligible
//   player not already starting anywhere in that same lineup. Widened to
//   TWO backups per position (2026-09-13, Rees's ask) -- see `backups` on
//   LineupSlot below.
//
// Injuries (2026-09-13, Rees's ask): a sim in this league covers roughly
// two weeks, so any hitter projected to miss 5+ days of that window is
// excluded from both lineups outright (see isAvailableForLineup below),
// with the excluded list itself surfaced via `injuredOut` so it's visible
// WHY a regular is missing, not just that he is.
export const FIELD_POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;
export type FieldPosition = (typeof FIELD_POSITIONS)[number];
export const LINEUP_POSITIONS = [...FIELD_POSITIONS, "DH"] as const;
export type LineupPosition = (typeof LINEUP_POSITIONS)[number];

interface RatingsRow {
  player_id: number;
  cntct_l: number | null; cntct_r: number | null;
  gap_l: number | null; gap_r: number | null;
  pow_l: number | null; pow_r: number | null;
  eye_l: number | null; eye_r: number | null;
  speed: number | null;
  pos_c: number | null; pos_1b: number | null; pos_2b: number | null; pos_3b: number | null;
  pos_ss: number | null; pos_lf: number | null; pos_cf: number | null; pos_rf: number | null;
  pot_c: number | null; pot_1b: number | null; pot_2b: number | null; pot_3b: number | null;
  pot_ss: number | null; pot_lf: number | null; pot_cf: number | null; pot_rf: number | null;
}

const POS_KEYS: Record<FieldPosition, { pot: keyof RatingsRow; pos: keyof RatingsRow }> = {
  C: { pot: "pot_c", pos: "pos_c" },
  "1B": { pot: "pot_1b", pos: "pos_1b" },
  "2B": { pot: "pot_2b", pos: "pos_2b" },
  "3B": { pot: "pot_3b", pos: "pos_3b" },
  SS: { pot: "pot_ss", pos: "pos_ss" },
  LF: { pot: "pot_lf", pos: "pos_lf" },
  CF: { pot: "pot_cf", pos: "pos_cf" },
  RF: { pot: "pot_rf", pos: "pos_rf" },
};

// OOTP's own numeric position codes (1=P, confirmed and reused elsewhere
// this session -- e.g. Kyle Teel/position=2=C, Anthony Kay/position=1=P).
// Needed to filter player_fielding_stats_snapshots, which records ZR per
// real numeric position, not by our FieldPosition label.
const FIELD_POSITION_CODE: Record<FieldPosition, number> = {
  C: 2, "1B": 3, "2B": 4, "3B": 5, SS: 6, LF: 7, CF: 8, RF: 9,
};

// Eligibility threshold, per position -- 55 everywhere except catcher (50,
// Rees's 2026-09-10 correction: catching is scarce/harder to grade the same
// way as everywhere else, so it gets its own lower bar, same as this
// engine's TBL Pos classification already does elsewhere).
const ELIGIBILITY_MIN: Record<FieldPosition, number> = {
  C: 50, "1B": 55, "2B": 55, "3B": 55, SS: 55, LF: 55, CF: 55, RF: 55,
};

// Composite lineup-selection score = battingVsHand * OFFENSE_WEIGHT +
// positionGrade * DEFENSE_WEIGHT (DH skips the defense term entirely -- no
// glove requirement to weigh). Both operands are already on the same ~0-80
// scale (confirmed against the active weight set: contact+gap+power+eye+
// speed sum to exactly 1.0, so battingVsHand is a weighted AVERAGE of ~0-80
// tool grades, not a rescaled sum -- pos_c/pos_1b/etc. are also 0-80), so a
// plain weighted blend of the two raw numbers is valid without any
// percentile normalization step. The 70/30 split is a judgment call --
// Rees asked to optimize on both factors but didn't specify a ratio; this
// leans offense-first (bat matters most, defense breaks close calls),
// matching how lineup construction actually works in practice. Easy to
// retune if it picks something that looks wrong in practice.
const OFFENSE_WEIGHT = 0.7;
const DEFENSE_WEIGHT = 0.3;

// Injury exclusion (2026-09-13, Rees's ask): a sim in this league covers
// roughly two weeks, so a player projected to miss 5+ days of that window
// is excluded from the optimal lineup outright, not just flagged with a
// lower score. Deliberately its own rule, NOT a reuse of org-minors-
// query.ts's isAvailable()/HEALTHY_WITHIN_DAYS (7 days) -- that helper
// answers a different question ("healthy enough to count toward
// organizational depth right now," for Org Minors' Role Health) and,
// critically, only ever checks injury_left for a player already flagged
// is_on_dl/is_on_dl60 -- a day-to-day (not formally DL'd) injury was
// ALWAYS treated as available there regardless of how long it actually
// runs. Confirmed via real data this matters: DTD-tagged players in TBL
// right now have injury_left values as high as 61 days, not just the
// short nicks "day-to-day" implies. This function ignores the DTD/DL
// distinction entirely and judges purely by the real day count, since
// that's the actual question Rees asked ("out for at least 5 or more
// days"), not how the injury happens to be formally classified.
const LINEUP_INJURY_THRESHOLD_DAYS = 5;
function isAvailableForLineup(p: { injury_is_injured: boolean | null; injury_left: number | null }): boolean {
  if (!p.injury_is_injured) return true;
  return (p.injury_left ?? Infinity) < LINEUP_INJURY_THRESHOLD_DAYS;
}

// Visualizes exactly who got excluded and why (2026-09-13, Rees's other
// ask, "a way to visualize" the exclusion) -- hitters only, since pitchers
// were never lineup candidates regardless of health.
export interface InjuredOutPlayer {
  playerId: number;
  name: string;
  daysLeft: number | null; // null is the "injured but no day count on file" edge case, treated as long-term/unknown, not healthy
}

export interface LineupSlotPlayer {
  playerId: number;
  name: string;
  // The exact number Rees asked to see displayed for both starters and
  // backups: this player's Batting-shaped value against THIS specific
  // lineup's pitcher handedness (not the flat, unblended Batting grade).
  battingVsHand: number;
  positionGrade: number | null; // current pos_X grade at this slot; null for DH
  overall: number | null;
  // Real season performance (2026-09-13, Rees's ask: "track performance vs
  // each pitching hand... as well as ZR at the position they are listed
  // at"). Purely additive display data -- battingVsHand/positionGrade
  // above (scouted ratings) still drive the actual lineup selection
  // unchanged. MLB-level only (level_id=1), split by the SAME pitcher hand
  // as the lineup this player appears in (split_id 2=vsLHP, 3=vsRHP).
  // Falls back to the most recently COMPLETED season when the current one
  // has no at-bats yet -- same offseason rule as getTopProspectsDetailed/
  // getFreeAgents (queries.ts / free-agency-query.ts); the resolved year
  // and whether it's a fallback are exposed ONCE on OptimalLineups itself,
  // not repeated per player here. Every field below is null when a player
  // genuinely has no real MLB at-bats in either season (e.g. hasn't
  // debuted yet) or, for zrAtPosition, no real innings on file at this
  // exact position (always null for DH, which has no fielding position).
  //
  // Trimmed to PA/OPS/OPS+/ZR (2026-09-13, Rees's ask -- the original
  // AVG/SLG/OPS/OPS+/ZR five-stat line made an already-wide table scroll
  // horizontally badly enough to be unusable). OBP/SLG are still computed
  // internally (needed for OPS/OPS+ either way) just no longer exposed.
  paVsHand: number | null;
  opsVsHand: number | null;
  // Simple, unadjusted OPS+ (100 * (OBP/lgOBP + SLG/lgSLG - 1)) against the
  // real league-wide MLB baseline for this SAME split/season -- no park
  // adjustment, matching the same level of rigor as this codebase's other
  // display-only (not regression-input) OPS+-style numbers. Null when the
  // league baseline itself has no real at-bats for this split/season
  // (can't divide by a zero/missing OBP or SLG).
  opsPlusVsHand: number | null;
  zrAtPosition: number | null;
}

export interface LineupSlot {
  position: LineupPosition;
  starter: LineupSlotPlayer | null; // null only if literally no eligible candidate exists on the roster
  // Top TWO remaining eligible bench players (2026-09-13, Rees's ask,
  // widened from one) -- same rule as before otherwise: best-score-first,
  // not already starting anywhere in this same lineup. Length 0-2; shorter
  // only when the roster genuinely doesn't have that many eligible bodies.
  backups: LineupSlotPlayer[];
}

// A healthy, eligible hitter who never lands as a starter or PRIMARY
// (first) backup anywhere, in either lineup (2026-09-13, Rees's ask) --
// real bench overflow: candidates worth considering for a minors option to
// open a roster spot, since the best role this engine can find for them
// anywhere is third-string-or-deeper. Deliberately still counts someone
// who shows up as a plain (non-primary) second backup somewhere as
// "unused" -- that's not meaningfully different from not being used at
// all for roster-construction purposes.
export interface UnusedCandidate {
  playerId: number;
  name: string;
  overall: number | null;
  // Real field positions (not counting DH, which every hitter is
  // trivially "eligible" for -- listing it on every single row would be
  // pure noise) this player cleared the eligibility bar for. Empty means
  // bat-only: didn't clear the bar anywhere in the field.
  eligiblePositions: FieldPosition[];
}

export interface OptimalLineups {
  vsLHP: LineupSlot[];
  vsRHP: LineupSlot[];
  // Active-roster hitters excluded from BOTH lineups above due to a 5+ day
  // injury (2026-09-13) -- same list either way, since availability doesn't
  // depend on which pitcher hand a lineup is built against.
  injuredOut: InjuredOutPlayer[];
  // Healthy, eligible hitters who never surface as a starter or primary
  // backup in EITHER lineup (2026-09-13) -- sorted best-Overall-first, so
  // the most surprising/notable case (a well-rated player still not
  // finding real playing time) leads.
  unused: UnusedCandidate[];
  // Real-stats resolution, exposed ONCE here (2026-09-13) rather than only
  // per-player on LineupSlotPlayer.statsYear (which repeats the identical
  // value on every row) -- lets the page render a single shared footnote
  // instead of re-deriving "is this a fallback" per row. statsIsFallback is
  // true iff the CURRENT season had no real MLB at-bats yet at the moment
  // of this call (the offseason case); a null statsYear (no real stats
  // exist for ANY season at all) is NOT a fallback, just genuinely no data.
  statsYear: number | null;
  statsIsFallback: boolean;
}

interface Candidate {
  playerId: number;
  name: string;
  overall: number | null;
  vsL: number;
  vsR: number;
  posGrade: Partial<Record<FieldPosition, number>>;
  eligible: Record<FieldPosition, boolean>;
}

function scoreForField(c: Candidate, pos: FieldPosition, battingVsHand: number): number | null {
  if (!c.eligible[pos]) return null;
  const posGrade = c.posGrade[pos];
  if (posGrade === undefined) return null; // defensive guard; shouldn't happen if eligible (pot_X implies pos_X is on file)
  return battingVsHand * OFFENSE_WEIGHT + posGrade * DEFENSE_WEIGHT;
}

interface BattingCounts { pa: number; ab: number; h: number; d: number; t: number; hr: number; bb: number; hp: number; sf: number }

// Real season performance context (2026-09-13) -- built once per
// getOptimalLineups() call and passed through to every toSlotPlayer() call
// for both lineups, so the (potentially large) league-wide baseline/roster
// stat fetches only ever happen once, not once per slot.
interface RealStatsContext {
  statsYear: number | null;
  battingBySplit: Map<number, Map<number, BattingCounts>>; // split_id (2/3) -> player_id -> counts
  leagueBaselineBySplit: Map<number, { obp: number; slg: number }>; // split_id -> real MLB-wide OBP/SLG for that split/season
  zrByPosition: Map<number, Map<number, number>>; // OOTP position code -> player_id -> ZR
}

const SPLIT_ID_FOR_HAND: Record<"l" | "r", number> = { l: 2, r: 3 };

function realStatLine(
  playerId: number,
  hand: "l" | "r",
  position: LineupPosition,
  ctx: RealStatsContext
): Pick<LineupSlotPlayer, "paVsHand" | "opsVsHand" | "opsPlusVsHand" | "zrAtPosition"> {
  const bat = ctx.battingBySplit.get(SPLIT_ID_FOR_HAND[hand])?.get(playerId);
  let pa: number | null = null, ops: number | null = null, opsPlus: number | null = null;
  if (bat && bat.ab > 0) {
    pa = bat.pa;
    const singles = bat.h - bat.d - bat.t - bat.hr;
    const totalBases = singles + 2 * bat.d + 3 * bat.t + 4 * bat.hr;
    const slg = totalBases / bat.ab;
    const obpDenom = bat.ab + bat.bb + bat.hp + bat.sf;
    const obp = obpDenom > 0 ? (bat.h + bat.bb + bat.hp) / obpDenom : null;
    if (obp !== null) {
      ops = obp + slg;
      const lg = ctx.leagueBaselineBySplit.get(SPLIT_ID_FOR_HAND[hand]);
      if (lg && lg.obp > 0 && lg.slg > 0) opsPlus = Math.round(100 * (obp / lg.obp + slg / lg.slg - 1));
    }
  }
  const zr = position === "DH" ? null : ctx.zrByPosition.get(FIELD_POSITION_CODE[position as FieldPosition])?.get(playerId) ?? null;
  return { paVsHand: pa, opsVsHand: ops, opsPlusVsHand: opsPlus, zrAtPosition: zr };
}

function toSlotPlayer(c: Candidate, position: LineupPosition, battingVsHand: number, hand: "l" | "r", ctx: RealStatsContext): LineupSlotPlayer {
  return {
    playerId: c.playerId,
    name: c.name,
    battingVsHand,
    positionGrade: position === "DH" ? null : c.posGrade[position as FieldPosition] ?? null,
    overall: c.overall,
    ...realStatLine(c.playerId, hand, position, ctx),
  };
}

function emptyLineup(): LineupSlot[] {
  return LINEUP_POSITIONS.map((position) => ({ position, starter: null, backups: [] }));
}

// Top TWO remaining eligible bench players (2026-09-13, widened from one) --
// best-score-first, not already starting anywhere in this same lineup.
const BACKUPS_PER_SLOT = 2;

function buildLineup(candidates: Candidate[], hand: "l" | "r", ctx: RealStatsContext): LineupSlot[] {
  const battingFor = (c: Candidate) => (hand === "l" ? c.vsL : c.vsR);

  // Row per candidate, one column per lineup slot (8 field positions + DH),
  // null wherever that candidate isn't eligible there -- optimalAssignment
  // never places a candidate in a null-valued slot.
  const values: (number | null)[][] = candidates.map((c) => {
    const bat = battingFor(c);
    const row: (number | null)[] = FIELD_POSITIONS.map((pos) => scoreForField(c, pos, bat));
    row.push(bat); // DH: pure batting, always "eligible"
    return row;
  });

  const assignment = optimalAssignment(LINEUP_POSITIONS.length, values);
  const startingIds = new Set(
    assignment.filter((a): a is number => a !== null).map((a) => candidates[a].playerId)
  );

  return LINEUP_POSITIONS.map((position, slotIdx) => {
    const candIdx = assignment[slotIdx];
    const starter = candIdx !== null ? toSlotPlayer(candidates[candIdx], position, battingFor(candidates[candIdx]), hand, ctx) : null;

    // Backups: best TWO remaining eligible players not starting ANYWHERE in
    // this lineup (Rees's spec, widened 2026-09-13 from "one per position" --
    // "the best eligible player[s] NOT included in the lineup"). Deliberately
    // not itself a second assignment problem -- the same bench bat can be
    // listed as a backup at more than one position, same as how a real bench
    // actually works (a backup catcher who's also the emergency 1B, say).
    const bench = candidates.filter((c) => !startingIds.has(c.playerId));
    const eligibleBench = position === "DH" ? bench : bench.filter((c) => c.eligible[position as FieldPosition]);
    const scored = eligibleBench
      .map((c) => {
        const bat = battingFor(c);
        const score = position === "DH" ? bat : scoreForField(c, position as FieldPosition, bat);
        return score !== null ? { c, bat, score } : null;
      })
      .filter((x): x is { c: Candidate; bat: number; score: number } => x !== null)
      .sort((a, b) => b.score - a.score);
    const backups = scored.slice(0, BACKUPS_PER_SLOT).map(({ c, bat }) => toSlotPlayer(c, position, bat, hand, ctx));

    return { position, starter, backups };
  });
}

export async function getOptimalLineups(leagueId: number, orgId: number): Promise<OptimalLineups> {
  const refreshRunId = await latestRefreshRunId(leagueId);

  // Real active MLB roster only -- same organization_id+team_id+level=1
  // filter org-minors-query.ts already established for this exact "MLB and
  // int'l" split, plus is_active (excludes DFA'd/mistagged level-1 rows,
  // same gotcha documented there) and a positive league_id (excludes the
  // international academy, which hides under the same team_id at level=1
  // with a NEGATIVE league_id -- see that file's gotcha comment).
  const rosterPlayers = await fetchAll<{
    id: number; first_name: string; last_name: string;
    injury_is_injured: boolean | null; is_on_dl: boolean | null; is_on_dl60: boolean | null; injury_left: number | null;
  }>((from, to) =>
    supabase
      .from("players")
      .select("id,first_name,last_name,injury_is_injured,is_on_dl,is_on_dl60,injury_left")
      .eq("dsa_league_id", leagueId)
      .eq("organization_id", orgId).eq("team_id", orgId).eq("level", 1).eq("is_active", true)
      .gt("league_id", 0)
      .range(from, to) as never
  );
  const allIds = rosterPlayers.map((p) => p.id);
  if (allIds.length === 0) return { vsLHP: emptyLineup(), vsRHP: emptyLineup(), injuredOut: [], unused: [], statsYear: null, statsIsFallback: false };

  // player_computed (ph, for the hitter/pitcher split) is needed for the
  // FULL roster, not just the available ones -- injuredOut below has to
  // know which excluded players were even hitters in the first place.
  const [{ data: computedRaw, error: compErr }, { data: weightRow, error: wErr }] = await Promise.all([
    supabase.from("player_computed").select("player_id,ph,overall").eq("refresh_run_id", refreshRunId).in("player_id", allIds),
    supabase.from("rating_weights").select("contact,gap,power,eye,speed").eq("dsa_league_id", leagueId).eq("is_active", true).single(),
  ]);
  if (compErr) throw compErr;
  if (wErr || !weightRow) throw new Error(`No active weight set found: ${wErr?.message}`);
  const computedById = new Map(
    (computedRaw as { player_id: number; ph: "H" | "P" | null; overall: number | null }[]).map((c) => [c.player_id, c])
  );
  const weights = weightRow as { contact: number; gap: number; power: number; eye: number; speed: number };

  const availablePlayers = rosterPlayers.filter(isAvailableForLineup);
  // Visualization list (2026-09-13): hitters excluded from both lineups for
  // being out 5+ days, soonest-back-first (the most actionable ordering --
  // "who might I get back soon" reads better than an arbitrary roster order).
  const injuredOut: InjuredOutPlayer[] = rosterPlayers
    .filter((p) => !isAvailableForLineup(p) && computedById.get(p.id)?.ph === "H")
    .map((p) => ({ playerId: p.id, name: `${p.first_name} ${p.last_name}`, daysLeft: p.injury_left }))
    .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));

  const ids = availablePlayers.map((p) => p.id);
  if (ids.length === 0) return { vsLHP: emptyLineup(), vsRHP: emptyLineup(), injuredOut, unused: [], statsYear: null, statsIsFallback: false };

  const { data: ratingsRaw, error: ratErr } = await supabase
    .from("player_ratings_snapshots")
    .select("player_id,cntct_l,cntct_r,gap_l,gap_r,pow_l,pow_r,eye_l,eye_r,speed,pos_c,pos_1b,pos_2b,pos_3b,pos_ss,pos_lf,pos_cf,pos_rf,pot_c,pot_1b,pot_2b,pot_3b,pot_ss,pot_lf,pot_cf,pot_rf")
    .eq("refresh_run_id", refreshRunId).in("player_id", ids);
  if (ratErr) throw ratErr;
  const ratingsById = new Map((ratingsRaw as RatingsRow[]).map((r) => [r.player_id, r]));

  const candidates: Candidate[] = [];
  for (const p of availablePlayers) {
    const c = computedById.get(p.id);
    if (!c || c.ph !== "H") continue; // pitchers don't hit in this league (universal DH) -- not lineup candidates
    const r = ratingsById.get(p.id);
    if (!r) continue;
    const vsL = computeBattingVsHand(r, weights, "l");
    const vsR = computeBattingVsHand(r, weights, "r");
    const posGrade: Partial<Record<FieldPosition, number>> = {};
    const eligible = {} as Record<FieldPosition, boolean>;
    for (const pos of FIELD_POSITIONS) {
      const { pot, pos: posKey } = POS_KEYS[pos];
      const potVal = r[pot];
      const curVal = r[posKey];
      eligible[pos] = potVal !== null && potVal >= ELIGIBILITY_MIN[pos];
      if (curVal !== null) posGrade[pos] = curVal;
    }
    candidates.push({ playerId: p.id, name: `${p.first_name} ${p.last_name}`, overall: c.overall, vsL, vsR, posGrade, eligible });
  }

  // Real season performance (2026-09-13, Rees's ask) -- resolved once here,
  // not per slot. Offseason fallback: the latest refresh run's own stat
  // rows are only ever for the CURRENT season (refresh.ts only pulls that
  // each run) -- the instant a new season begins with zero games played
  // yet, that run has no stat rows at all. Falls back to the most recently
  // COMPLETED season (and the specific, older refresh_run_id that actually
  // captured it) when that happens -- same rule, same reasoning, as
  // getTopProspectsDetailed (queries.ts) and getFreeAgents
  // (free-agency-query.ts); kept as its own copy here rather than a shared
  // helper, matching this codebase's own established preference for
  // duplicating a small, stable rule over introducing a shared abstraction
  // across files that don't otherwise depend on each other.
  let statsYear: number | null = null;
  let statsRefreshRunId = refreshRunId;
  let statsIsFallback = false;
  {
    const { data: currentYearRow } = await supabase
      .from("player_batting_stats_snapshots").select("year").eq("refresh_run_id", refreshRunId).order("year", { ascending: false }).limit(1).maybeSingle();
    statsYear = (currentYearRow as { year: number } | null)?.year ?? null;
    if (statsYear === null) {
      const { data: fallbackRow } = await supabase
        .from("player_batting_stats_snapshots").select("year,refresh_run_id").eq("dsa_league_id", leagueId)
        .order("year", { ascending: false }).order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
      const fallback = fallbackRow as { year: number; refresh_run_id: number } | null;
      if (fallback) {
        statsYear = fallback.year;
        statsRefreshRunId = fallback.refresh_run_id;
        statsIsFallback = true;
      }
    }
  }

  const candidateIds = candidates.map((c) => c.playerId);
  const battingBySplit = new Map<number, Map<number, BattingCounts>>([[2, new Map()], [3, new Map()]]);
  const leagueBaselineBySplit = new Map<number, { obp: number; slg: number }>();
  const zrByPosition = new Map<number, Map<number, number>>();

  if (statsYear !== null && candidateIds.length > 0) {
    // This roster's own hitters, both hand splits, MLB level only -- level_id=1
    // matches the same "how would this bat perform in an MLB lineup" framing
    // as the rest of this page (these are all current MLB roster players).
    // A player can have more than one stint at this level/split/season (a
    // same-level in-season trade) -- summed per player, same pattern as
    // getTopProspectsDetailed.
    const { data: ownBatRaw, error: ownBatErr } = await supabase
      .from("player_batting_stats_snapshots").select("player_id,split_id,pa,ab,h,d,t,hr,bb,hp,sf")
      .eq("refresh_run_id", statsRefreshRunId).eq("year", statsYear).eq("level_id", 1).in("split_id", [2, 3]).in("player_id", candidateIds);
    if (ownBatErr) throw ownBatErr;
    for (const r of (ownBatRaw ?? []) as { player_id: number; split_id: number; pa: number; ab: number; h: number; d: number; t: number; hr: number; bb: number; hp: number; sf: number }[]) {
      const bySplit = battingBySplit.get(r.split_id);
      if (!bySplit) continue;
      const cur = bySplit.get(r.player_id) ?? { pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, hp: 0, sf: 0 };
      cur.pa += r.pa; cur.ab += r.ab; cur.h += r.h; cur.d += r.d; cur.t += r.t; cur.hr += r.hr; cur.bb += r.bb; cur.hp += r.hp; cur.sf += r.sf;
      bySplit.set(r.player_id, cur);
    }

    // League-wide MLB baseline for the SAME split/season/refresh_run_id, for
    // OPS+ -- every real MLB hitter's split-specific line, not just this
    // roster's, paginated since this is league-wide. No PA needed here
    // (only ever used for OBP/SLG), hence its own lighter type.
    type LeagueCounts = Omit<BattingCounts, "pa">;
    const leagueTotalsBySplit = new Map<number, LeagueCounts>([[2, { ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, hp: 0, sf: 0 }], [3, { ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, hp: 0, sf: 0 }]]);
    const leagueBatRows = await fetchAll<{ split_id: number; ab: number; h: number; d: number; t: number; hr: number; bb: number; hp: number; sf: number }>((from, to) =>
      supabase.from("player_batting_stats_snapshots").select("split_id,ab,h,d,t,hr,bb,hp,sf")
        .eq("refresh_run_id", statsRefreshRunId).eq("year", statsYear).eq("level_id", 1).in("split_id", [2, 3]).range(from, to) as never
    );
    for (const r of leagueBatRows) {
      const cur = leagueTotalsBySplit.get(r.split_id);
      if (!cur) continue;
      cur.ab += r.ab; cur.h += r.h; cur.d += r.d; cur.t += r.t; cur.hr += r.hr; cur.bb += r.bb; cur.hp += r.hp; cur.sf += r.sf;
    }
    for (const [splitId, t] of leagueTotalsBySplit) {
      if (t.ab <= 0) continue;
      const singles = t.h - t.d - t.t - t.hr;
      const totalBases = singles + 2 * t.d + 3 * t.t + 4 * t.hr;
      const obpDenom = t.ab + t.bb + t.hp + t.sf;
      if (obpDenom <= 0) continue;
      leagueBaselineBySplit.set(splitId, { obp: (t.h + t.bb + t.hp) / obpDenom, slg: totalBases / t.ab });
    }

    // ZR at each real field position, this roster's hitters only -- overall
    // split (split_id=0, fielding's own "overall" convention, DIFFERENT from
    // batting/pitching's split_id=1 -- see getTopProspectsDetailed's comment
    // for the gotcha this already caught once).
    const { data: fieldRaw, error: fieldErr } = await supabase
      .from("player_fielding_stats_snapshots").select("player_id,position,zr")
      .eq("refresh_run_id", statsRefreshRunId).eq("year", statsYear).eq("level_id", 1).eq("split_id", 0).in("player_id", candidateIds);
    if (fieldErr) throw fieldErr;
    for (const r of (fieldRaw ?? []) as { player_id: number; position: number | null; zr: number | null }[]) {
      if (r.position === null || r.zr === null) continue;
      const byPos = zrByPosition.get(r.position) ?? new Map<number, number>();
      byPos.set(r.player_id, r.zr); // a player has at most one row per position per season -- no stint-summing needed here
      zrByPosition.set(r.position, byPos);
    }
  }

  const ctx: RealStatsContext = { statsYear, battingBySplit, leagueBaselineBySplit, zrByPosition };
  const vsLHP = buildLineup(candidates, "l", ctx);
  const vsRHP = buildLineup(candidates, "r", ctx);

  // Bench overflow (2026-09-13, Rees's ask): healthy, eligible hitters who
  // never land as a starter or PRIMARY (index-0) backup in EITHER lineup --
  // real candidates for a minors option to open a roster spot, since the
  // best role this engine finds for them anywhere is third-string-or-deeper.
  const usedMeaningfully = new Set<number>();
  for (const lineup of [vsLHP, vsRHP]) {
    for (const slot of lineup) {
      if (slot.starter) usedMeaningfully.add(slot.starter.playerId);
      if (slot.backups[0]) usedMeaningfully.add(slot.backups[0].playerId);
    }
  }
  const unused: UnusedCandidate[] = candidates
    .filter((c) => !usedMeaningfully.has(c.playerId))
    .map((c) => ({
      playerId: c.playerId,
      name: c.name,
      overall: c.overall,
      eligiblePositions: FIELD_POSITIONS.filter((pos) => c.eligible[pos]),
    }))
    .sort((a, b) => (b.overall ?? -Infinity) - (a.overall ?? -Infinity));

  return { vsLHP, vsRHP, injuredOut, unused, statsYear, statsIsFallback };
}
