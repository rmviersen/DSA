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
  age: number | null;
  cntct: number | null; gap: number | null; pow: number | null; eye: number | null; ks: number | null;
  pot_cntct: number | null; pot_gap: number | null; pot_pow: number | null; pot_eye: number | null; pot_ks: number | null;
  speed: number | null;
  cblk: number | null; cfrm: number | null; carm: number | null;
  ifr: number | null; ife: number | null; ifa: number | null; tdp: number | null;
  ofr: number | null; ofe: number | null; ofa: number | null;
  stf: number | null; mov: number | null; pbabip: number | null; ctrl: number | null; stm: number | null;
  pot_stf: number | null; pot_mov: number | null; pot_pbabip: number | null; pot_ctrl: number | null;
  // HRA -- not read into any formula below (it's folded into StatsPlus's own
  // Movement grade as a composite, per Rees 2026-08-27 -- see mov's comment
  // above), but added 2026-08-28 alongside the projected-split work below so
  // its own real L/R split can still be projected and stored like every
  // other tool grade, per Rees's explicit ask.
  hra: number | null; pot_hra: number | null;
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
  hra_l: number | null; hra_r: number | null;
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
  contact_gate_mid_threshold: number; contact_gate_mid_multiplier: number;
  contact_gate_low_threshold: number; contact_gate_low_multiplier: number;
  control_gate_mid_threshold: number; control_gate_mid_multiplier: number;
  control_gate_low_threshold: number; control_gate_low_multiplier: number;
  developed_age_threshold: number;
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
  // Projected Potential L/R splits (2026-08-28, Rees's spec) -- StatsPlus
  // never exposes pot_*_l/pot_*_r, so these are extrapolated from each
  // player's own real CURRENT l/r/flat relationship (see
  // projectPotentialSplit's comment for the method). Written to their own
  // `player_projected_splits` table by scripts/compute-ratings.ts, not
  // player_computed -- keeps this auditable/inspectable on its own, matching
  // the sibling-table pattern already used for raw snapshots (gotcha 1).
  projectedSplits: {
    cntct: SplitPair; pow: SplitPair; eye: SplitPair; gap: SplitPair; ks: SplitPair;
    stf: SplitPair; mov: SplitPair; ctrl: SplitPair; hra: SplitPair; pbabip: SplitPair;
  };
}

export interface SplitPair { l: number; r: number }

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

// Extrapolates a hidden Potential L/R split from the real, observed CURRENT
// L/R/flat triple plus the known flat Potential value (2026-08-28, Rees's
// spec). StatsPlus never exposes pot_*_l/pot_*_r -- only one flat Potential
// number -- so this is a genuine estimate, not a recovery of ground truth:
// every raw grade here is itself a rounded proxy for a hidden continuous
// value, and this can only carry the CURRENT relationship forward, not
// observe the true future one directly.
//
// Two things are assumed to persist unchanged from current into potential:
// (1) the raw L-R differential itself (`d`), and (2) WHERE the flat number
// sits relative to L and R, expressed as a fraction `t` computed EXACTLY
// from real current data (t=0 means flat behaves like R, t=1 means it
// behaves like L, anything between is a genuine blend) -- not assumed to be
// a fixed convention. Confirmed empirically 2026-08-27/28 that this varies
// by player AND by field for the same player (e.g. flat matches R for one
// player's Power, L for another's) -- there is no single rule like "flat is
// always the vs-RHP grade," so `t` has to be derived per player per field,
// not hardcoded.
//
// Both conditions hold EXACTLY by construction once `t`/`d` are fixed:
// pot_L - pot_R always equals the real current differential, and
// interpolating pot_L/pot_R by that same `t` always reproduces pot_flat
// exactly -- no residual "which one do I pick" ambiguity in that part. `t`
// is clamped to [0,1] as a guard against rounding noise pushing current
// flat slightly outside the [L,R] range (independent per-field rounding can
// do this) -- an out-of-range `t` would only overextend WHERE pot_L/pot_R
// sit, never the differential itself, which stays exactly `d` regardless.
export function projectPotentialSplit(
  currentFlat: number | null, currentL: number | null, currentR: number | null, potentialFlat: number | null
): SplitPair {
  const flat = zero(potentialFlat);
  if (currentFlat == null || currentL == null || currentR == null || potentialFlat == null) {
    // No split data (or no potential value at all) to project from --
    // fall back to flat on both sides rather than assuming a differential
    // that isn't actually observable for this player/field.
    return { l: flat, r: flat };
  }
  const d = currentL - currentR;
  if (Math.abs(d) < 1e-9) return { l: flat, r: flat }; // no real current split -- avoid a 0/0 `t`
  let t = (currentFlat - currentR) / d;
  t = Math.max(0, Math.min(1, t));
  return { l: flat + (1 - t) * d, r: flat - t * d };
}

