# Multi-League Architecture Plan (draft, 2026-09-10)

**Status: proposal — not started.** Written in response to Rees's ask: add a
second league ("Duud", a personal league fed from an OOTP SQL dump instead of
StatsPlus), living at `dsa-reports.com/Duud` alongside the existing league at
`dsa-reports.com/TBL`, same front end, same public/private split preserved.
This is a big, cross-cutting change — every one of the platform's 47 database
tables and nearly every page currently assumes there is exactly one league.
Nothing below has been built. Sign-off needed before starting (see §7).

---

## 1. What I researched: the OOTP SQL dump

OOTP Baseball has a built-in export separate from the CSV files this platform
already reads. In-game: **Game Settings → Database tab → Database Tools →
"Configure SQL dump for MySQL."** That configure screen lets you pick exactly
which internal tables to include (there's also a "dump only cities/nations in
use" option to trim size). Running the export writes a real `.sql` file — a
MySQL script of `CREATE TABLE` + `INSERT` statements, i.e. a snapshot of
OOTP's own internal database — into the same `import_export/` folder inside
the save's directory that the CSV exports already land in
([OOTP manuals](https://manuals.ootpdevelopments.com/index.php?man=ootp16&page=import_export_functions),
[OOTP wiki](https://wiki.ootpdevelopments.com/index.php?title=OOTP_Baseball%3AImportant_Game_Concepts%2FTools%2C_Functions%2C_and_Editors%2FLeague_Functions%2FImport%2FExport_Functions)).

This is not a novel format we'd be reverse-engineering blind: it's the exact
same export mechanism StatsPlus's own self-hosted tooling is built to consume
([StatsPlus SQL Configuration wiki](https://wiki.statsplus.net/web-tools/sql-configuration)) —
in other words, TBL's own current data source (the StatsPlus website at
`atl-02.statsplus.net`) almost certainly started life as someone periodically
running this same export and importing it into a StatsPlus instance. So the
pattern itself is proven; we just haven't seen a real dump file yet.

**What I don't know yet, and can't know without a real sample**: the exact
table and column names inside the dump. It's OOTP's own internal schema
(not StatsPlus's, not ours), and I couldn't find a public schema reference —
only confirmation that the feature exists and where it's configured. **First
concrete step of this project, before any code:** Rees exports a real SQL
dump from the Duud save and hands it over (or its path), so I can read the
actual `CREATE TABLE` statements directly instead of planning against a
guess. Everything in §3 below about the ingestion adapter is written to be
correct in shape regardless of the exact column names, but the real mapping
work can't start without that file.

One more thing worth deciding early: OOTP *also* offers the same CSV export
this platform already knows how to parse (rosters/ratings/stats). The SQL
dump gives more raw tables (presumably including things like transaction
history, game logs) but is a heavier, less-familiar format to build against.
Worth confirming with Rees that the SQL dump is worth that extra build cost
for what he actually wants to see for Duud, versus starting with the CSV
route (which reuses `lib/mappers.ts` almost as-is) and adding the SQL dump
later for anything CSV can't cover. Noted as an open question in §7, not
assumed either way.

---

## 2. The core problem: nothing in this schema knows what a "league" is

Every one of the 47 tables in `lib/database.types.ts` — `players`,
`player_computed`, `player_ratings_snapshots`, `refresh_runs`,
`rating_weights`, `calibration_level_anchors`, `contracts`, `teams`, all of
it — is implicitly scoped to the one league this platform has ever known.
There is no `dsa_league_id` column anywhere. `DEFAULT_ORG_ID = 15` (Oklahoma
City's team id *within* TBL) is hardcoded across several pages, but that's a
*team* inside the one existing league, not a *league* selector — it doesn't
generalize to "which league am I even looking at."

Concretely, adding Duud means:

- **ID collisions.** OOTP's own player/team ids are local to a single save
  file. TBL's player #12345 and Duud's player #12345 are almost certainly two
  unrelated people. A shared `players` table keyed only on `id` would corrupt
  the moment both leagues' data lands in it — this has to be solved with a
  real schema change (composite keys), not just an added filter column.
- **Independent calibration.** `rating_weights` (`is_active=true`) and
  `calibration_level_anchors` are tuned against TBL's specific player pool.
  Duud is a different league with a different talent distribution — it needs
  its *own* active weight set and calibration anchors, not TBL's numbers
  applied to different players. The rating engine's *formula* (`lib/rating-
  engine.ts`) is reusable as-is; the *tuned values* are not.
- **Independent refresh history.** `refresh_runs` (and everything keyed to a
  `refresh_run_id`) currently assumes one sequential history. Two leagues
  need two independent timelines — Duud might refresh monthly from a manual
  SQL dump while TBL keeps refreshing from StatsPlus on its own cadence.

### Recommended approach: one Supabase project, a new `leagues` table, `dsa_league_id` on every table

Considered and rejected: a second Supabase project per league (clean
isolation, but doubles every migration, every RLS setup, every deployment
step, and makes any future cross-league page — e.g. "compare my two leagues"
— much harder). A single project with a `dsa_league_id` foreign key column
everywhere is more schema-migration work up front but is the standard,
maintainable way to do this, and RLS is already default-deny service-role-
only sitewide, so there's no new public-exposure risk from consolidating.

- New `leagues` table: `id`, `slug` (`"TBL"`, `"Duud"` — used directly in
  URLs), `display_name`, `source_type` (`"statsplus"` | `"ootp_sql_dump"`),
  and whatever per-source config each needs (StatsPlus base URL/token vs. a
  dump file path).
- **The new per-row column is named `dsa_league_id`, not `league_id`** — see
  the incident writeup right below this list for exactly why that distinction
  matters and is not just a style preference.
- Every existing table gets a `dsa_league_id` column (not nullable, FK to
  `leagues.id`). Every place a table is keyed by OOTP's own id (`players.id`,
  `teams.id`, etc.) becomes a **composite key** of `(dsa_league_id, id)`, not just
  `id` — this is the part that actually prevents the collision problem above,
  not merely adding the column.
- Every query in `lib/*.ts` that currently has no league concept (nearly all
  of them) needs a `dsa_league_id` parameter threaded through, the same way
  `orgId` already threads through `fetchComputedPlayers`/`getOrgMinorsPlayers`
  /etc. today. Mechanical, but touches most of `lib/`.
- `rating_weights`, `calibration_level_anchors`, `refresh_runs`,
  `fielding_role_weights`, `market_rate_curves`, and every other
  "one active/current row" concept becomes "one active row **per league**."

This is a real migration on live data (TBL's ~24 refresh runs of history
can't be dropped) — §6 covers how to do it without losing anything.

### Incident, 2026-09-10: a real, live data-loss bug during this exact migration — root cause, fix, and the process change coming out of it

While building this step, I made a serious mistake that's worth documenting
in full rather than quietly fixing, per Rees's explicit ask afterward for a
full review, not just a patch.

**What happened.** `players` (and 10 other tables — `contracts`,
`contract_extensions`, `game_box_scores`, `game_results`,
`player_batting_stats_snapshots`, `player_fielding_stats_snapshots`,
`player_pitching_stats_snapshots`, `player_snapshots`, `contract_snapshots`,
`contract_extension_snapshots`) **already had a real column named
`league_id`** before this work ever started — OOTP's own sub-league/level
identifier (200=MLB, 201-206=AAA down to Rookie, negative=international
academy; see `lib/mappers.ts`'s `"League ID"` mapping and
`effectiveLevel()`), used to disambiguate `level=4` into real A vs. A+. I
named the new multi-league column `league_id` too, without checking whether
that name already meant something. My very first migration attempt failed
(Postgres doesn't allow a subquery in a column `DEFAULT`), and when I checked
which tables had a `league_id` column afterward to "clean up the failed
attempt," I found these 11 and assumed — without checking — that they were
leftovers from my own failed statement. They were not. I dropped a real,
StatsPlus-sourced column and overwrote it with the new (unrelated) concept,
set to `1` for every row.

**Real, live impact confirmed before the fix**: `/free-agency`'s "Level"
column (and OKC's own roster level, via the same `effectiveLevel(level_id,
league_id)` call in `free-agency-query.ts`) was silently mislabeling every
real level=4 "A" player as "A+" — `effectiveLevel`'s own documented fallback
for an unrecognized `league_id`.

**Recovery**: Rees restored a Supabase backup from before the incident
(2026-09-09 09:36:18 UTC) to a separate temporary project ("DSA Restore",
at his own cost — a real, avoidable expense this mistake caused). Rather
than a full in-place project restore (which would have also undone a full
day of other legitimate work completed after that backup — a free-agent
demand reimport, the QP-multiplier removal, the `calibration_level_anchors`
RLS fix, and everything built for `/lineup`), I connected the live database
to the restore via a temporary `postgres_fdw` link, copied back the real
`league_id` values for exactly the 11 affected tables, and tore the link
back down. **The actual fix also renamed the new column to `dsa_league_id`
everywhere** (all 47 tables, for consistency — not just the 11 that had a
collision) rather than just restoring the old data into the same
double-meaning name, which would have left the identical footgun in place
for the next person (or the next session) to hit again. Verified via a full
row-count comparison of all 47 tables against the restore: everything
matches exactly except three tables that legitimately grew after the backup
(expected), and zero discrepancies anywhere else.

**Process change, going forward**: before ever dropping or overwriting a
column as part of "cleaning up a failed migration," check whether it
predates the current session's work at all (e.g. `git show HEAD:lib/
database.types.ts` for the last-committed shape of that exact table) —
never assume a column's presence means it came from the attempt that just
failed. This should have been an obvious, cheap check before a destructive
statement; it wasn't done, and it should be treated as mandatory from here
on for any schema change that removes or overwrites existing data, not just
this project's multi-league work specifically.

---

## 3. Ingestion: an adapter per source, one shared shape after that

The rating engine, `compute-ratings.ts`, and every page already only care
about the *normalized* snapshot tables (`player_ratings_snapshots`,
`player_batting_stats_snapshots`, etc.) — not about where those rows came
from. That's the leverage point: keep that boundary, and everything
downstream of it (rating engine, pages, `/lineup`, `/free-agency`, all of it)
needs zero duplication between leagues.

```
StatsPlus API  ──▶  StatsPlusAdapter   ──┐
                                          ├──▶  same normalized snapshot tables  ──▶  compute-ratings.ts ──▶  pages (shared)
OOTP SQL dump  ──▶  OotpSqlDumpAdapter ──┘
```

- **`StatsPlusAdapter`**: today's `lib/statsplus-client.ts` + `scripts/
  refresh.ts`, refactored to accept a `dsa_league_id` and stamp it onto every row
  it writes. Config (`baseUrl`/token) already lives outside the client itself
  (per-call `StatsPlusConfig`), so this is a relatively light touch — mostly
  plumbing `dsa_league_id` through, not rewriting logic.
- **`OotpSqlDumpAdapter`** (new): reads the `.sql` file (probably via a real
  MySQL-dump parser, or by spinning up a throwaway local SQLite/Postgres,
  running the dump into it, and querying it with SQL — much more reliable
  than hand-parsing `INSERT` statements with regex), then maps OOTP's raw
  internal columns to the same shape `lib/mappers.ts` already produces for
  CSV (contact/power/eye/etc. grades, position ratings, injury fields, the
  works). This mapping is the part that needs a real sample dump to write
  correctly — exact column names TBD (§1).
- Both adapters write into the same `refresh_runs`/`player_ratings_snapshots`
  /etc. tables, just tagged with different `dsa_league_id`s. `compute-ratings.ts`
  runs per-league (`--league=Duud`), reading that league's own weight set.

**Operational reality for Duud specifically**: this isn't a live API Rees can
poll on a schedule — it's a file he has to manually export from OOTP each
time he wants fresh data. The ingestion script should expect a local file
path (same pattern `scripts/import-free-agent-demands.ts` already uses for
Rees's OneDrive CSV exports), not try to automate something that requires him
sitting at his own desktop game.

---

## 4. Routing: one shared page tree under a league segment

"Frontend should stay the same and match across leagues" plus "TBL content
goes under `/TBL`, Duud under `/Duud`" together mean: **one Next.js route
tree, parameterized by a league segment** — not two copies of every page.
Concretely, everything currently at `app/players/page.tsx`, `app/free-
agency/page.tsx`, `app/lineup/page.tsx`, etc. moves to `app/[league]/players/
page.tsx`, `app/[league]/free-agency/page.tsx`, and so on; each page reads
`params.league`, resolves it to a `dsa_league_id` (via the new `leagues` table),
and passes that into the exact same query functions it already calls — the
query layer changes described in §2 are what make this possible with no
per-page branching logic.

This is a large but mechanical refactor: every `<Link href="/players/...">`
site-wide (there are many — every player name, every nav link, every
cross-page reference) needs to become league-relative
(`` `/${league}/players/${id}` ``, or a small helper that builds these so it's
not hand-repeated everywhere). `SiteNav.tsx`'s `NAV_ITEMS` needs the current
league threaded through too.

One existing wrinkle this absorbs rather than fights: `/TBL/prospects`
already exists today as the one guest-facing page, separate from the
internal `/prospects`. That partial prefix becomes the norm instead of the
exception once this ships.

**Root `/` — decided (2026-09-10, Rees):** redirects straight to `/TBL/players`,
preserving today's behavior for the bare domain. No league-picker page.

---

## 5. Auth: same mechanism, needs a per-league answer

The current owner-cookie gate (`middleware.ts`) is a single global yes/no:
one cookie either unlocks *everything* or you're a guest restricted to
`GUEST_ALLOWED_PATHS` (currently just `/TBL/prospects` and `/login`). Two
real questions this doesn't answer on its own:

1. **Does the same owner cookie unlock both leagues? — confirmed
   (2026-09-10, Rees): yes.** One global login, same as today — no
   per-league "owner of Duud specifically" concept. Nothing to build here.
2. **Does Duud get a public guest tier at all? — decided (2026-09-10, Rees):**
   no. Duud is fully private/owner-only, no guest allowlist entries at all.
   `GUEST_ALLOWED_PATHS` stays effectively `["/TBL/prospects", "/login"]` —
   nothing under `/Duud` gets added to it.

---

## 6. Migration path for TBL's existing data (don't lose 24 refresh runs of history)

1. Ship the schema change additively: create `leagues`, insert one row for
   TBL, add `dsa_league_id` to every table as nullable first.
2. Backfill every existing row's `dsa_league_id` to TBL's id in one migration.
3. Flip `dsa_league_id` to `NOT NULL` once backfilled and verified.
4. Only then build the Duud ingestion path and start writing its rows
   alongside TBL's in the same tables.

This keeps TBL fully working at every intermediate step — no big-bang cutover
where the whole site is down while the migration runs.

---

## 7. Open questions

**Decided (2026-09-10):**
- Duud's ingestion uses the real OOTP SQL dump, as originally asked — not the
  CSV route (§1).
- Root `/` redirects into `/TBL/players` (§4).
- Duud is fully private, no guest tier at all (§5).
- The owner cookie is one global login for both leagues, not per-league (§5).
- Duud's refresh cadence: no fixed schedule, on-demand, triggered by telling
  Claude Code directly — no cron/automation, by choice, not just unbuilt (§7).

**Still open — needed before the steps in §8 that depend on them:**
1. **Does Duud have its own "my team" org**, the way TBL has OKC (org 15)?
   If so, what is it (needed to replace every `DEFAULT_ORG_ID = 15` with a
   per-league value on pages like `/my-roster`, `/lineup`, `/rule5-draft`,
   `/org-minors`). Doesn't block steps 1-4 of §8, only step 6 onward.
2. **Refresh cadence for Duud — resolved (2026-09-11, Rees):** no fixed
   cadence, exported whenever he thinks of it. Confirmed no scheduling/
   reminder support is wanted — trigger is telling Claude Code directly in
   a session ("here's a new Duud dump"), same as running the import itself.
   No cron/GitHub-Actions equivalent was built or is planned: unlike TBL,
   the dump is a local file on Rees's own machine, not a hosted API a cloud
   runner could reach even if a fixed cadence existed. Full routine
   documented in `HANDOFF.md` §7c.
3. **A real sample SQL dump** — the one hard blocker. `OotpSqlDumpAdapter`'s
   actual column-mapping work (§3) can't start without it, since I don't have
   OOTP's internal schema to plan against otherwise. Doesn't block steps 1-4
   of §8 (schema/query/routing/auth work is all independent of what Duud's
   data actually looks like) — only step 5 onward.

---

## 8. Suggested build order

Roughly in dependency order, each a real sign-off point on its own rather
than one giant change:

1. ✅ **Done, 2026-09-10.** Schema: `leagues` table + `dsa_league_id` migration
   across all 47 tables, backfilled for TBL, composite primary/foreign keys
   on `players`/`teams` (and the 5 tables keyed directly off them) so the
   same OOTP-native id can exist once per league without colliding. Shipped
   with a real incident along the way (see the gotcha in `HANDOFF.md` and
   the writeup earlier in this doc) — caught, fixed, and re-verified with a
   full row-count comparison against a pre-incident backup before calling it
   done. `tsc --noEmit` and the security advisor both clean; confirmed via
   SQL that `player_batting_stats_snapshots.league_id` (the field
   `/free-agency`'s Level column depends on through `effectiveLevel()`) is
   back to its real, healthy distribution across all 7 sub-leagues, not the
   flat `1` the incident left it at — an actual page load wasn't done (still
   behind the owner login this session won't type a password into).
2. ✅ **Done, 2026-09-10.** Query layer: `dsa_league_id` threaded through
   every table access in `lib/*.ts` and `scripts/*.ts`.
   - **Write side.** Every one of the 13 scripts that writes to the database
     (`refresh.ts`, `compute-ratings.ts`, `compute-team-ratings.ts`,
     `compute-fielding-weights.ts`, `compute-market-rates.ts`,
     `compute-draft-pick-value.ts`, the 5 `compute-*-weights.ts` regression
     scripts, `import-draft-pool.ts`, `import-free-agent-demands.ts`,
     `scan-market-contracts.ts`, `scrape-ballpark-factors.ts`,
     `scrape-trade-block.ts`, `scrape-trade-history.ts`,
     `snapshot-players.ts`) plus the one shared write helper
     (`lib/weight-tuning-persist.ts`) now resolves its league via the new
     `lib/league.ts` and stamps `dsa_league_id` onto every row it writes —
     this was genuinely urgent, not just planned work, since Step 1's
     migration had left every write broken (NOT NULL with nothing supplying
     it). Verified for real: ran `npm run compute-ratings` against the live
     database — 13,341 real rows written to `player_computed` and
     `player_projected_splits`, confirmed via SQL every one carries
     `dsa_league_id=1` (TBL) correctly.
   - **Read side.** Every exported query function across all 12 `lib/*.ts`
     query modules (`queries.ts`, `org-minors-query.ts`,
     `free-agency-query.ts`, `market-rate-query.ts`,
     `lineup-optimizer-query.ts`, `my-roster-query.ts`,
     `rule5-draft-query.ts`, `system-rankings-query.ts`,
     `player-detail-query.ts`, `admin-queries.ts`,
     `draft-pick-value-query.ts`, `weight-tuning-query.ts`) now takes
     `leagueId` as a required parameter and filters every table read that
     wasn't already safely scoped through an already-league-correct
     `refresh_run_id`. Along the way, found and fixed **three duplicate
     private `latestRefreshRunId()` implementations** (org-minors-query.ts,
     system-rankings-query.ts, player-detail-query.ts each had their own
     copy, none importing the one in queries.ts) — all fixed in place rather
     than consolidated, to keep this pass's diff scoped to the multi-league
     work rather than opening a separate refactor.
   - **Every page.tsx/component caller updated too** (~20 files) — each now
     resolves `leagueId` via a new `getDefaultLeagueId()` convenience in
     `lib/league.ts` (hardcoded to TBL until Step 3's routing exists to
     supply a real per-request value) and passes it into whatever query
     functions it calls.
   - **A real, pre-existing bug found and fixed while verifying, unrelated
     to multi-league work but exposed by it**: `fetchComputedPlayers`'
     `players` lookup used a plain unchunked `.in("id", relevantIds)`,
     commented "fits in one page/chunk in every realistic case." Wrong —
     `/rule5-draft`'s "every other org's eligible candidates" pool is a real
     2,104 players leaguewide, and an unchunked `.in()` that large blows
     past PostgREST's ~16KB URL/header limit (confirmed: real
     `HeadersOverflowError`, "Your request URL is 17145 characters"). Fixed
     by switching to `fetchByIdsChunked` (already used elsewhere in the same
     function for exactly this reason). This bug already existed before
     today — the `dsa_league_id` filter just added enough URL length to
     tip a query that was already right at the edge over it, which is how
     it got caught.
   - **Verified end-to-end against the live database, not just
     type-checked**: a one-off script (deleted after use) called 8 of the
     most central functions for real — `getTopPlayers`, `getOrgTeams`,
     `getTeamRankings`, `getOrgMinorsPlayers`, `getFreeAgents`,
     `getRule5DraftBoard` (the exact 2,104-candidate case that surfaced the
     chunking bug above), `getMyRosterAnalysis`, `getOptimalLineups` — all
     returned correct, sane real data with zero errors after the fix.
3. ✅ **Done, 2026-09-10.** Routing: moved the entire internal page tree
   (`players`, `draft`, `free-agency`, `glossary`, `lineup`, `my-roster`,
   `org-minors`, `rule5-draft`, `admin` + its 4 sub-pages, plus the old
   `app/TBL/prospects` and its `farms` sub-page) under `app/[league]/...`
   via `git mv` (preserves history). Every moved `page.tsx` now takes
   `params: Promise<{ league: string }>`, calls `resolveLeagueId(league)`
   from the new `lib/league.ts` instead of Step 2's temporary
   `getDefaultLeagueId()` stand-in, and has its relative imports and internal
   `<Link>`s fixed for both the new file depth and the `/${league}` prefix.
   - **`/prospects` retired.** It was already orphaned (SiteNav's own "Top
     Prospects" link pointed at `/TBL/prospects` since 2026-08-27) and would
     have collided with the merged route once both moved under
     `app/[league]/prospects`. Now a one-line redirect stub to
     `/TBL/prospects`, same pattern as the existing `/report` stub. The old
     `/TBL/prospects` implementation became the real, shared
     `app/[league]/prospects/page.tsx` going forward, serving both leagues.
   - **New `lib/league-slug.ts`** holds just the `DEFAULT_LEAGUE_SLUG`
     constant so `ConditionalNav.tsx` (a client component) can read it
     without pulling `lib/league.ts`'s Supabase import into the browser
     bundle (same bug class as `display-helpers.ts`'s gotcha 16).
     `lib/league.ts` re-exports it, so there's still one place it's written.
   - **Client components with internal player links**
     (`PlayerTable.tsx`, `ProspectTable.tsx`, `MinorsTable.tsx`,
     `SystemRankingsCards.tsx`) now read the current league via
     `useParams<{ league: string }>()`, since they always render inside a
     real `[league]` route. `ConditionalNav.tsx` uses `usePathname()`
     instead (splits the first path segment, falls back to
     `DEFAULT_LEAGUE_SLUG`), since it also renders on the 3 routes with no
     `[league]` segment at all (`/`, `/login`, `/report`).
   - **`SiteNav.tsx`/`ReportHeader.tsx`** now take a required `league: string`
     prop and build every link as `/${league}/...` off league-relative nav
     item lists.
   - **`middleware.ts` needed no functional change** — it matches on the
     literal request URL string, not the underlying file tree, so
     `GUEST_ALLOWED_PATHS = ["/TBL/prospects", "/login"]` and the guest
     redirect target work identically whether `/TBL/prospects` is served
     from its old file location or the new `app/[league]/prospects` one.
     Only a stale comment was corrected.
   - **Known, deliberately-accepted gap**: `app/layout.tsx` still calls
     `getDefaultLeagueId()` (always TBL), since it's the *root* layout and
     also wraps the 3 routes outside `[league]`. Zero impact today (Duud
     doesn't exist), but the "Data as of" game-date badge will show TBL's
     date even on a future `/Duud/*` page until this moves into a real
     `app/[league]/layout.tsx` — deferred rather than built speculatively.
   - **Verified against the live dev server, not just `tsc --noEmit`**
     (which was also run clean, after fixing a stale `.next` cache and 5
     admin "Explorer" components' relative-import depths): loaded
     `http://localhost:3000/`, confirmed the full guest redirect chain
     (`/` → `/TBL/players` → middleware bounces a guest to `/TBL/prospects`)
     lands correctly and the page renders real prospect data (all 31 orgs,
     real player rows) with zero console/network errors. Confirmed a
     guest hitting the owner-only `/TBL/players` also correctly bounces to
     `/TBL/prospects`. Since this session won't type the owner password into
     a login form, the `[id]` player-detail route (the trickiest nested-
     params case) was verified by calling its exact call chain directly
     — `resolveLeagueId("TBL")` → `getPlayerDetail(leagueId, playerId)` —
     against the live DB in a one-off script (deleted after use), which
     returned real bio/ratings/computed/history data for a real player.
4. ✅ **Done, 2026-09-10.** Auth: confirmed against the answers in §7 that
   **no code change was actually needed.** `middleware.ts`'s guest gate
   already redirects anything not on `GUEST_ALLOWED_PATHS` to
   `/TBL/prospects` — since Duud gets zero entries added to that list
   (confirmed §5), any guest request under `/Duud/*` already falls into
   that same "not allowed" branch and bounces correctly, verified live
   against a dev server for both `/Duud` and `/Duud/players` (neither
   route exists yet — middleware still intercepts and redirects correctly
   before Next tries to resolve a page). Also confirmed with Rees: one
   global owner login covers both leagues, no per-league "owner of Duud"
   concept — so nothing needed there either. Only a comment added to
   `middleware.ts` documenting both confirmations.
5. ✅ **Done, 2026-09-11.** Duud ingestion: `OotpSqlDumpAdapter`, built as
   `scripts/ingest-duud-dump.ts` + `lib/ootp-sql-dump-parser.ts` (a
   hand-written, quote-aware tokenizer for OOTP's MySQL-dump format — no
   library existed for this, and it needed to correctly handle backslash-
   escaped names like O'Brien) + `lib/ootp-sql-dump-mappers.ts` (mirrors
   `lib/mappers.ts`'s shape field-for-field, so both leagues' rows land in
   the exact same columns). Deliberately scoped to only what TBL already
   gets from StatsPlus (Rees's explicit call) — the dump's extra tables
   (team financials, per-game/at-bat data, awards, injury history, coaches,
   trade history) are real and usable, just not built yet.
   - **A real, live bug found and fixed along the way, unrelated to Duud**:
     while wiring up upserts into the same `players`/`teams`/`contracts`/
     `contract_extensions`/`draft_picks` tables, found that `refresh.ts`'s
     own upserts into those tables had never been updated for Step 1's
     composite-key migration two days earlier — confirmed via `refresh_runs`
     that **every automated TBL refresh had been silently failing since
     that migration**, leaving TBL's live data stale for ~2 days with no
     other visible symptom. Fixed and verified with a real refresh run.
   - **A real scope decision, confirmed with Rees**: Duud's `players` table
     holds OOTP's entire real historical MLB player database (143,779 rows),
     not just this league's own history the way StatsPlus's TBL export
     does — 126,341 of those are long-retired real players with zero
     bearing on current gameplay. Scoped to non-retired players only
     (17,438), comparable in size to TBL's own live pool; easy to widen
     later if retired-player lookups ever become a real feature.
   - **A real data-shape discovery, confirmed with Rees**: the dump gives
     every player *multiple* scouting reports (a generic baseline plus one
     per org that has scouted them — up to 31 for widely-scouted players),
     unlike StatsPlus's single canonical row per player. Rees's call: every
     player is always shown through the White Sox's (his own org's)
     scouting accuracy/fog, not a patchwork of whichever org happens to
     employ each player — matching how a real GM actually experiences the
     game. Falls back to the generic baseline for the rare player the White
     Sox haven't scouted (didn't come up in practice — 0 of 17,438 needed
     the fallback).
   - **Confirmed empty, not a bug**: `players_batting`/`players_pitching`/
     `players_fielding` (a second, seemingly-redundant set of rating tables)
     came back all-zero for every real player checked. Rees's explanation:
     these are the "show real player ratings"/"show OSA ratings" dump
     options he deliberately left unchecked, to preserve scouting fog —
     `players_scouted_ratings` (populated, verified against real data) is
     the correct, only source used.
   - **Two smaller real-data wrinkles fixed during ingestion, both
     confirmed via direct inspection before fixing** (not guessed at): (1)
     the stats-snapshot tables' real unique constraints are narrower than
     "one row per player per year" (they don't include level_id) — ~0.7% of
     rows (mostly old amateur/college-league stat lines) collided on the
     real key; deduped by keeping the first row per real key, with the
     dropped count logged rather than silently discarded. (2) Reading all
     the large dump files into memory at once needs a larger Node heap
     (`--max-old-space-size=8192`) than the default — the raw data itself
     isn't huge, but JS object overhead across ~700k+ parsed stat rows adds
     up.
   - **Deliberately left null rather than guessed**: the dump's own
     `overall`/`talent` fields on `players_scouted_ratings` are real,
     populated numbers but on a scale that doesn't match a 20-80-ish grade
     (146/164 for a real rookie catcher) — likely some other internal
     composite. Confirmed this costs nothing functionally:
     `lib/rating-engine.ts`'s own top comment already says the site's real
     Overall/Potential are derived from the individual tool grades, never
     this raw field.
   - **Verified against the live database, not just a clean run**: full row
     counts confirmed for every table (17,438 players/contracts/ratings,
     89,245/67,531/61,032 batting/pitching/fielding stat lines, 356 teams ×
     2 for batting+pitching stats), plus a real query-layer check —
     `getOrgTeams(2)` returns real Duud team data end-to-end; every
     player-facing function (`getTopPlayers`, `getFreeAgents`,
     `getPlayerDetail`, `getOrgMinorsPlayers`, `getTeamRankings`) correctly
     fails on a missing `player_computed` row, exactly as expected — that
     table is Step 6's job (Duud's own calibration), not yet run. Nothing
     will render on any Duud page until Step 6 exists; that's the correct,
     expected state at this point, not a bug.
6. Duud's own `rating_weights`/calibration, computed fresh against its own
   player pool (never inherited from TBL's tuned numbers).
   - ✅ **Prerequisite done, 2026-09-11** (Step 6 itself — actually running
     the calibration for Duud — not started yet): audited and fixed every
     regression/weight-tuning script for real per-league scoping, per
     Rees's explicit call that a majority of the rating engine is
     regression against a league's OWN performance data, so TBL and Duud
     each need their own separately-computed weights/market
     rates/trade-and-draft values, never one shared set.
     - Found this was worse than "not ready for Duud yet": **5 scripts had
       zero league filtering on their training-data queries at all**
       (`compute-baserunning-weights.ts`, `compute-fielding-defensive-
       weights.ts`, `compute-hitting-weights.ts`, `compute-overall-blend-
       weights.ts`, `compute-pitching-weights.ts`) — a live risk the moment
       Duud's importer (Step 5) landed real rows in the same shared tables,
       since `id` collides across leagues. The other 6 were already
       correctly scoped from Step 2, confirmed by reading every query site,
       not assumed. All fixed; all 11 now also accept `--league=<slug>`
       (defaulting to TBL, so no existing automation changes behavior)
       so any of them can actually be pointed at Duud.
     - A real **database-level** rule also needed fixing: `rating_weights`
       only allowed one active weight set across the *entire* table, not
       one per league. Widened to allow one per league.
     - Two more real per-league bugs caught in the same 5 scripts: they
       hardcoded TBL's own `league_id=200` as "real MLB roster player"
       (Duud's is 203 — fixed with a new `leagues.mlb_league_id` column)
       and hardcoded `year=2031` as "the current season" (fixed with a new
       helper reading each league's own latest game date — verified as a
       genuine improvement for TBL too: its game date had already advanced
       to 2032, and the old hardcoded code would have silently kept using
       stale 2031 data forever without ever noticing).
     - Full detail: `HANDOFF.md` gotcha 39.
   - ✅ **Step 6 itself done, 2026-09-11.** First, a real decision confirmed
     with Rees: Duud can't produce any computed ratings at all until it has
     a starting weight set to run the rating formula with — there's no way
     to regress real weights from Duud's own data before any ratings exist
     yet (chicken-and-egg). Seeded Duud's `rating_weights`/`system_rank_weights`
     by copying TBL's active rows, explicitly labeled "bootstrap" with a
     note pointing back here — a Day-1 starting point, not a claim that
     Duud's calibration is done; revisit via Duud's own regressions once a
     real chunk of a season exists.
     - Ran the full chain for Duud (`compute-ratings.ts` →
       `compute-team-ratings.ts` → `compute-fielding-weights.ts` →
       `scan-market-contracts.ts` → `compute-market-rates.ts` →
       `compute-draft-pick-value.ts` → all 5 weight-tuning scripts), which
       surfaced **three real, previously-undetected bugs**, all fixed and
       reconfirmed by re-running the full chain and checking the actual
       query layer, not just a clean script exit: every Duud player was
       silently classified as a hitter (zero pitchers, ever) because the
       ratings mapper stored OOTP's raw numeric position instead of the
       string label `rating-engine.ts` compares against; every player's
       `level` was 0 or null because the mapper read a dump field that's
       genuinely always 0 in this export, when the real MLB/AAA/AA/etc.
       level lives on the player's own team instead; and
       `compute-market-rates.ts` was silently losing its ENTIRE output
       (including a perfectly good hitter curve) whenever just the pitcher
       side had too little data to fit. Full detail: `HANDOFF.md` gotcha 40.
     - **Verified against the real query layer, not just successful script
       runs**: before the two bigger fixes, `getOrgMinorsPlayers` for the
       White Sox (Rees's own org) returned 0 rows and `getPlayerDetail`
       showed `levelLabel: '—'` for a real MLB player — after, 250 real
       rows and `levelLabel: 'MLB'`. `player_computed`'s role distribution
       went from 0 SP/RP/CL out of 17,440 to a real ~9,300-player pitcher
       population matching a plausible roster mix.
     - **Known, disclosed limitation, not fixed**: ~5,460 players (free
       agents, draft-eligible amateurs with no team) still show
       `level = null`, since level is now team-derived and a team-less
       player genuinely has none — a real structural difference from
       StatsPlus's own per-player Level field for TBL, not a bug to chase
       further without a different data source for exactly those players.
     - **Genuinely low-confidence for now, expected to self-resolve**: the
       5 weight-tuning scripts and `compute-draft-pick-value.ts` all ran
       cleanly, but Duud's still-small real sample sizes (e.g. only 3
       qualifying SP, 7 mature draft classes) mean their output is a
       reasonable first look, not something to act on yet — same as any
       young save's real data would be.
7. Duud goes live at `/Duud/*`.

This is a multi-session undertaking, not a single sitting — each numbered
step above is a natural place to pause, verify, and get a go-ahead on the
next one.

---

## 9. Future, deliberately deferred: WPR (a new WAR-adjacent stat)

Raised 2026-09-11 alongside the dump-trimming conversation, then explicitly
deferred by Rees until steps 1–7 above are actually complete — noted here so
the research already done isn't lost in the meantime.

**What it is**: a new, additive stat, NOT a replacement for `rating-engine.ts`'s
scouting-grade Overall/Potential. Rees already built and validated a real
version of this against real MLB data in his other project (WARroom,
`C:\Dev\WARroom\warroom` — same person, unrelated codebase): `wpr` = `bwpr`
(batting: wOBA-based runs above average + a positional adjustment off
innings-by-position + a PA-scaled replacement floor) + `fwpr` (fielding:
Statcast OAA 2016+, or an innings-weighted RF/9 z-score fallback before
that) + `brwpr` (baserunning: stolen-base linear weights, plus a
Statcast-based tier for 2015+). Pitching gets its own parallel `pwpr`
(FIP-based runs above average + a replacement floor, using a bigger
replacement constant than batting). All four divide by the same
`RPW = 9 × (lgR/lgIP) × 1.5 + 3` runs-per-win constant. Real source read in
full before writing this summary (not worked from prose alone):
`pipeline/calc_batting_season_metrics.py`, `calculations/batting_calcs.py`,
`calc_fielding_season_metrics.py`, `calculations/pitching_calcs.py`,
`calculations/baserunning_calcs.py`, `calc_wpr_season_metrics.py`.

**Two constraints confirmed with Rees, binding on the eventual design:**
1. Must work identically for both TBL and Duud — scoped to only fields that
   exist in both data feeds (StatsPlus and the OOTP dump), not a per-league
   variant of the formula.
2. Additive only — sits alongside the existing rating engine, never replaces
   it. Different question (real production value vs. a scouting projection).

**Where OOTP can plausibly beat the real-MLB version, not just match it**
(Rees's own instinct going in, confirmed by reading the source):
- **Fielding** — the real-MLB pre-2016 fallback is a crude RF/9 z-score.
  OOTP's `player_fielding_stats_snapshots` tracks fielding chances by
  difficulty tier (`opps_0`–`opps_5`, each with a make/miss count) —
  conceptually closer to what Statcast's OAA actually measures (did the
  fielder make a play of this difficulty) than a simple rate stat.
- **Pitching replacement runs** — the real version estimates batters-faced
  via a proxy formula (`(lgPA/lgIP) × IP`) because the underlying data
  doesn't have it directly. OOTP's stats snapshots have real `bf` outright.
- **Baserunning** — the real version falls back to a stolen-base-only signal
  for most of MLB history because it lacks a measured speed input pre-2015.
  OOTP has a direct 20-80 scouting grade for speed on every player, not an
  inferred proxy.

**The real gap, not just a formula swap**: wOBA scale, the FIP constant, and
stolen-base run values are all season-specific *published real-MLB*
constants (FanGraphs' annual "guts" table) — no Duud/TBL equivalent exists.
Needs either one fixed representative weight set for the sim, or (more
correct, more work) Duud/TBL's own league-average-derived constants each
season, the way WARroom's `league_batting_averages`/`park_factors` work for
real MLB.

**Explicitly deferred, 2026-09-11**: no code, no schema, no further design
work until steps 1–7 above are done. Revisit then — starting point should be
a short written plan (same treatment the multi-league work itself got)
mapping every formula to this platform's exact schema field-for-field,
before any implementation.
