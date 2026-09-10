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
There is no `league_id` column anywhere. `DEFAULT_ORG_ID = 15` (Oklahoma
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

### Recommended approach: one Supabase project, a new `leagues` table, `league_id` on every table

Considered and rejected: a second Supabase project per league (clean
isolation, but doubles every migration, every RLS setup, every deployment
step, and makes any future cross-league page — e.g. "compare my two leagues"
— much harder). A single project with a `league_id` foreign key column
everywhere is more schema-migration work up front but is the standard,
maintainable way to do this, and RLS is already default-deny service-role-
only sitewide, so there's no new public-exposure risk from consolidating.

- New `leagues` table: `id`, `slug` (`"TBL"`, `"Duud"` — used directly in
  URLs), `display_name`, `source_type` (`"statsplus"` | `"ootp_sql_dump"`),
  and whatever per-source config each needs (StatsPlus base URL/token vs. a
  dump file path).
- Every existing table gets a `league_id` column (not nullable, FK to
  `leagues.id`). Every place a table is keyed by OOTP's own id (`players.id`,
  `teams.id`, etc.) becomes a **composite key** of `(league_id, id)`, not just
  `id` — this is the part that actually prevents the collision problem above,
  not merely adding the column.
- Every query in `lib/*.ts` that currently has no league concept (nearly all
  of them) needs a `league_id` parameter threaded through, the same way
  `orgId` already threads through `fetchComputedPlayers`/`getOrgMinorsPlayers`
  /etc. today. Mechanical, but touches most of `lib/`.
- `rating_weights`, `calibration_level_anchors`, `refresh_runs`,
  `fielding_role_weights`, `market_rate_curves`, and every other
  "one active/current row" concept becomes "one active row **per league**."

This is a real migration on live data (TBL's ~24 refresh runs of history
can't be dropped) — §6 covers how to do it without losing anything.

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
  refresh.ts`, refactored to accept a `league_id` and stamp it onto every row
  it writes. Config (`baseUrl`/token) already lives outside the client itself
  (per-call `StatsPlusConfig`), so this is a relatively light touch — mostly
  plumbing `league_id` through, not rewriting logic.
- **`OotpSqlDumpAdapter`** (new): reads the `.sql` file (probably via a real
  MySQL-dump parser, or by spinning up a throwaway local SQLite/Postgres,
  running the dump into it, and querying it with SQL — much more reliable
  than hand-parsing `INSERT` statements with regex), then maps OOTP's raw
  internal columns to the same shape `lib/mappers.ts` already produces for
  CSV (contact/power/eye/etc. grades, position ratings, injury fields, the
  works). This mapping is the part that needs a real sample dump to write
  correctly — exact column names TBD (§1).
- Both adapters write into the same `refresh_runs`/`player_ratings_snapshots`
  /etc. tables, just tagged with different `league_id`s. `compute-ratings.ts`
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
`params.league`, resolves it to a `league_id` (via the new `leagues` table),
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

**Root `/` needs a new decision.** Today it redirects straight to `/players`
(i.e., straight into TBL). Once TBL is one of two leagues, `/` needs to
either default to `/TBL/players` (simplest, preserves today's behavior for
anyone with the bare domain bookmarked) or become a small league-picker page.
Flagging as a real decision, not assuming — see §7.

---

## 5. Auth: same mechanism, needs a per-league answer

The current owner-cookie gate (`middleware.ts`) is a single global yes/no:
one cookie either unlocks *everything* or you're a guest restricted to
`GUEST_ALLOWED_PATHS` (currently just `/TBL/prospects` and `/login`). Two
real questions this doesn't answer on its own:

1. **Does the same owner cookie unlock both leagues?** Almost certainly yes
   (Rees is the one owner of the whole platform) — flagging only because the
   code currently has no concept of "owner of league X specifically," and I
   want to confirm that's not actually wanted before building it that way.
2. **Does Duud get a public guest tier at all?** TBL deliberately ships a
   public Top Prospects / Farm Rankings view for other GMs in that league.
   Duud is described as "a personal league" — does it need *any* public page,
   or should everything under `/Duud` be owner-only with no guest allowlist
   entries at all? This changes `GUEST_ALLOWED_PATHS` from a flat list to
   something like a per-league list, and it's a real product decision, not a
   technical one.

Mechanically, once §4's league segment exists, `GUEST_ALLOWED_PATHS` just
becomes a list of full paths per league (e.g. `["/TBL/prospects", "/login"]`
today, possibly `+ ["/Duud/prospects"]` or nothing at all for Duud, depending
on the answer above).

---

## 6. Migration path for TBL's existing data (don't lose 24 refresh runs of history)

1. Ship the schema change additively: create `leagues`, insert one row for
   TBL, add `league_id` to every table as nullable first.
2. Backfill every existing row's `league_id` to TBL's id in one migration.
3. Flip `league_id` to `NOT NULL` once backfilled and verified.
4. Only then build the Duud ingestion path and start writing its rows
   alongside TBL's in the same tables.

This keeps TBL fully working at every intermediate step — no big-bang cutover
where the whole site is down while the migration runs.

---

## 7. Open questions — need answers before (or early in) building

1. **SQL dump vs. CSV for Duud's ingestion.** Confirmed the SQL dump feature
   exists and works the way Rees described; still open whether it's worth
   the extra build cost over reusing the existing CSV pipeline for an initial
   version (§1).
2. **Root `/` behavior** once two leagues exist (§4): default into TBL, or a
   picker page?
3. **Does Duud need any public/guest-visible pages at all**, or is it fully
   owner-only (§5)?
4. **Does Duud have its own "my team" org**, the way TBL has OKC (org 15)?
   If so, what is it (needed to replace every `DEFAULT_ORG_ID = 15` with a
   per-league value on pages like `/my-roster`, `/lineup`, `/rule5-draft`,
   `/org-minors`).
5. **Refresh cadence for Duud** — how often will a new SQL dump actually be
   produced (weekly? after every sim session?), since that determines
   whether the ingestion script needs any scheduling/reminder support or is
   purely "run it by hand whenever there's a new file."
6. **A real sample SQL dump** — needed before the `OotpSqlDumpAdapter`'s
   actual column-mapping work can start (§1, §3).

---

## 8. Suggested build order

Roughly in dependency order, each a real sign-off point on its own rather
than one giant change:

1. Schema: `leagues` table + `league_id` migration across all 47 tables,
   backfilled for TBL, TBL fully re-verified working end to end.
2. Query layer: thread `league_id` through `lib/*.ts` (mechanical, but the
   biggest-surface-area step).
3. Routing: move the page tree under `app/[league]/...`, fix up internal
   links, confirm TBL renders identically at its new `/TBL/*` URLs.
4. Auth: per-league `GUEST_ALLOWED_PATHS`, confirmed against the answers in
   §7.
5. Duud ingestion: `OotpSqlDumpAdapter`, once a real sample dump is in hand.
6. Duud's own `rating_weights`/calibration, computed fresh against its own
   player pool (never inherited from TBL's tuned numbers).
7. Duud goes live at `/Duud/*`.

This is a multi-session undertaking, not a single sitting — each numbered
step above is a natural place to pause, verify, and get a go-ahead on the
next one.
