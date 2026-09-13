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

export interface OptimalLineups {
  vsLHP: LineupSlot[];
  vsRHP: LineupSlot[];
  // Active-roster hitters excluded from BOTH lineups above due to a 5+ day
  // injury (2026-09-13) -- same list either way, since availability doesn't
  // depend on which pitcher hand a lineup is built against.
  injuredOut: InjuredOutPlayer[];
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

function toSlotPlayer(c: Candidate, position: LineupPosition, battingVsHand: number): LineupSlotPlayer {
  return {
    playerId: c.playerId,
    name: c.name,
    battingVsHand,
    positionGrade: position === "DH" ? null : c.posGrade[position as FieldPosition] ?? null,
    overall: c.overall,
  };
}

function emptyLineup(): LineupSlot[] {
  return LINEUP_POSITIONS.map((position) => ({ position, starter: null, backups: [] }));
}

// Top TWO remaining eligible bench players (2026-09-13, widened from one) --
// best-score-first, not already starting anywhere in this same lineup.
const BACKUPS_PER_SLOT = 2;

function buildLineup(candidates: Candidate[], hand: "l" | "r"): LineupSlot[] {
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
    const starter = candIdx !== null ? toSlotPlayer(candidates[candIdx], position, battingFor(candidates[candIdx])) : null;

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
    const backups = scored.slice(0, BACKUPS_PER_SLOT).map(({ c, bat }) => toSlotPlayer(c, position, bat));

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
  if (allIds.length === 0) return { vsLHP: emptyLineup(), vsRHP: emptyLineup(), injuredOut: [] };

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
  if (ids.length === 0) return { vsLHP: emptyLineup(), vsRHP: emptyLineup(), injuredOut };

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

  return {
    vsLHP: buildLineup(candidates, "l"),
    vsRHP: buildLineup(candidates, "r"),
    injuredOut,
  };
}
