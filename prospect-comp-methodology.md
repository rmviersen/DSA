# Prospect Player-Comp Methodology

**Purpose:** reference for the "Comp" feature on the Top Prospects report — for each prospect, the nearest established MLB player match, shown as a new meta item next to Age/Level/ETA on `/prospects` and `/TBL/prospects`. Proposed and approved by Rees 2026-08-31; implemented the same day in `scripts/compute-ratings.ts`. Read this before changing the thresholds, weights, or role scoping below — it's the rationale, not just the numbers.

## 1. The core idea

For each prospect, search a pool of established MLB players and find whichever one's **current** tool grades most closely match the prospect's **potential** grades — matched on the actual shape of the skill set (power/hit/glove/pitch-mix), not just "who's closest in computed Overall," since two players can share an Overall number while looking nothing alike as players.

## 2. Defining "established"

A player qualifies as a comp candidate if he's built up a real MLB track record, summed across **every** refresh run in the database's history (not just the current one — a career total has to look further back than "this refresh"), deduped to the highest `refresh_run_id` per `(player_id, year, stint)` the same way `lib/player-detail-query.ts`'s `latestPerStint` does for the player-detail page's stat history.

- **Hitters:** 1,000+ career MLB at-bats (`COMP_HITTER_MIN_AB` in `compute-ratings.ts`)
- **Starters:** 200+ career MLB innings (`COMP_SP_MIN_IP`)
- **Relievers:** 100+ career MLB innings (`COMP_RP_MIN_IP`)

Lowered from an original 1,500/300/150 the same day (2026-08-31), on Rees's follow-up, specifically to widen the thinner role buckets (C/CF/DH/1B were only 14–20 candidates each at the original bars).

Separate SP/RP thresholds are required, not optional — a bar that works for a starter excludes nearly every real career reliever, since relievers accrue innings far more slowly.

**Real ceiling on the pool, confirmed against production data 2026-08-31, not a design choice:** at the ORIGINAL 1,500 AB bar, 1,260 hitters cleared it, but only ~339 still had a current ratings row in the latest refresh at all — the rest are long-retired players the game itself stopped tracking ratings for (the same gap already documented for retired-player CSV exports elsewhere in this project). This is automatic in the implementation regardless of where the thresholds sit — the established pool is only ever built from players who already have a row in `player_ratings_snapshots` for the refresh being computed, since that's where `computed` (and therefore every candidate) comes from — no separate "has ratings" check was needed. See §3 for the current pool sizes by role at the lowered thresholds.

## 3. Role scoping

Restricted to the **same role bucket** the site already computes every refresh (`player_computed.role`: C, SS, CF, INF, COF, 1B, DH for hitters; SP, RP for pitchers) — reusing existing, already-tuned logic rather than a second position system. A catcher prospect only ever compares against established catchers.

Established pool sizes by role, as of the 2026-08-31 run at the current (lowered) thresholds: RP 314, SP 267, INF 121, COF 97, SS 52, 1B 44, C 38, DH 33, CF 30 — every bucket meaningfully larger than the original 1,500/300/150 thresholds gave (which ranged 14–271; see the git history on this file for those original numbers). CF and DH remain the thinnest, but no bucket is thin in an absolute sense anymore.

## 4. Which grades are compared

The prospect's **potential** grade is used wherever a potential grade exists in this data; the established player's **current** grade is compared against it. For the handful of tools with no potential field at all (speed, stamina, every position-specific defensive sub-grade), **both sides use current value** — that's a hard data-model limitation, not a choice.

| | Prospect side | Established-player side |
|---|---|---|
| Hit tools: contact, gap, power, eye, avoid-Ks | potential | current |
| Speed | current (no potential field exists) | current |
| Defensive sub-grades (see below, role-dependent) | current (no potential field exists) | current |
| Pitch mix: stuff, movement, control, pbabip | potential | current |
| Individual pitches (fastball, slider, etc.) | potential | current |
| Stamina | current (no potential field exists) | current |

