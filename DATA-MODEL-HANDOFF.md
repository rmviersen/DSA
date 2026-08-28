# Data Model Handoff — start here if you're a new agent picking up backend/data-model work

**Who this is for:** a fresh Claude Code session taking over database/schema/rating-engine work from a prior session, specifically — not Cursor (front-end) and not someone extending existing pages. If you're building UI, read [`HANDOFF.md`](HANDOFF.md) instead; it's written for that.

**Why this doc exists:** `HANDOFF.md` is the real, continuously-maintained backend→front-end contract and has the full history of everything — but it's 270+ lines written for Cursor, and most of it (card layouts, colors, hover states, fonts) has nothing to do with the data model. This doc is a shorter front door: what to read, what already works, what's actually still open, and the gotchas that will bite you if you skip them. It intentionally doesn't duplicate anything — it points into the real docs.

## 1. What DSA is, in 3 sentences

DSA replaces a Power BI dashboard that visualized player ratings, prospect rankings, team rankings, and draft boards for an OOTP Baseball online league ("TheBigLeague"). It pulls live data from StatsPlus (a third-party web platform the league runs through) into a Supabase Postgres database, computes a proprietary rating system (ported from the original Power BI DAX formulas into TypeScript) over that data, and serves it through a Next.js front end at `dsa-reports.com`. You (the backend session) own the database, the ingestion/compute pipeline, and the rating engine itself — not the UI.

## 2. Read in this order

1. `C:\Dev\OOTP-Analysis\CLAUDE.md` — project-wide working norms (plain-English explanations, small scoped changes, sign-off before non-trivial work — this applies to you too) and the top-level project map. Should already be loaded automatically as project instructions.
2. This doc.
3. [`lib/database.types.ts`](lib/database.types.ts) — the actual current schema, ground truth, auto-generated. Trust this over any hand-written schema doc, including this one.
4. [`HANDOFF.md`](HANDOFF.md) §4 ("Data model — what actually exists") and §6 ("Gotchas already discovered") — the parts of that doc that are actually about the data, not the UI. Worth reading in full once; it's dense but everything in it was learned the hard way.
5. [`power-bi-rating-system-analysis.md`](../power-bi-rating-system-analysis.md) (parent dir) — the original Power BI rating engine, reverse-engineered formula by formula, plus the harmonization decisions made when porting it. Read this before touching `lib/rating-engine.ts`.
6. [`statsplus-api-inventory.md`](../statsplus-api-inventory.md) (parent dir) — every StatsPlus endpoint, what it returns, auth requirements. Read before writing any new ingestion code.
7. [`schema-design.md`](schema-design.md) — historical reasoning only, already flagged stale at its own top. Useful for "why does this table look like this," not for exact current structure.

## 3. What already works (don't re-derive or rebuild)

- **Ingestion**: `scripts/refresh.ts` pulls everything from StatsPlus into the three-layer schema (raw reference data, raw time-series snapshots, computed output), tagged by `refresh_run_id`. Validates session cookies before writing anything (all-or-nothing).
- **Rating engine**: `lib/rating-engine.ts` (pure functions) + `scripts/compute-ratings.ts` (orchestration — pulls data, calls the engine per player, writes `player_computed`, `upsert` not `insert` as of 2026-08-27 so a re-tune can safely recompute an already-computed run) + `scripts/compute-team-ratings.ts` (`team_computed`). Weight coefficients live in the `rating_weights` table, not hardcoded — this is deliberate, so methodology can be tuned without a code change (see the catcher/SS/CF batting-multiplier saga in `HANDOFF.md` gotchas 23-27, or the more recent Contact/Control floor-gate saga in gotcha 30, for worked examples of how a re-tune actually happens in this system: add/adjust a `rating_weights` column, verify against real players to full float precision, check the Role Representation diagnostic on `/glossary` for the population-level effect).
- **Draft class tracking**: manually-imported OOTP exports (`draft_class_imports`/`draft_class_pool_members`) give the exact roster of a given draft class, because StatsPlus's own `draft_eligible` flag isn't scoped to one class.
- **Full history backfill**: 2001–2031 season stats were pulled in a background run kicked off 2026-08-18 — confirm it actually completed (check `refresh_runs` for the run with the widest year coverage) before assuming full history is available; this was flagged as unconfirmed as of the last check.
- **Security**: RLS is on, default-deny, every table, service-role key only, server-side only. This is permanent, not a placeholder — see `HANDOFF.md` §3 for why. Any new table needs its own explicit `enable row level security` — it does not inherit this automatically.

## 4. Data-model gotchas that will actually bite you (full list + backstory in `HANDOFF.md` §6)

