import { makeSupabaseClient } from "./supabase-client";
import { latestRefreshRunId } from "./queries";
import { fetchAll, isAvailable } from "./org-minors-query";
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
//   player not already starting anywhere in that same lineup.
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
  backup: LineupSlotPlayer | null;
}

export interface OptimalLineups {
  vsLHP: LineupSlot[];
  vsRHP: LineupSlot[];
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
  return LINEUP_POSITIONS.map((position) => ({ position, starter: null, backup: null }));
}

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

    // Backup: best remaining eligible player not starting ANYWHERE in this
    // lineup (Rees's spec -- one per position, "the best eligible player
    // NOT included in the lineup"). Deliberately not itself a second
    // assignment problem -- the same bench bat can be listed as the backup
    // at more than one position, same as how a real bench actually works
    // (a backup catcher who's also the emergency 1B, say).
    const bench = candidates.filter((c) => !startingIds.has(c.playerId));
    const eligibleBench = position === "DH" ? bench : bench.filter((c) => c.eligible[position as FieldPosition]);
    let bestBackup: Candidate | null = null;
    let bestScore = -Infinity;
    for (const c of eligibleBench) {
      const bat = battingFor(c);
      const score = position === "DH" ? bat : scoreForField(c, position as FieldPosition, bat);
      if (score !== null && score > bestScore) {
        bestScore = score;
        bestBackup = c;
      }
    }
    const backup = bestBackup !== null ? toSlotPlayer(bestBackup, position, battingFor(bestBackup)) : null;

    return { position, starter, backup };
  });
}

export async function getOptimalLineups(orgId: number): Promise<OptimalLineups> {
  const refreshRunId = await latestRefreshRunId();

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
      .eq("organization_id", orgId).eq("team_id", orgId).eq("level", 1).eq("is_active", true)
      .gt("league_id", 0)
      .range(from, to) as never
  );
  // Same "realistically available" rule /org-minors already uses (Rees's
  // spec): DTD always counts, an actual DL stint only counts if he'd be
  // back within a week. A guy who can't play doesn't belong in a lineup
  // being built for right now.
  const availablePlayers = rosterPlayers.filter(isAvailable);
  const ids = availablePlayers.map((p) => p.id);
  if (ids.length === 0) return { vsLHP: emptyLineup(), vsRHP: emptyLineup() };

  const [{ data: computedRaw, error: compErr }, { data: ratingsRaw, error: ratErr }, { data: weightRow, error: wErr }] = await Promise.all([
    supabase.from("player_computed").select("player_id,ph,overall").eq("refresh_run_id", refreshRunId).in("player_id", ids),
    supabase
      .from("player_ratings_snapshots")
      .select("player_id,cntct_l,cntct_r,gap_l,gap_r,pow_l,pow_r,eye_l,eye_r,speed,pos_c,pos_1b,pos_2b,pos_3b,pos_ss,pos_lf,pos_cf,pos_rf,pot_c,pot_1b,pot_2b,pot_3b,pot_ss,pot_lf,pot_cf,pot_rf")
      .eq("refresh_run_id", refreshRunId).in("player_id", ids),
    supabase.from("rating_weights").select("contact,gap,power,eye,speed").eq("is_active", true).single(),
  ]);
  if (compErr) throw compErr;
  if (ratErr) throw ratErr;
  if (wErr || !weightRow) throw new Error(`No active weight set found: ${wErr?.message}`);

  const computedById = new Map(
    (computedRaw as { player_id: number; ph: "H" | "P" | null; overall: number | null }[]).map((c) => [c.player_id, c])
  );
  const ratingsById = new Map((ratingsRaw as RatingsRow[]).map((r) => [r.player_id, r]));
  const weights = weightRow as { contact: number; gap: number; power: number; eye: number; speed: number };

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
  };
}
