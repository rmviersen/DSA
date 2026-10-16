# Age & development analysis (2026-10-15)

Rees's concern: players stop progressing at certain ages, but Potential ratings don't reflect the time left to develop, so
older players (24+) look better than they will become. This document records what the snapshot data says. **Nothing in the
rating engine has been changed by this analysis.** Re-run any time with `npm run analyze-age-development -- <cacheDir>`
(`scripts/analyze-age-development.ts`; read-only, writes nothing to the database).

## Data and method

- **Source:** `player_ratings_snapshots` (the game's own grades) and `player_computed` (our calibrated Overall/Potential), 2031-06-23 through
  2033-02-15, ~45 dated runs. There is a hole from 2032-07-19 to 2032-11-02 (the token outage).
- **Scale caveat:** every game grade (`ovr`, `pot`, each tool and `pot_*` tool) is on 20-80 in **steps of 5** (13 distinct values). Means over
  thousands of players are reliable; single-player changes are coarse. Our calibrated Overall/Potential is continuous, so the gap-closure
  numbers below use it.
- **Why one-year windows:** ratings change in *installments*, not once a year: a late-Jan-Feb tick (27+ drop ~0.4-0.5 on the game's scale,
  younger inch up), a bigger early-April tick (ages 22-26 gain +0.3-0.4), a mid-June tick, and autumn. Nearly nothing moves Oct-Dec. So
  development is measured over **exact one-year windows** that each contain one full cycle: 2031-06-23->2032-06-21, 2031-11-19->2032-11-17,
  2031-12-31->2032-12-31, 2032-01-18->2033-01-16 (10.9k-12.6k players each). Age = age at the window start. All four windows agree.
- **Known bias:** only players present in both snapshots are compared, so players who retired in the window drop out (mostly old), which
  flatters the oldest age groups slightly. Gap-closure shares are conditional on a player still having a gap at that age (stalled players
  are over-represented at older ages).

## Net yearly change in the game's `ovr` (all windows pooled; per-window values agree within ~0.3)

| Age at start | <=20 | 21-22 | 23-24 | 25-26 | 27-28 | 29-30 | 31-33 | 34+ |
|---|---|---|---|---|---|---|---|---|
| Hitters + pitchers | +0.9 | +1.5 | +1.2 | +0.5 | -0.25 | -0.7 | -1.2 | -2.3 |

- **Hitters:** grow through 24 (+1.1/yr), ~+0.35 at 25, **net zero at 26 (-0.2), decline from 26-27**, accelerating at 30+ (-1.4 to -2.0/yr).
  Peak development speed is age 20 (+2.0).
- **Pitchers:** grow through **26** (+0.7 to +1.1/yr), flat/slightly negative from 27 (-0.2), milder decline at 30-33 (-0.5 to -0.95).

## Which tools move when (mean yearly change per tool, 20-80 scale)

- **Hitters:** contact/gap/power/BABIP gain until ~24, are ~0 at 25-26, and fall from 27 (power -0.5, BABIP -0.5 at 27-28; contact from 29).
  **Speed peaks earliest** (~0 growth after 21, declines from 25, -1.8/yr at 31-32). Eye is nearly flat for life; Avoid-K holds to ~31.
- **Pitchers:** stuff gains to ~26 then flat; movement, control and HR-avoidance keep gaining ~+1/yr through 25-26 and are flat at 27-28;
  PBABIP barely moves at any age; stamina drifts down at every age.

## How much of the listed Potential gap actually closes

Yearly share of the *current* gap (Potential minus Overall, players with gap >= 3, our calibrated units) that closes within the next year:

| Age | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Hitters | 6% | 12% | 16% | 21% | 24% | 22% | 20% | **11%** | **3%** | **0%** | 0% | 0% |
| Pitchers | 0% | 3% | 8% | 14% | 17% | 19% | 19% | 17% | 16% | 22% | n/a | n/a |

Chaining those yearly shares gives the **expected share of today's listed gap that is ever realized** (an upper bound: it ignores the game's
extra downward revisions of Potential for stalled players, ~-2 points a year at ages 25-26):

| Current age | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27+ |
|---|---|---|---|---|---|---|---|---|---|---|
| Hitters | 76% | 73% | 67% | 59% | 46% | 31% | **13%** | **3%** | **0%** | 0% |
| Pitchers | 77% | 76% | 74% | 70% | 64% | 55% | **45%** | **34%** | **22%** | ~0% |

(A pitcher at 27+ rarely has a gap left to measure: n<60 with gap>=3.) The ~1.65-year window shows the same pattern (hitters 24-25: ~9% a year).

## Size of the issue today (2033-02-15 pool, players with a listed gap of 3+)

| Group | players | avg listed gap | avg never-realized part |
|---|---|---|---|
| Hitters 24 | 286 | 7.7 | 6.6 |
| Hitters 25 | 186 | 7.7 | 7.4 |
| Hitters 26 | 141 | 6.7 | 6.7 |
| Pitchers 24 | 290 | 9.4 | 5.1 |
| Pitchers 25 | 213 | 9.1 | 6.0 |
| Pitchers 26 | 92 | 6.7 | 5.2 |