// Two-tier "floor gate" for a make-or-break tool (Rees 2026-08-27, revised
// same day from an initial single continuous ramp to this explicit step
// function after reviewing real verified results): a player with an elite
// secondary skill set (e.g. Power/Eye, or Stuff/Movement) but a genuinely
// unplayable primary tool (Contact for hitters, Control for pitchers) was
// scoring far too high under the plain weighted sum below -- e.g. a real SP
// with Control 30 ranked as the league's #13 prospect purely off Stuff.
// Above `midThreshold`: no penalty. At/below `midThreshold` (down to,
// exclusive, `lowThreshold`): multiply the whole Batting/Pitching number by
// `midMultiplier`. At/below `lowThreshold`: the harsher `lowMultiplier`
// instead. Deliberately keyed on Contact/Control ALONE, not blended with
// avoid_ks -- Contact is already StatsPlus's own internal composite of
// Avoid-Ks and BABIP, so averaging it with the separate `ks` field would
// double-count the same underlying weakness. Control, by contrast, is
// confirmed a standalone raw grade (Movement is the one that's a composite,
// of PBABIP and HRA -- not gated here).
//
// `atThresholdPenalized` controls whether a grade sitting EXACTLY at a
// threshold takes that tier's penalty or is exempt -- the two gates
// deliberately differ here, per two separate explicit Rees specs:
// Contact keeps the original inclusive rule (default `true`) -- "a real,
// proven Contact-40 performer still takes this light penalty, not a free
// pass" (2026-08-27). Control was simplified to a single tier and made
// EXCLUSIVE at its threshold instead (2026-08-28, passed as `false` at its
// call sites) -- "remove the gate at the blended rate of 40, just leave the
// 0.9 penalty for anyone under 40." Found the hard way: with the shared
// strict `>` this function used to hardcode, Jimmy Gant's projected
// Potential Control landed EXACTLY on 40 (no platoon split at all on that
// grade), so collapsing Control to one tier without this flag would have
// caught him in the penalty band instead of exempting him -- the opposite
// of what the simplification was for.
const gate = (
  grade: number, midThreshold: number, midMultiplier: number, lowThreshold: number, lowMultiplier: number,
  atThresholdPenalized: boolean = true
) => {
  const clearsMid = atThresholdPenalized ? grade > midThreshold : grade >= midThreshold;
  if (clearsMid) return 1;
  const clearsLow = atThresholdPenalized ? grade > lowThreshold : grade >= lowThreshold;
  return clearsLow ? midMultiplier : lowMultiplier;
};

const countAtLeast = (threshold: number, ...grades: (number | null)[]) =>
  // Explicit <number> on reduce (2026-08-24): without it, TS infers the
  // accumulator's type ambiguously enough to widen it to `number | null`,
  // which cascades into every downstream user of qp/qpp reading as possibly
  // null even though this function can only ever return a real count. Not
  // just a cosmetic type-check nit -- `next build`'s type-check step (which
  // `tsc --noEmit` alone doesn't exactly mirror) treats this as a hard
  // compile error and blocks the production build entirely.
  grades.reduce<number>((n, g) => n + (g !== null && g >= threshold ? 1 : 0), 0);

