# System Rankings Methodology

**Purpose:** reference for how `scripts/compute-team-ratings.ts` scores and ranks each org's farm system (`team_computed.minors_rank` and friends, shown on the System Rankings table next to Top Prospects). Proposed and approved by Rees 2026-08-31; implemented the same day. Read this before changing the weights, cutoffs, or formula shape below — it's the rationale, not just the numbers.

## 1. What this replaced

The original methodology (a straight port of the old Power BI "RLB" system) took each org's top 20 prospects (by league-wide `prospect_org_rank`) and just **averaged** their `prospect_potential`. Batting and pitching got their own separate top-10 averages, but those were purely informational — nothing about the main ranking depended on whether a system had both.

That had three real gaps:

1. **No reward for star power specifically.** A system with three 90-grade elite prospects and seventeen replacement-level ones averaged out identically to twenty consistently-good-but-unspectacular prospects.
2. **No reward for depth beyond the cutoff.** The 21st-best prospect in a stacked system counted for nothing, and quality differences among the 6th–20th prospects got fully absorbed into one number with no visibility into where the value actually sat.
3. **No balance requirement.** A system that's all bats and no arms (or vice versa) ranked purely on its org-wide top-20 average — nothing cost a team anything for being one-sided.

## 2. The building block: Blue-Chip + Depth

Within one org's one H/P split (all its hitters, or all its pitchers, from the existing league-wide prospect pool — same population `prospect_org_rank !== null` already defined, just re-ranked within the split since no stored "rank within org+ph" column existed), rank prospects by `prospect_potential` descending, then split the list into two pieces scored differently:

- **Blue-Chip Score** = sum of `prospect_potential` for the top `blue_chip_cutoff` (default 3). Undiluted star power — a true difference-maker at #1 moves this a lot; three merely-good prospects don't.
- **Depth Score** = sum of `prospect_potential ÷ (rank − blue_chip_cutoff)` for everyone ranked lower. The next-best prospect after the cutoff counts in full, the one after that at half, the one after that at a third, and so on — every legitimate prospect keeps contributing, just at a fair discount the further down the list they sit.

**Split Score** (Batting or Pitching) = Blue-Chip Score + Depth Score.

Both pieces are **summed, not averaged** — deliberate, and the whole reason this replaces the old approach. An average is bounded by group size and can never reward an org for simply *having more* good prospects; a sum can keep growing with real depth without needing an arbitrary cutoff like "top 20."

## 3. Combining into the overall System Score — balance comes first

```
System Score = (Batting Score + Pitching Score) − balance_penalty × |Batting Score − Pitching Score|
```

`balance_penalty` (default `0.25`, a real, tunable coefficient — see §5) means a system pays a real cost for the *gap* between its two sides, not just for being weak overall. A missing split is treated as a real `0`, not excluded — an org with real hitting prospects and zero pitching prospects is about as lopsided as it gets and should be scored (and penalized) as such.

**Verified against real data before shipping** (refresh_run_id 24): Steam had the league's 2nd-highest *raw* batting+pitching total (1091.4) but a batting/pitching gap that cost it 21.5 points under the penalty (→ 1069.9, dropping from a top-2 raw ranking to 17th once depth and balance were both accounted for). Roosters, a much more balanced system (Balance Index 0.98), lost almost nothing (−2.6) and ranked #1.

## 4. Supporting metrics (not part of the main rank)

- **Balance Index** = weaker split ÷ stronger split, 0–1 (1 = perfectly balanced) — a plain, honest "how lopsided is this system" number, shown alongside Minors Rank but not itself part of the ranking math (the penalty in §3 already is). Null when an org has no prospects in either split.
- **Readiness Score** = the same Blue-Chip + Depth shape (§2), batting + pitching summed, but using *current* `overall` instead of `prospect_potential` — "how much of this system's value is already realized, not just projected." No balance penalty here; that concept is specific to the ceiling-based main ranking.
- **`team_ovr` / Roster Rank** (avg Overall of an org's top 18 players league-wide) is **unchanged and out of scope** — it's current MLB roster strength, a different concept from farm-system ranking.

## 5. Where the coefficients live

`system_rank_weights` table (mirrors `rating_weights`' pattern exactly — a database row, not hardcoded, so methodology can be tuned/tested without a code change): `blue_chip_cutoff` (default 3), `balance_penalty` (default 0.25), plus `label`/`is_active`/`notes`/`created_at` for the same versioned-testing story `rating_weights` already supports. `team_computed.system_rank_weights_id` records which row produced a given set of scores, same provenance pattern as `player_computed.weights_id`.

**These starting defaults are a first pass, not a final answer** — same spirit as `rating_weights`' own "starting point for methodology testing, not assumed correct long-term" note. Worth revisiting once the rebuilt System Rankings page has been looked at with real eyes for a while.

## 5a. Displaying the breakdown on the System Rankings cards (2026-08-31)

The rebuilt `/TBL/prospects/farms` page shows Blue-Chip, Depth, and Balance as their own visible grade words (not numbers, per Rees's spec) alongside the four ranks.

- `team_computed.blue_chip_score`/`depth_score` store the batting+pitching-**combined** Blue-Chip and Depth totals separately — purely a display decomposition of numbers that already summed into `minor_league_batting_rating`/`minor_league_pitching_rating`, not a new calculation.
- **All three — Blue-Chip, Depth, AND Balance — are graded by the same percentile-among-orgs calibration** (a fresh, round 5-band scale — top 10% Elite, next 20% Plus, middle 40% Average, next 20% Below Average, bottom 10% Well Below Average — deliberately NOT the player-level 20-80 grade-word table, since these are league-relative standings, not individual 20-80 tool grades).
- **Same-day back-and-forth on Balance specifically, worth knowing about if this ever comes up again:** Balance briefly used an ABSOLUTE fixed-threshold scale instead (≥0.90 Elite, ≥0.75 Plus, etc.), reasoning that a 0-1 ratio has real meaning on its own unlike the arbitrary-unit Blue-Chip/Depth sums. That produced a concrete, real problem Rees caught immediately: Steam graded "Plus" balance despite a #3 batting rank next to a #27 (of ~32) pitching rank — a genuinely lopsided system by any competitive measure, whose raw ratio (0.85) just happened to still clear the absolute "Plus" bar because the whole league's actual spread is tight this season (0.85–0.98, nobody drastically imbalanced). **Reverted the same day**: Balance is percentile-based like the other two, on Rees's explicit call that it should reflect standing relative to the rest of the league, not an absolute ratio in isolation — consistent with how Blue-Chip/Depth already worked. If a future season produces a genuinely wide spread of balance indices, grades will naturally look more differentiated in absolute terms too; this is the same mechanism as Blue-Chip/Depth, not a special case.

## 6. What's unchanged

- The underlying prospect population (league-wide prospect pool, scoped to each org) — same players who'd have counted under the old methodology.
- `prospect_potential` and `overall` as the raw ingredients — no new player-level metric was invented for this.
- `team_ovr` / `roster_rank` (current MLB roster strength).
- Column names on `team_computed` (`minors_rank`, `batting_prospect_rank`, `pitching_prospect_rank`, `tbl_readiness_rank`) — same names, recomputed via the new formula, so no existing consumer of these ranks needed to change.
