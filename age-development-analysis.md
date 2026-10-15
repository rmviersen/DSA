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