export function computeRatings(
  r: RatingsInput, w: WeightSet, splits: HandednessSplits,
  // Role -> relative fielding-weight multiplier (fielding_role_weights,
  // computed by scripts/compute-fielding-weights.ts). Optional so existing
  // callers/tests that don't pass one keep today's flat w.fielding
  // behavior exactly (every role effectively gets multiplier 1).
  fieldingWeights?: Record<string, number>
): ComputedRatings {
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
  // has no _l/_r fields in this data and stays unsplit. Potential was
  // deliberately left as the flat pot_* fields through 2026-08-27 -- there
  // was no pot_*_l/pot_*_r data to blend. As of 2026-08-28, Potential DOES
  // blend too, using a projected split extrapolated from real current data
  // (see projectPotentialSplit and its use further down).
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

  // Age-gating for the Contact/Control floor gates (2026-08-27, Rees): a
  // young player's CURRENT Contact/Control grade often just reflects where
  // he is in development, not a real ceiling problem -- three real cases
  // that drove this (Gant 22, Vasquez 23, Joyner 24) were all getting their
  // current Overall crushed by the two-tier gate below despite being nowhere
  // near a finished product. "Developed" (age > developed_age_threshold)
  // still gets the gate on BOTH current and potential, same as before this
  // change -- confirmed against Suzuki (age 33), the one case where the
  // current-side penalty is actually deserved. Unknown/null age defaults to
  // developed (the conservative side -- ?? Infinity always fails the "<=
  // threshold" developing check). Deliberately matches the prospect-pool age
  // cutoff (age <= 25) added the same day, via the same rating_weights value.
  const isDeveloped = (r.age ?? Infinity) > w.developed_age_threshold;

  // Projected Potential L/R splits (2026-08-28, Rees's spec) -- see
  // projectPotentialSplit's comment for the full method and its limits.
  // Potential now blends by the SAME real league handedness exposure as
  // Current, instead of reading the flat pot_* field directly -- this is
  // what actually resolves cases like Jeremy Porten's (Overall 83.3 >
  // Potential 82.6, 2026-08-27): that anomaly existed only because Current
  // was handedness-blended and Potential wasn't, an asymmetry that's gone
  // now that Potential has real (extrapolated) split data of its own.
  // projCntct/potCntctBlend computed up here (ahead of the other batting
  // projections below) specifically so the Contact gate just below can use
  // the SAME blended value Potential's own formula uses, not the flat field.
  const projCntct = projectPotentialSplit(r.cntct, r.cntct_l, r.cntct_r, r.pot_cntct);
  const potCntctBlend = projCntct.l * splits.battingPctVsL + projCntct.r * splits.battingPctVsR;

  // Contact floor gate -- current uses the same handedness-blended Contact
  // value that already feeds battingRaw; Potential uses the SAME KIND of
  // blend, just built from the projected potential split instead of the
  // current one (2026-08-28 -- previously read the flat pot_cntct field
  // directly, which briefly reintroduced a smaller version of the exact
  // asymmetry this whole feature exists to close: a developed player whose
  // blended CURRENT Contact sits a point or two above the gate threshold
  // while flat POTENTIAL Contact sits exactly on it would pass the current
  // gate but not the potential one, even though the underlying grades
  // weren't meaningfully different -- caught in 73 real hitters after the
  // projected-split work landed, all developed veterans with Contact sitting
  // right on a threshold). The potential-side gate is UNCONDITIONAL -- it
  // always applies regardless of age. Revised 2026-08-27 (same day, second
  // pass): a developing player's current-side gate is no longer fully
  // exempted -- instead it reuses the SAME gate value as Potential (the
  // "future rating"), rather than being independently computed from his own
  // (still-immature) current grade. This fixes a real interaction found in
  // testing: Potential can never be graded below current-demonstrated
  // ability (see the file header's harmonization decision #2), so a
  // fully-exempt, ungated current Overall was sometimes silently
  // floor-masking the entire Potential-side penalty right back out (Vasquez,
  // age 23 -- his ungated current Pitching came in higher than his gated
  // Potential estimate, so Potential got floored back up to match it,
  // erasing the discount). Deriving BOTH current and potential from the same
  // potential-grade-based gate keeps them aligned instead of colliding. A
  // developed player (age > developed_age_threshold) is unaffected -- his
  // current-side gate still comes from his own current grade independently,
  // same as before this revision (confirmed against Suzuki, age 33).
  const contactGateP = gate(potCntctBlend, w.contact_gate_mid_threshold, w.contact_gate_mid_multiplier, w.contact_gate_low_threshold, w.contact_gate_low_multiplier);
  const contactGate = isDeveloped
    ? gate(cntctBlend, w.contact_gate_mid_threshold, w.contact_gate_mid_multiplier, w.contact_gate_low_threshold, w.contact_gate_low_multiplier)
    : contactGateP;

  const battingRaw =
    cntctBlend * w.contact + ksBlend * w.avoid_ks + powBlend * w.power +
    gapBlend * w.gap + eyeBlend * w.eye + zero(r.speed) * w.speed;
  const batting = battingRaw * battingMultiplier * contactGate;

  const projPow = projectPotentialSplit(r.pow, r.pow_l, r.pow_r, r.pot_pow);
  const projEye = projectPotentialSplit(r.eye, r.eye_l, r.eye_r, r.pot_eye);
  const projGap = projectPotentialSplit(r.gap, r.gap_l, r.gap_r, r.pot_gap);
  const projKs = projectPotentialSplit(r.ks, r.ks_l, r.ks_r, r.pot_ks);
  const potPowBlend = projPow.l * splits.battingPctVsL + projPow.r * splits.battingPctVsR;
  const potEyeBlend = projEye.l * splits.battingPctVsL + projEye.r * splits.battingPctVsR;
  const potGapBlend = projGap.l * splits.battingPctVsL + projGap.r * splits.battingPctVsR;
  const potKsBlend = projKs.l * splits.battingPctVsL + projKs.r * splits.battingPctVsR;

  const battingPRaw =
    potCntctBlend * w.contact + potKsBlend * w.avoid_ks + potPowBlend * w.power +
    potGapBlend * w.gap + potEyeBlend * w.eye + zero(r.speed) * w.speed;
  const battingP = battingPRaw * battingMultiplier * contactGateP;

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

  // Projected Control split computed up here (ahead of the rest of the
  // pitching projections below), same reason as Contact above -- the
  // Control gate needs it for its potential-side check.
  const projCtrl = projectPotentialSplit(r.ctrl, r.ctrl_l, r.ctrl_r, r.pot_ctrl);
  const potCtrlBlend = projCtrl.l * splits.pitchingPctVsL + projCtrl.r * splits.pitchingPctVsR;

  // Control floor gate -- same mechanism as the Contact gate above, including
  // the 2026-08-28 fix (potential side now blends the projected Control
  // split, not the flat pot_ctrl field -- see Contact gate's comment for the
  // full rationale). Control is confirmed a standalone raw grade (unlike
  // Movement, which is itself a composite of PBABIP and HRA), so it's gated
  // directly with no blending. Same age-gating as Contact above -- see
  // contactGate's comment for the full rationale (a developing player's
  // current gate reuses Potential's gate value instead of being
  // independently computed or fully exempted).
  // atThresholdPenalized: false (2026-08-28) -- see gate()'s comment. A
  // Control grade sitting exactly at control_gate_mid_threshold (40) is now
  // exempt, not penalized; Contact's two calls below keep the default
  // (true) inclusive-at-threshold behavior, unchanged.
  const controlGateP = gate(potCtrlBlend, w.control_gate_mid_threshold, w.control_gate_mid_multiplier, w.control_gate_low_threshold, w.control_gate_low_multiplier, false);
  const controlGate = isDeveloped
    ? gate(ctrlBlend, w.control_gate_mid_threshold, w.control_gate_mid_multiplier, w.control_gate_low_threshold, w.control_gate_low_multiplier, false)
    : controlGateP;

  const pitchingRaw =
    (isSP ? stfBlend + 5 : stfBlend) * w.stuff +
    movBlend * w.movement + pbabipBlend * w.pbabip + ctrlBlend * w.control +
    zero(r.stm) * w.stamina + qp * w.qp_multiplier;
  const pitching = pitchingRaw * controlGate;

  // Same projected-split treatment as Batting above (2026-08-28). HRA is
  // computed too (for storage/inspection, per Rees's explicit ask) even
  // though it isn't a direct input to Pitching -- StatsPlus folds it into
  // Movement's own composite grade already (see mov's comment), so there's
  // no separate hra-weighted term here to blend into.
  const projStf = projectPotentialSplit(r.stf, r.stf_l, r.stf_r, r.pot_stf);
  const projMov = projectPotentialSplit(r.mov, r.mov_l, r.mov_r, r.pot_mov);
  const projPbabip = projectPotentialSplit(r.pbabip, r.pbabip_l, r.pbabip_r, r.pot_pbabip);
  const projHra = projectPotentialSplit(r.hra, r.hra_l, r.hra_r, r.pot_hra);
  const potStfBlend = projStf.l * splits.pitchingPctVsL + projStf.r * splits.pitchingPctVsR;
  const potMovBlend = projMov.l * splits.pitchingPctVsL + projMov.r * splits.pitchingPctVsR;
  const potPbabipBlend = projPbabip.l * splits.pitchingPctVsL + projPbabip.r * splits.pitchingPctVsR;

  const pitchingPRaw =
    ((isSP ? potStfBlend + 5 : potStfBlend) * w.stuff +
    potMovBlend * w.movement + potPbabipBlend * w.pbabip + potCtrlBlend * w.control +
    zero(r.stm) * w.stamina + qpp * w.qp_multiplier) * controlGateP;
  const pitchingP = Math.max(pitching, pitchingPRaw - 3);

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
  // Moved ahead of Overall/Potential below (2026-08-31) -- previously
  // computed after them, back when Role was purely a display label with no
  // bearing on the formula itself. Now that fieldingWeight (right below)
  // needs to look Role up, it has to exist first. Safe to move: nothing in
  // this block depends on overall/batting/fielding, only on raw grades and
  // sp_rp/battingP/pitchingP, all already computed above this point.
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

  // --- Role-calibrated fielding weight (2026-08-31, Rees's ask) --
  // fieldingWeights is a role -> relative-multiplier map computed by
  // scripts/compute-fielding-weights.ts (fielding_role_weights table),
  // applied on top of the existing flat w.fielding baseline rather than
  // replacing it -- a role sitting exactly at the league-wide average keeps
  // today's behavior unchanged (multiplier 1), only roles with an earned,
  // order-safe signal move away from it. Defaults to 1 (today's flat
  // behavior, unchanged) if no per-role table has been computed yet, or for
  // a role with no entry (pitchers never need one -- the `pitching` branch
  // of the max() below doesn't involve fielding at all).
  const fieldingWeight = w.fielding * (fieldingWeights?.[role] ?? 1);

  const overall = Math.max(batting + fielding * fieldingWeight, pitching);
  const potential = Math.max(battingP + fielding * fieldingWeight, pitchingP);
  const ph: "H" | "P" = batting + fielding * fieldingWeight > pitching ? "H" : "P";

  const isBustRisk = r.prone === "Fragile" || r.prone === "Wrecked";
  const riskAdjusted = isBustRisk ? potential - 5 : potential;
  const prospectPotential = riskAdjusted + overall * 0.25 - 12.5;

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
    projectedSplits: {
      cntct: projCntct, pow: projPow, eye: projEye, gap: projGap, ks: projKs,
      stf: projStf, mov: projMov, ctrl: projCtrl, hra: projHra, pbabip: projPbabip,
    },
    ph, role, sp_rp, tbl_pos: tblPos, platoon,
  };
}