So for hitters aged 24+ nearly all of the listed Potential gap is phantom; for pitchers roughly half to two-thirds.

## Not yet done / open questions (decisions for Rees)

1. **No rating change has been made.** A candidate fix is an age-and-type "realization factor" R(age, type) applied to the Potential gap
   (`Potential_adj = Overall + (Potential - Overall) x R`), smoothed from the tables above. Open: where to apply it (engine vs prospect
   Potential vs Draft Value only), and whether Work Ethic / gap size should modify it (earlier analysis found Work Ethic has a small effect).
2. **Backtest before shipping:** apply R to the 2031-12-31 snapshot and compare predicted vs realized Overall at 2032-12-31.
3. **ETA** assumes development continues to a common age; the data says hitters stop ~25 and pitchers ~26-27.
4. Not analyzed: heterogeneity by gap size, position, level, Work Ethic/Intelligence, and a longer WAR-based aging curve (2001-2032) for the
   decline side. The 19-month ratings history limits multi-year conclusions; re-run as history accumulates.

## Backtest and rollout of the age-aware Potential (2026-10-15)

**What was built:** `Potential_adjusted = Overall + R(age, type) x (Potential - Overall)` (`lib/potential-realization.ts`, applied inside
`computeRatings()` so prospect Potential, ETA, ranks, comps and Draft Value all inherit it). R is built from the yearly closure rates above,
chained to the end of development and **normalized at age 19**, so the youngest prospects' Potential is unchanged (only the time-remaining effect
is removed; the long-run payoff for under-20s can't be verified with 19 months of data). The curve lives in `potential_realization_sets/_rows`
(active set per league; none active = no adjustment) and every adjusted player keeps `potential_unadjusted_raw` + `realization_share`.

**Proposed curve (R = share of today's listed gap kept):**

| Age | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 |
|---|---|---|---|---|---|---|---|---|---|---|
| Hitters | 1.00 | 0.93 | 0.82 | 0.65 | 0.45 | 0.22 | 0.08 | 0.04 | 0.03 | 0.02 |
| Pitchers | 1.00 | 0.98 | 0.93 | 0.86 | 0.77 | 0.65 | 0.53 | 0.38 | 0.19 | 0.09 |

**Backtest** (`scripts/backtest-potential-realization.ts`; criteria written before running; curve fitted on one part of the data, judged on data it
never saw: S1 = half the players held out, S2 = whole time windows held out). 31 checks passed, 8 failed.
- **PASS - the checks about the shipped factor (C2/C3/C4):** for hitters aged 24-25, raw Potential overstated the next 1.1-1.65 years of growth by
  **7.0-7.6 points**; the adjusted value is off by **0.15-0.65** (S1) / 0.43 (S2) and its forecast error (RMSE) is 3-4x smaller (2.6 vs 8.6-9.2).
  Hitters 26+ (S2): adjusted bias 0.16 vs 6.3 raw. In every mid-age group (hitters 22-23, pitchers 23-25) the adjusted value forecasts better than raw. Ages 17-19 keep R = 1.00.
- **FAIL - the one-year dynamics check (C1, 8 groups):** the fitted yearly closure is off by more than 0.35 points in some groups: younger hitters and
  pitchers 17-19 under the held-out-windows split (~0.7-1.1) and pitchers 25-26 (+0.71 in one split, -0.76 in the other). The sign flips between
  splits, i.e. the **two development cycles we have differ by roughly +/-25%** and pitchers' mid-20s closure is noisy; no age curve removes that.
  Read it as: R at ages 21-23 is uncertain by about +/-0.1 and pitchers' R at 24-26 by about +/-0.15 (about +/-1.4 Potential points).
- **Tried and rejected:** "version 2" (3-point moving average instead of forcing closure to only fall after 22) backtested WORSE (it blurs the
  hitter cliff: R(24) 0.19 -> 0.27 while realized gains stayed ~0.5) and did not fix pitchers; version 1 was kept.
- **Not verifiable yet:** the ultimate realized share for hitters under ~23 and pitchers under ~25 (an extrapolation; the normalization at 19 limits its impact).

**Dry run on the live pool (nothing written):** Overall identical for all 13,537 rated players; Potential never below Overall; average listed gap
at 24 falls 5.9 -> 2.6, at 25 5.0 -> 1.7, at 26 3.3 -> 0.6. 24 of the top 100 prospects leave and 24 enter (largest drops: 24-25 year-olds with
huge stale ceilings, e.g. a 25-year-old #7 -> #853); the 17-20 year-olds in the top 100 go 12 -> 29; 342 more prospects now show "no projected MLB
arrival". With the tables absent the pipeline's output is byte-identical to before (verified).

**Rollout state:** code is shipped and inert. To switch on: (1) run `pending-migrations/2026-10-15-potential-realization.sql` in the Supabase SQL
editor; (2) `npx tsx scripts/fit-potential-realization.ts <cacheDir> --activate`; (3) `npx tsx scripts/compute-ratings.ts` (latest run; the refresh
chain applies it from then on). Switch off any time: set the active set's `is_active = false`. Historical runs are NOT recomputed by default (the
prospect "Change from" picker would otherwise compare an unadjusted baseline with adjusted ratings); `compute-ratings.ts --all` backfills them.