**Defensive sub-grades included, by role** (mirrors exactly which sub-grades `rating-engine.ts`'s `cRating`/`infRating`/`ofRating` already use for that position, so the comp agrees with the site's own definition of "good defense at this spot"):
- **C:** blocking, framing, arm (equal weight)
- **SS, INF:** range (double-weighted), error, arm, double-play — matching `infRating`'s own `(ifr*2 + ife + ifa + tdp) / 5`
- **CF, COF:** range (double-weighted), error, arm — matching `ofRating`'s own `(ofr*2 + ofe + ofa) / 4`
- **1B, DH:** none — this data model has no distinct defensive sub-grade for either

**Individual pitches** (fastball/sinker/curve/slider/change/cutter/splitter/forkball/circle-change/knuckle-curve/knuckleball) are only compared when **at least one side actually throws it** (a nonzero raw grade). Two zeros (neither throws it) carries no signal; a real-grade-vs-zero pairing does (one side has a weapon the other doesn't) and is counted.

**Deliberately NOT replicated from the rating engine:** the SP +5 Stuff bonus, the Contact/Control floor gates, and the premium-position Batting multipliers (catcher/SS/CF). Those exist to make Overall a fair single scalar for ranking purposes — folding them into a tool-for-tool similarity comparison would distort it, not improve it.

## 5. Weighting

Every compared dimension is weighted by the **same coefficients already active in `rating_weights`** (`contact`, `power`, `eye`, `gap`, `avoid_ks`, `speed`, `fielding`, `stuff`, `movement`, `control`, `stamina`, `pbabip`) — the identical numbers driving Overall/Potential everywhere else on the site. Two reasons: it keeps the comp philosophically consistent with the site's own definition of "what matters," and it's automatically re-tunable — adjusting `rating_weights` to test a different methodology shifts comps for free, no separate tuning pass required.

Defensive sub-grade weights are the `fielding` weight split according to the same internal ratios the rating engine itself uses (see §4's table) — e.g. for SS/INF, range gets `fielding × 2/5`, each of error/arm/DP gets `fielding × 1/5`.

**Individual pitch grades have no dedicated weight in `rating_weights`** (the engine only counts *how many* pitches clear a quality bar, via `qp`/`qpp`) — each pitch dimension borrows `weights.stuff / 8` as a reasonable, explicitly tunable default (`PITCH_GRADE_WEIGHT` in `compute-ratings.ts`), not a number derived from anything more principled than "a fraction of Stuff, since pitch grades are part of what Stuff represents."

## 5a. Value-gap dimension (2026-08-31, tuned twice the same day)

Comparing raw tool grades alone found real cases where the winning "comp" was someone whose established, fully-realized CURRENT Overall sat nowhere near the prospect's own POTENTIAL — the whole point of a comp is "who does this prospect's *future* look like," so that's backwards. Confirmed concretely on R.J. Blum (Potential 84.35): his comp before this fix was Marty Kilby (Overall 74.35, a 10-point gap) despite Bob Reyes (Overall 84.08, a 0.27-point gap) sitting right there in the same established SP pool. Root cause: Kilby happens to throw the exact same unusual 4-pitch mix as Blum (fastball/sinker/changeup/splitter — most pitchers throw curveball/slider instead), which let raw pitch-mix agreement outweigh the fact that his aggregate ability is a full ceiling-tier below Blum's.

**Fix:** an extra weighted dimension, added alongside the raw tool grades (§4) rather than a hard pre-filter — a fixed tolerance window around the prospect's Potential risked leaving zero candidates in the thinner role buckets (CF/DH) for an unusually high- or low-Potential prospect. The dimension compares the prospect's own computed `potential` against each candidate's computed `overall`, weighted by `COMP_VALUE_GAP_DOMINANCE` times the sum of every other dimension's weight for that specific comparison.

**First pass, same day:** `COMP_VALUE_GAP_DOMINANCE = 10` (value alignment outweighs every raw tool dimension COMBINED by 10×) — chosen by solving, from the real Blum/Kilby/Reyes numbers, the crossover multiplier past which Reyes actually beats Kilby (~8×) and rounding up for a safety margin. This worked (Blum's comp flipped to Al Charles, Overall 80.0, a 4.35-point gap) but overcorrected: value alignment so thoroughly swamped tool-shape that it stopped functioning as a real second input — confirmed by a real symptom Rees caught immediately: **all three top-10 CF prospects (Schall, Navarro, Dukeshire) were landing on the exact same comp** (Morgan Alison), purely because his Overall happened to sit in the "sweet spot" of a sparse 28-player CF pool, with no room left for their genuinely different tool profiles to matter.

**Lowered same day to `COMP_VALUE_GAP_DOMINANCE = 1`** — value alignment now carries exactly as much weight as the entire rest of the tool-grade vector combined (a 50/50 split), not ten times it. Verified against the same real cases: Blum still comps to Al Charles (Overall 80.0 vs. his Potential 84.35 — the value fix still holds, nowhere near reverting to the original 10-point Kilby gap), and the three CF prospects now get three genuinely different comps (Dean Salvucci, Jose Zavala, Morgan Alison) reflecting their actual differing tool shapes. A broader check across the top 50 prospects (all 9 role buckets) found only mild, expected repetition (at most 3 prospects sharing one comp in any bucket, most repeats just 2) — a healthy distribution, not the "everyone gets the same guy" symptom `10` produced.

**Similarity scores returned to a wider, more useful spread** (roughly 58–85% across the top dozen checked) compared to the compressed 70–92% band `10` produced — the `30`-point calibration in §6 below hasn't needed re-tuning against this reversion, but remains worth revisiting on its own terms if real comps ever start looking miscalibrated.

## 6. Distance metric and similarity score

Weighted RMS difference across every applicable dimension, in 20–80-scale grade points:

```
distance = sqrt( Σ weight × (prospectValue − establishedValue)² / Σ weight )
```

Lower distance = closer match. The established player in the same role bucket with the smallest distance is the comp.

Converted to a 0–100 similarity score for display (100 = identical on every compared dimension):

```
similarity = clamp(100 − (distance / 30) × 100, 0, 100)
```

**`30` (`COMP_DISTANCE_FOR_ZERO_SIMILARITY`) is a first-pass calibration, not derived from any real distribution yet** — worth revisiting once a batch of real comps has actually been eyeballed against real players. Verified by hand against one real case (R.J. Blum → Marty Kilby, 56.6% similarity) by manually recomputing the weighted distance from the two players' raw Stuff/Movement/Control/PBABIP/Stamina grades — the manual math landed within rounding of the stored value.

## 7. Where it's computed and shown

Computed once per refresh in `scripts/compute-ratings.ts` (which already loads every player's full ratings snapshot in one pass), written to two new columns on `player_computed`: `comp_player_id` (nullable FK to `players.id`) and `comp_similarity` (nullable 0–100). Not recomputed live on page load, consistent with how Overall/Potential/ETA already work.

Displayed on `/prospects` and `/TBL/prospects` (`ProspectTable.tsx`) as a new "Comp **Name**" meta item next to Age/Level/ETA — visible without expanding the card, matching how Org Rank and Role Rank already display. The similarity percentage is a hover tooltip, not shown inline, so a comp reads as a clean, confident-looking name the way a real scouting report states one, while the number is still one hover away for anyone who wants to gauge how close the actual match is.

Excluded (returns `null`, no meta item rendered): any player who isn't in the prospect pool at all, and in principle a prospect whose role bucket has zero established candidates — not currently observed in real data (every one of the 9 role buckets has real candidates as of the 2026-08-31 run).

## 8. Known limitations, worth revisiting

- **No true "legend" comps.** A long-retired star with no current ratings row can never surface as a comp, only someone the game still actively grades. This is a hard OOTP data-tracking gap (documented elsewhere in this project for retired-player exports), not something this feature can work around.
- **CF and DH are still the thinnest buckets** (30 and 33 established candidates, vs. 38–314 for the others) — a comp there is drawn from a smaller field than most, still real but worth keeping in mind if a specific comp looks like a stretch. This was worse before the 2026-08-31 threshold lowering (14–20 in the thinnest buckets); it's a real, if reduced, structural limit rather than something a further threshold tweak alone fully erases.
- **The similarity-score calibration (`30` → 0%) is a guess**, not fit to a real distribution of distances. If comps start clustering oddly high or low in practice, this is the first knob to revisit.
- **Position granularity is role-bucket-level, not position-exact** (INF lumps 2B/3B together; COF lumps LF/RF together) — a deliberate choice given pool sizes at the time this was built, not a limitation nobody considered.
