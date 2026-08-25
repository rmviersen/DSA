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
  // handedness splits -- used for Platoon (unblended, side-specific) AND,
  // as of 2026-08-24, to weight Batting/Pitching itself by real league
  // exposure (see HandednessSplits below). pbabip_l/pbabip_r added the same
  // day specifically for that -- they existed in player_ratings_snapshots
  // already but were never read into this interface before now.
  cntct_l: number | null; cntct_r: number | null; gap_l: number | null; gap_r: number | null;
  pow_l: number | null; pow_r: number | null; eye_l: number | null; eye_r: number | null;
  ks_l: number | null; ks_r: number | null;
  stf_l: number | null; stf_r: number | null; mov_l: number | null; mov_r: number | null;
  ctrl_l: number | null; ctrl_r: number | null; pbabip_l: number | null; pbabip_r: number | null;
  // potential position grades, needed for TBL Pos
  pot_c: number | null; pot_1b: number | null; pot_2b: number | null; pot_3b: number | null;
  pot_ss: number | null; pot_lf: number | null; pot_cf: number | null; pot_rf: number | null;
}

export interface WeightSet {
  id: number;
  contact: number; power: number; eye: number; gap: number; avoid_ks: number; speed: number;
  fielding: number; stuff: number; movement: number; control: number; stamina: number; pbabip: number;
  qp_multiplier: number; qp_threshold: number; qpp_threshold: number;
  sp_rp_stamina_threshold: number; sp_rp_min_pitches: number;
  catcher_batting_multiplier: number; ss_batting_multiplier: number; cf_batting_multiplier: number;
  catcher_fielding_bonus: number; infield_fielding_bonus: number; outfield_fielding_bonus: number;
}

// Real league-wide handedness exposure, computed fresh every refresh from
// actual MLB stats over the last 3 seasons (Rees 2026-08-24) -- NOT a
// per-player split (a player's own career AB/IP mix isn't used here, only
// how often the league as a whole faces same-handed vs. opposite-handed
// opponents). Batting uses AB against LHP/RHP; Pitching uses IP against
// LHB/RHB. Each pair should sum to 1 (a player's Batting/Pitching value
// shouldn't change in aggregate just because these shift, only how it's
// distributed between the vs-L and vs-R grades) -- computed in
// scripts/compute-ratings.ts, not here, since it needs a live Supabase
// query this module deliberately has no access to.
export interface HandednessSplits {
  battingPctVsL: number;
  battingPctVsR: number;
  pitchingPctVsL: number;
  pitchingPctVsR: number;
}

export interface ComputedRatings {
  weights_id: number;
  batting: number; batting_p: number; fielding: number;
  pitching: number; pitching_p: number; qp: number; qpp: number;
  c_rating: number; inf_rating: number; of_rating: number;
  overall: number; potential: number; prospect_potential: number;
  ph: "H" | "P";
  role: string; sp_rp: string; tbl_pos: string; platoon: string;
}

// TBL Pos position-eligibility thresholds — display/classification cutoffs,
// not "rating quality" the way the core weights are, so kept as constants
// rather than added to rating_weights. Can be promoted to config later if
// there's ever a reason to tune them.
const TBL_POS_THRESHOLDS = { c: 50, other: 55 };

// Position-player ROLE buckets (redesigned 2026-08-20, Rees's spec) --
// evaluated in priority order below, first match wins, so each player gets
// exactly one role. Deliberately mixes POTENTIAL position-fit grades
// (pot_c/pot_ss/pot_cf/pot_lf/pot_rf/pot_1b) with CURRENT range grades
// (ifr/ofr -- there's no potential-range field in this data, range is
// current-only). This replaced the old formula, which used only the
// composite CURRENT-ability ratings (cRating/infRating/ofRating) with no
// potential or position-specific input at all. Distinct from `tbl_pos`
// below, which lists every position a player's potential clears a bar for,
// not a single bucket.
const ROLE_BUCKET_THRESHOLDS = {
  c_pot: 50,
  // Marginal-potential catcher path (Rees 2026-08-24): a player whose
  // long-term pot_c falls just short of the full c_pot bar can still
  // qualify as Role="C" if his CURRENT blocking and framing are already
  // solid (>= c_marginal_block_frame each) -- catching readiness isn't
  // purely a ceiling question, a 45-potential backstop who already blocks
  // and frames like a 50 is a real catching prospect, not just a bat that
  // happens to be rostered there. Below c_pot_marginal, no path qualifies
  // regardless of current skill. Surfaced by a real case: Alex Nuno
  // (pot_c=45, cblk=50, cfrm=50) was falling through to COF/DH under the
  // single-threshold rule despite being a real rostered catcher.
  c_pot_marginal: 45, c_marginal_block_frame: 50,
  ss_pot: 55, ss_range: 65,
  cf_pot: 55, cf_range: 65,
  inf_range: 50,
  cof_pot: 50, cof_range: 50,
  first_base_pot: 55,
};