- **No foreign keys between `player_computed`/`player_ratings_snapshots`/stat snapshot tables.** Fetch separately, join in JS or raw SQL — Supabase's automatic embedding will fail between any two of these.
- **`.select()` caps at 1000 rows by default.** Always paginate with `.range()` (or the existing `fetchAll()` helper) over any table that might exceed that — `players` alone is ~45,800 rows.
- **Always `.order()` an unfiltered/lightly-filtered paginated query**, or row order (and even completeness, across a multi-page loop) isn't guaranteed.
- **League level codes**: `0`=unassigned, `1`=MLB, `2`=AAA, `3`=AA, `4`=A+, `5`=A-, `6`=Rookie, and a synthetic `7`=International (see next point). Use `levelLabel()`/`effectiveLevel()`, don't assume the raw integer.
- **International/complex signees hide inside the MLB roster** — `level=1`, same `team_id` as the org's real MLB team, distinguished only by a **negative `league_id`** (confirmed `-200` for org 15; not yet confirmed as the exact convention for every org). Any code reading `players.level` directly for logic that should exclude these players needs to go through the `effectiveLevel(level, league_id)` remap instead, or it'll misclassify them as MLB-level.
- **`players.is_active` is level-1-only** — every row at level 2-6 has it `false` unconditionally. Never use it as a blanket "active roster" filter across all levels.
- **A "prospect" is not "anyone with no org."** Free agents only count if they have a real `last_team_id` (previously rostered), rookie-eligible (`mlb_service_days < 45`), **and (as of 2026-08-27) age ≤ 25**. This filter already lives in `compute-ratings.ts` — trust `player_computed.prospect_rank IS NOT NULL`, don't re-derive it from raw `players` fields.
- **A player can have multiple stat rows for the same year, even the same level** (promotions/demotions, or two stints at the identical level). Always group/sum by `level_id`, never assume one row per player-level-year.
- **`player_fielding_stats_snapshots` uses `split_id=0` for "overall"; batting/pitching use `split_id=1`.** Filtering fielding the batting/pitching way silently returns zero rows, no error.
- **Handedness splits** (batting `split_id`: 1=overall/2=vs-L/3=vs-R; same convention for pitching) are reverse-engineered, not documented by StatsPlus — see gotcha 21 in `HANDOFF.md` before touching anything split-related.
- **StatsPlus's `lid` param is a trap in two opposite directions**: player-level stat endpoints need it looped explicitly per level or they silently scope to MLB only; team-level stat endpoints ignore it entirely and only ever return MLB teams. Full details in `statsplus-api-inventory.md`.
- **Overall/Potential/Prospect Potential are rounded to the nearest 5 for any display a non-owner could see** (`roundGrade()`), to keep other league GMs from reverse-engineering exact scout grades. This is display-only — never applied before storing or ranking. If you build a new export or report, check whether it needs this.

## 5. What's actually still open (candidates for "re-tooling the analytics")

From `HANDOFF.md` §4 and `CLAUDE.md`'s tracked open items, as of 2026-08-27:

- **Team financials**: payroll is not simply `SUM(contracts.salary0)` — retained salary on trades breaks a naive sum, and this hasn't been solved yet. No design work has started.
- **Win/loss-based team power rankings**: needs league-average-by-level-and-year stat normalization, not built. The prospect side (`team_computed`'s minors/pitching/batting/readiness ranks) is done; this is the actual win/loss performance side, which is a different, unstarted piece.
- **Player OPS+/FIP-**: same normalization dependency as above — currently `/prospects`' FIP uses a fixed placeholder constant (`FIP_CONSTANT = 3.10` in `lib/queries.ts`) instead of this league's real run environment.
- **Pre-draft amateur scouted grades**: draft class *membership* is solved (manual import), but there's no real ingestion path yet for their actual ratings.
- **Player acquisition method** (drafted/traded/international/waivers/Rule 5/scouting discovery): confirmed available on StatsPlus but only per-player-profile-page, no bulk endpoint — scraping all ~45,800 players isn't reasonable at the existing polite throttle (~19 hours). Deliberately held off pending a scoping decision (e.g., top prospects only, or one org).
- **Game box scores / play-by-play**: confirmed scrapable from StatsPlus's static HTML reports, deliberately deferred until after core parity.
- **Rating-engine methodology itself**: the catcher/SS/CF batting-multiplier work (`HANDOFF.md` gotchas 23-27) is one example of active re-tuning; the **Contact/Control "floor gate" + age-developed threshold (`HANDOFF.md` gotcha 30, 2026-08-27)** — a make-or-break-tool penalty, age-aware so a still-developing young player's current Overall isn't punished for a tool that hasn't caught up yet — and the **Potential handedness-split projection (`HANDOFF.md` gotcha 32, 2026-08-28)** are the two most recent. The latter extrapolates a full Potential L/R split profile per player (new `player_projected_splits` table) from each player's own real current L/R relationship, then blends Potential by real league handedness exposure the same way Current already was — this is what closed a real anomaly (Overall > Potential for some players) down to zero league-wide. An SS/CF-specific fielding-side treatment was also flagged as a natural next step in gotcha 26, not yet done. The Role Representation diagnostic on `/glossary` is the tool for checking whether any given weight change is landing proportionally or not.
- **Full 2001-2031 backfill**: ✅ confirmed complete 2026-08-27 — refresh_run_id 9 has real batting-stat rows for all 31 years (2001-2031, 223k rows), not just the usual 3-season window. Safe to rely on for the win/loss and OPS+/FIP- normalization work above.
- **Prospect-pool definition changed 2026-08-27**: now requires age ≤ 25 in addition to the existing `mlb_service_days < 45` rookie-eligibility check (previously age wasn't a factor at all — a technically-rookie-eligible career journeyman in his late 20s/30s could count as a "prospect"). Pool size dropped from ~9,266 to 8,064. See `HANDOFF.md` gotcha 30.

## 6. Running it / connecting

See `HANDOFF.md` §3 and §7 for Supabase connection details and the local dev setup — unchanged, not repeated here.
