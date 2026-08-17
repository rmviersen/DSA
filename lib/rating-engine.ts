/**
 * The harmonized rating engine — one shared formula set used for both rostered
 * players and draft prospects, per the 2026-08-17 harmonization decisions:
 *   1. Starter-bonus uses the player's real assigned position ("Pos" from the
 *      ratings feed, e.g. "SP"), never a projected role — for both rostered
 *      players and draft prospects.
 *   2. Potential is floored at current-demonstrated ability (MAX with current
 *      Pitching) for both — a sanity guard, not a "pro track record" concept.
 *   3. A pitch counts as "quality" at the same grade threshold for both current
 *      and future evaluation (tunable via rating_weights, defaults to 40/40).
 *   4. Prospect Potential (risk-discounted, blended with current Overall) is
 *      applied identically to draft prospects and rostered players — current
 *      Overall is already scaled to "MLB-ready today," so it naturally
 *      differentiates a college senior (higher, closer) from a high-schooler
 *      (lower, further away) rather than needing special-casing.
 *
 * IMPORTANT: "Overall" and "Potential" anywhere in this file mean OUR computed
 * values, derived from the underlying tool grades — never the raw `ovr`/`pot`
 * fields StatsPlus reports (the game's own scout grades). Those raw fields are
 * kept in player_ratings_snapshots only as a comparison baseline, never read
 * as an input here.
 *
 * KNOWN GAP: RLB's original bust-risk discount checks both a "Risk" field
 * (Extreme/Very High) and a "Prone" field (Fragile/Wrecked). StatsPlus's
 * ratings feed only exposes Prone — no equivalent "Risk" field was found in
 * the sampled data. This engine currently applies the discount based on Prone
 * alone. Flagged for follow-up, not blocking.
 */

export interface RatingsInput {
  pos: string | null;
  cntct: number | null; gap: number | null; pow: number | null; eye: number | null; ks: number | null;
  pot_cntct: number | null; pot_gap: number | null; pot_pow: number | null; pot_eye: number | null; pot_ks: number | null;
  speed: number | null;
  cblk: number | null; cfrm: number | null; carm: number | null;
  ifr: number | null; ife: number | null; ifa: number | null; tdp: number | null;
  ofr: number | null; ofe: number | null; ofa: number | null;
  stf: number | null; mov: number | null; pbabip: number | null; ctrl: number | null; stm: number | null;
  pot_stf: number | null; pot_mov: number | null; pot_pbabip: number | null; pot_ctrl: number | null;
  fst: number | null; chg: number | null; crv: number | null; sld: number | null; snk: number | null; splt: number | null;
  cutt: number | null; frk: number | null; circhg: number | null; scr: number | null; kncrv: number | null; knbl: number | null;
  pot_fst: number | null; pot_chg: number | null; pot_crv: number | null; pot_sld: number | null; pot_snk: number | null;
  pot_splt: number | null; pot_cutt: number | null; pot_frk: number | null; pot_circhg: number | null; pot_scr: number | null;
  pot_kncrv: number | null; pot_knbl: number | null;
  prone: string | null;
}

export interface WeightSet {
  id: number;
  contact: number; power: number; eye: number; gap: number; avoid_ks: number; speed: number;
  fielding: number; stuff: number; movement: number; control: number; stamina: number; pbabip: number;
  qp_multiplier: number; qp_threshold: number; qpp_threshold: number;
}

export interface ComputedRatings {
  weights_id: number;
  batting: number; batting_p: number; fielding: number;
  pitching: number; pitching_p: number; qp: number; qpp: number;
  c_rating: number; inf_rating: number; of_rating: number;
  overall: number; potential: number; prospect_potential: number;
  ph: "H" | "P";
}

const zero = (v: number | null) => v ?? 0;
const countAtLeast = (threshold: number, ...grades: (number | null)[]) =>
  grades.reduce((n, g) => n + (g !== null && g >= threshold ? 1 : 0), 0);

export function computeRatings(r: RatingsInput, w: WeightSet): ComputedRatings {
  const batting =
    zero(r.cntct) * w.contact + zero(r.ks) * w.avoid_ks + zero(r.pow) * w.power +
    zero(r.gap) * w.gap + zero(r.eye) * w.eye + zero(r.speed) * w.speed;

  const battingP =
    zero(r.pot_cntct) * w.contact + zero(r.pot_ks) * w.avoid_ks + zero(r.pot_pow) * w.power +
    zero(r.pot_gap) * w.gap + zero(r.pot_eye) * w.eye + zero(r.speed) * w.speed;

  const cRating = (zero(r.cblk) + zero(r.cfrm) + zero(r.carm)) / 3 + 15;
  const infRating = (zero(r.ifr) * 2 + zero(r.ife) + zero(r.ifa) + zero(r.tdp)) / 5 + 5;
  const ofRating = (zero(r.ofr) * 2 + zero(r.ofe) + zero(r.ofa)) / 4;
  const fielding = Math.max(cRating, infRating, ofRating);

  const qp = countAtLeast(w.qp_threshold, r.fst, r.chg, r.crv, r.sld, r.snk, r.splt, r.cutt, r.frk, r.circhg, r.scr, r.kncrv, r.knbl);
  const qpp = countAtLeast(w.qpp_threshold, r.pot_fst, r.pot_chg, r.pot_crv, r.pot_sld, r.pot_snk, r.pot_splt, r.pot_cutt, r.pot_frk, r.pot_circhg, r.pot_scr, r.pot_kncrv, r.pot_knbl);

  const isSP = r.pos === "SP";

  const pitching =
    (isSP ? zero(r.stf) + 5 : zero(r.stf)) * w.stuff +
    zero(r.mov) * w.movement + zero(r.pbabip) * w.pbabip + zero(r.ctrl) * w.control +
    zero(r.stm) * w.stamina + qp * w.qp_multiplier;

  const pitchingPRaw =
    (isSP ? zero(r.pot_stf) + 5 : zero(r.pot_stf)) * w.stuff +
    zero(r.pot_mov) * w.movement + zero(r.pot_pbabip) * w.pbabip + zero(r.pot_ctrl) * w.control +
    zero(r.stm) * w.stamina + qpp * w.qp_multiplier;
  const pitchingP = Math.max(pitching, pitchingPRaw - 3);

  const overall = Math.max(batting + fielding * w.fielding, pitching);
  const potential = Math.max(battingP + fielding * w.fielding, pitchingP);
  const ph: "H" | "P" = batting + fielding * w.fielding > pitching ? "H" : "P";

  const isBustRisk = r.prone === "Fragile" || r.prone === "Wrecked";
  const riskAdjusted = isBustRisk ? potential - 5 : potential;
  const prospectPotential = riskAdjusted + overall * 0.25 - 12.5;

  return {
    weights_id: w.id,
    batting, batting_p: battingP, fielding,
    pitching, pitching_p: pitchingP, qp, qpp,
    c_rating: cRating, inf_rating: infRating, of_rating: ofRating,
    overall, potential, prospect_potential: prospectPotential,
    ph,
  };
}