const zero = (v: number | null) => v ?? 0;
const countAtLeast = (threshold: number, ...grades: (number | null)[]) =>
  // Explicit <number> on reduce (2026-08-24): without it, TS infers the
  // accumulator's type ambiguously enough to widen it to `number | null`,
  // which cascades into every downstream user of qp/qpp reading as possibly
  // null even though this function can only ever return a real count. Not
  // just a cosmetic type-check nit -- `next build`'s type-check step (which
  // `tsc --noEmit` alone doesn't exactly mirror) treats this as a hard
  // compile error and blocks the production build entirely.
  grades.reduce<number>((n, g) => n + (g !== null && g >= threshold ? 1 : 0), 0);

export function computeRatings(r: RatingsInput, w: WeightSet, splits: HandednessSplits): ComputedRatings {
  // Computed early (before Batting) so the catcher batting multiplier below
  // can gate on it -- deliberately mirrors the Role priority-1 "C" branch
  // further down (same threshold, `ROLE_BUCKET_THRESHOLDS.c_pot`), reused
  // there instead of duplicated, so the two checks can't drift apart. Real
  // pitchers are excluded up front since a pitcher can never end up in the
  // position-player Role ladder regardless of `pot_c`. Two qualifying paths
  // (2026-08-24, Rees's spec): the original full-potential bar on its own,
  // OR a lower "marginal" potential bar backed by already-solid current
  // blocking AND framing -- catching readiness isn't purely a ceiling
  // question, so a 45-potential backstop who already blocks/frames like a
  // 50 should count, not just fall through to DH/COF.
  const isCatcherRole = r.pos !== "SP" && r.pos !== "RP" && r.pos !== "CL" && (
    zero(r.pot_c) >= ROLE_BUCKET_THRESHOLDS.c_pot ||
    (zero(r.pot_c) >= ROLE_BUCKET_THRESHOLDS.c_pot_marginal &&
      zero(r.cblk) >= ROLE_BUCKET_THRESHOLDS.c_marginal_block_frame &&
      zero(r.cfrm) >= ROLE_BUCKET_THRESHOLDS.c_marginal_block_frame)
  );
  // Same idea, same reuse pattern, added 2026-08-24 alongside the SS/CF
  // batting multipliers below -- mirrors the Role priority-2 "SS" and
  // priority-3 "CF" branches exactly (each only reachable if the higher-
  // priority buckets above it didn't already match), so a player can never
  // qualify for more than one of catcher/SS/CF here, same as Role itself.
  const isSSRole = !isCatcherRole && r.pos !== "SP" && r.pos !== "RP" && r.pos !== "CL" &&
    zero(r.pot_ss) >= ROLE_BUCKET_THRESHOLDS.ss_pot && zero(r.ifr) >= ROLE_BUCKET_THRESHOLDS.ss_range;
  const isCFRole = !isCatcherRole && !isSSRole && r.pos !== "SP" && r.pos !== "RP" && r.pos !== "CL" &&
    zero(r.pot_cf) >= ROLE_BUCKET_THRESHOLDS.cf_pot && zero(r.ofr) >= ROLE_BUCKET_THRESHOLDS.cf_range;

  // Batting components blended by real league AB exposure vs LHP/RHP
  // (2026-08-24, Rees's spec). Ks (avoid-Ks) blended in too as of the same
  // day's follow-up fix -- ks_l/ks_r are real, fully-populated columns
  // (confirmed 13,986/13,986 non-null) that were wrongly grouped in with
  // Speed's genuine no-split-data case in an earlier pass here; Speed alone
  // has no _l/_r fields in this data and stays unsplit. Potential is
  // deliberately UNCHANGED below (still the flat pot_* fields) -- there's no
  // pot_*_l/pot_*_r data to blend, per Rees's explicit call to hold off
  // there.
  const cntctBlend = zero(r.cntct_l) * splits.battingPctVsL + zero(r.cntct_r) * splits.battingPctVsR;
  const gapBlend = zero(r.gap_l) * splits.battingPctVsL + zero(r.gap_r) * splits.battingPctVsR;
  const powBlend = zero(r.pow_l) * splits.battingPctVsL + zero(r.pow_r) * splits.battingPctVsR;
  const eyeBlend = zero(r.eye_l) * splits.battingPctVsL + zero(r.eye_r) * splits.battingPctVsR;
  const ksBlend = zero(r.ks_l) * splits.battingPctVsL + zero(r.ks_r) * splits.battingPctVsR;

  // Premium-position batting multipliers (Rees 2026-08-24): a genuinely
  // MLB-caliber defender at a premium spot who can also hit is rare enough
  // that Fielding's own flat bonuses (catcher/infield -- diluted 4x by
  // fielding_weight before they reach Overall, and infield's has since been
  // removed entirely, see catcher_fielding_bonus/infield_fielding_bonus)
  // don't fully reflect it. SS and CF added the same day catcher's was
  // recalibrated (1.03 -> 1.05) specifically because they share their
  // Fielding composite with a non-premium role (SS with INF, CF with COF)
  // and so get no positional credit there at all beyond real grade
  // differences in the population. Each gated on its own computed Role
  // bucket (isCatcherRole/isSSRole/isCFRole above), NOT the raw StatsPlus
  // `pos` field, so only players who actually clear that position's "capable
  // of playing it at the MLB level" bar get the multiplier -- mutually
  // exclusive by construction, same as Role itself. Applied to both Batting
  // and Batting Potential, matching how every other weight here already
  // applies symmetrically to current and potential.
  const battingMultiplier = isCatcherRole ? w.catcher_batting_multiplier
    : isSSRole ? w.ss_batting_multiplier
    : isCFRole ? w.cf_batting_multiplier
    : 1;

  const battingRaw =
    cntctBlend * w.contact + ksBlend * w.avoid_ks + powBlend * w.power +
    gapBlend * w.gap + eyeBlend * w.eye + zero(r.speed) * w.speed;
  const batting = battingRaw * battingMultiplier;

  const battingPRaw =
    zero(r.pot_cntct) * w.contact + zero(r.pot_ks) * w.avoid_ks + zero(r.pot_pow) * w.power +
    zero(r.pot_gap) * w.gap + zero(r.pot_eye) * w.eye + zero(r.speed) * w.speed;
  const battingP = battingPRaw * battingMultiplier;

  // Flat per-position bonuses -- previously hardcoded (+15/+5/+0), now
  // tunable via rating_weights (Rees 2026-08-24, testing what happens to
  // Overall if these are pulled out and premium positions get rewarded via
  // a Batting multiplier -- like the catcher one above -- instead). Default
  // values (15/5/0) reproduce the original formula exactly.
  const cRating = (zero(r.cblk) + zero(r.cfrm) + zero(r.carm)) / 3 + w.catcher_fielding_bonus;
  const infRating = (zero(r.ifr) * 2 + zero(r.ife) + zero(r.ifa) + zero(r.tdp)) / 5 + w.infield_fielding_bonus;
  const ofRating = (zero(r.ofr) * 2 + zero(r.ofe) + zero(r.ofa)) / 4 + w.outfield_fielding_bonus;
  const fielding = Math.max(cRating, infRating, ofRating);

  const qp = countAtLeast(w.qp_threshold, r.fst, r.chg, r.crv, r.sld, r.snk, r.splt, r.cutt, r.frk, r.circhg, r.scr, r.kncrv, r.knbl);
  const qpp = countAtLeast(w.qpp_threshold, r.pot_fst, r.pot_chg, r.pot_crv, r.pot_sld, r.pot_snk, r.pot_splt, r.pot_cutt, r.pot_frk, r.pot_circhg, r.pot_scr, r.pot_kncrv, r.pot_knbl);

  const isSP = r.pos === "SP";

  // Same idea for pitchers: Stuff/Movement/PBABIP/Control blended by real
  // league IP exposure vs LHB/RHB. Stamina has no handedness-split field at
  // all (only a single `stm`), so it stays unsplit -- confirmed with Rees
  // 2026-08-24 rather than assumed.
  const stfBlend = zero(r.stf_l) * splits.pitchingPctVsL + zero(r.stf_r) * splits.pitchingPctVsR;
  const movBlend = zero(r.mov_l) * splits.pitchingPctVsL + zero(r.mov_r) * splits.pitchingPctVsR;
  const pbabipBlend = zero(r.pbabip_l) * splits.pitchingPctVsL + zero(r.pbabip_r) * splits.pitchingPctVsR;
  const ctrlBlend = zero(r.ctrl_l) * splits.pitchingPctVsL + zero(r.ctrl_r) * splits.pitchingPctVsR;

  const pitching =
    (isSP ? stfBlend + 5 : stfBlend) * w.stuff +
    movBlend * w.movement + pbabipBlend * w.pbabip + ctrlBlend * w.control +
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

  // --- SP/RP: on-field role classification from stamina/pitch-mix, distinct
  // from the isSP check above (which uses the player's real assigned position
  // to decide the Pitching formula's starter bonus). This is a display label,
  // not a formula input.
  const sp_rp: string =
    battingP > pitchingP ? "" :
    (zero(r.stm) <= w.sp_rp_stamina_threshold || qpp < w.sp_rp_min_pitches) ? "RP" : "SP";

  // --- Role: position-player role grouping. See ROLE_BUCKET_THRESHOLDS
  // above for the full rationale. Priority order (first match wins) is the
  // real defensive spectrum: C -> SS -> CF -> INF (2B/3B) -> COF -> 1B -> DH.
  let role: string;
  if (r.pos === "SP" || r.pos === "RP" || r.pos === "CL") {
    role = sp_rp;
  } else if (isCatcherRole) {
    role = "C";
  } else if (isSSRole) {
    role = "SS";
  } else if (isCFRole) {
    role = "CF";
  } else if (zero(r.ifr) >= ROLE_BUCKET_THRESHOLDS.inf_range) {
    role = "INF";
  } else if (Math.max(zero(r.pot_lf), zero(r.pot_rf)) >= ROLE_BUCKET_THRESHOLDS.cof_pot && zero(r.ofr) >= ROLE_BUCKET_THRESHOLDS.cof_range) {
    role = "COF";
  } else if (zero(r.pot_1b) >= ROLE_BUCKET_THRESHOLDS.first_base_pot) {
    role = "1B";
  } else {
    role = "DH";
  }

  // --- TBL Pos: which defensive positions this player projects to handle.
  const tblPos =
    ph === "P"
      ? sp_rp
      : [
          zero(r.pot_c) >= TBL_POS_THRESHOLDS.c ? "C" : "",
          zero(r.pot_1b) >= TBL_POS_THRESHOLDS.other ? "1B" : "",
          zero(r.pot_2b) >= TBL_POS_THRESHOLDS.other ? "2B" : "",
          zero(r.pot_3b) >= TBL_POS_THRESHOLDS.other ? "3B" : "",
          zero(r.pot_ss) >= TBL_POS_THRESHOLDS.other ? "SS" : "",
          zero(r.pot_lf) >= TBL_POS_THRESHOLDS.other ? "LF" : "",
          zero(r.pot_cf) >= TBL_POS_THRESHOLDS.other ? "CF" : "",
          zero(r.pot_rf) >= TBL_POS_THRESHOLDS.other ? "RF" : "",
        ].filter(Boolean).join(" ");

  // --- Platoon: handedness-split value gap, using the same weighted formula
  // shape as Batting/Pitching but fed by vL/vR split grades.
  const battingPitchingSide = (side: "l" | "r") =>
    ph === "P"
      ? zero(side === "l" ? r.stf_l : r.stf_r) * w.stuff +
        zero(side === "l" ? r.mov_l : r.mov_r) * w.movement +
        zero(side === "l" ? r.ctrl_l : r.ctrl_r) * w.control +
        zero(r.stm) * w.stamina + qp * w.qp_multiplier
      : zero(side === "l" ? r.cntct_l : r.cntct_r) * w.contact +
        zero(side === "l" ? r.gap_l : r.gap_r) * w.gap +
        zero(side === "l" ? r.pow_l : r.pow_r) * w.power +
        zero(side === "l" ? r.eye_l : r.eye_r) * w.eye +
        zero(r.speed) * w.speed;

  const vsL = battingPitchingSide("l");
  const vsR = battingPitchingSide("r");
  let platoon = "";
  if (ph === "P" && vsR >= 60 && vsL >= 60) platoon = "";
  else if (ph === "P" && vsR - vsL > 3) platoon = "RH Platoon";
  else if (ph === "P" && vsL - vsR > 3) platoon = "LH Platoon";
  else if (vsR >= 50 && vsL >= 50) platoon = "";
  else if (vsR - vsL > 3) platoon = "RH Platoon";
  else if (vsL - vsR > 3) platoon = "LH Platoon";

  return {
    weights_id: w.id,
    batting, batting_p: battingP, fielding,
    pitching, pitching_p: pitchingP, qp, qpp,
    c_rating: cRating, inf_rating: infRating, of_rating: ofRating,
    overall, potential, prospect_potential: prospectPotential,
    ph, role, sp_rp, tbl_pos: tblPos, platoon,
  };
}
