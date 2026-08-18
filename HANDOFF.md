# Front-End Handoff — DSA

**Purpose of this doc:** everything you (or Cursor) need to build out the front end without re-deriving what's already been figured out. Claude Code (this repo's `scripts/`, `lib/*-client.ts`, `lib/rating-engine.ts`, `lib/mappers.ts`, and the database itself) continues to be maintained in a separate ongoing session — this doc is the contract between that work and yours.

## 1. What this project is

DSA replaces a Power BI dashboard (`TBL.pbix`, in the parent `OOTP-Analysis` folder, kept for reference) that visualized player ratings, prospect rankings, team rankings, and draft boards for an OOTP Baseball online league ("TheBigLeague"). Instead of Power BI reading manually-exported CSVs, this project pulls live from **StatsPlus** (a third-party web platform the league already uses) into a **Supabase Postgres database**, computes the same proprietary rating system Power BI used (now via TypeScript instead of DAX), and will serve it through a **Next.js** front end on **Vercel**.

Reference docs, in the order you'd actually want to read them if you need the "why":
- [`power-bi-rating-system-analysis.md`](../power-bi-rating-system-analysis.md) (parent dir) — the original Power BI rating engine, reverse-engineered formula by formula, plus the 4 harmonization decisions applied when porting it here.
- [`statsplus-api-inventory.md`](../statsplus-api-inventory.md) (parent dir) — every StatsPlus endpoint, what it returns, auth requirements.
- [`schema-design.md`](schema-design.md) — the reasoning behind the schema (now slightly stale in exact details — see the note at its top).
- [`lib/database.types.ts`](lib/database.types.ts) — **the actual current schema**, auto-generated from the live database. Regenerate anytime with the Supabase MCP `generate_typescript_types` tool, or ask whoever's running the backend session to.

## 2. Division of ownership

To avoid two things editing the same code out from under each other:

**Backend session (Claude Code) owns:**
- `scripts/*.ts` (refresh.ts, compute-ratings.ts, compute-team-ratings.ts, import-draft-pool.ts)
- `lib/statsplus-client.ts`, `lib/mappers.ts`, `lib/rating-engine.ts`, `lib/supabase-client.ts`
- All Supabase migrations / schema changes
- `lib/queries.ts` — **for now**. This is the data-access layer the current front end uses. If you're extending the existing pages, use it. If you're rebuilding the front end more substantially, treat it as a reference implementation you can replace — just don't edit it in place from Cursor while the backend session might also be touching it. Coordinate with Rees on this boundary before making big changes here.

**Front end (Cursor) owns:**
- `app/**` — pages, layouts, components
- Anything else UI-specific you add (styling approach, component libraries, etc. — none of that has been decided, it's wide open)

**Shared/read-only for both:** the Supabase database itself. Front-end work should treat every table as read-only (query only) — there is no scenario where the front end should be writing to the database directly. All writes happen through the backend's ingestion/compute scripts.

## 3. Connecting to Supabase

Project: `DSA`, ref `onclzyjhfkgonemcpcmo`, URL `https://onclzyjhfkgonemcpcmo.supabase.co`.

**⚠️ Critical, unresolved security gap: Row Level Security is disabled on every table.** This was flagged when the schema was first applied and has not been fixed. It means the anon/public API key currently has full read **and write** access to everything. This is fine for local development, but:
- **Do not deploy this publicly (Vercel or otherwise) until RLS policies exist.** At minimum, every table needs a read-only policy for anon before any client-side Supabase calls are safe to ship.
- The existing front-end pages sidestep this entirely by using the **service-role key server-side only** (Next.js Server Components, never shipped to the browser — see `lib/supabase-client.ts` and `lib/queries.ts`). If you keep that pattern, RLS being off doesn't matter for what's already built. If you switch to client-side Supabase calls (e.g. for interactivity, live updates), designing real RLS policies becomes a blocker first.

You'll need a `.env` file (copy `.env.example`) with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — get the key from whoever has the Supabase dashboard, or ask the backend session to fetch it isn't retrievable via MCP tools for security reasons, so this has to come from a human with dashboard access.

## 4. Data model — what actually exists

Three layers, all in `lib/database.types.ts`:

### Raw reference data (current-state, upserted each refresh)
`teams`, `players`, `contracts`, `contract_extensions`, `draft_picks`. Field names match StatsPlus's own naming, not relabeled. `players.pos`/`.bats`/`.throws` are StatsPlus's own numeric codes (not letter codes) — decode via `player_ratings_snapshots.pos` instead if you need a letter code like "SP"/"CF".

### Raw time-series snapshots (every refresh adds new rows, tagged by `refresh_run_id`)
`player_batting_stats_snapshots`, `player_pitching_stats_snapshots`, `player_fielding_stats_snapshots`, `team_batting_stats_snapshots`, `team_pitching_stats_snapshots`, `player_ratings_snapshots`, `game_results`. **Important:** a player can have multiple stat rows for the same year — one per level they played at (promotions/demotions mid-season). Always filter/group by `level_id` when showing season stats, not just `year`. See §6 for the level-code decode table.

### Computed (rating engine output — never recompute in the front end, just read)
`player_computed`, `team_computed`. Holds `overall`, `potential`, `prospect_potential`, `role`, `sp_rp`, `tbl_pos`, `platoon`, `eta`, and every rank (`rank`, `org_rank`, `prospect_rank`, `prospect_org_rank`, etc.), all tied to a `refresh_run_id` and a `weights_id` (which `rating_weights` row produced them — weights are database rows, not hardcoded, specifically so methodology can be tuned/tested later).

### Draft class tracking
`draft_class_imports` / `draft_class_pool_members` — a manually-imported OOTP export (not from StatsPlus) giving the *exact* roster of a given draft class. Necessary because StatsPlus's `draft_eligible` flag on `players` is **not** scoped to one class — it's a broad multi-year amateur flag. Always join through `draft_class_pool_members` for "this year's draft pool," never filter on `draft_eligible` alone.

### Not built yet (don't design against these)
- Win/loss-based team power rankings (needs league-relative stat normalization, not started)
- Ratings/computed values for pre-draft amateurs — same rating engine works fine on them once they have data, but the ingestion pipeline for their scouted grades is still manual/deferred
- Team financials beyond raw contract data — team payroll is **not** simply `SUM(contracts.salary0)`; retained salary on trades breaks that naive sum and hasn't been solved yet
- Per-game box scores / play-by-play — confirmed possible via scraping StatsPlus's static HTML reports, deliberately deferred until after core parity

## 5. Existing front-end code (starting point, not gospel)

Minimal Next.js 14 App Router, explicitly built with "no polish, just functional tables" as the brief — expect to replace most of the visual layer.

- `/players` — top 100 by Overall, org filter
- `/prospects` — top 100 by Prospect Potential, org filter, includes level/ETA/season-stats-by-level/team logo
- `/draft` — top 100 draft-pool prospects by Prospect Potential, scoped to the latest `draft_class_imports` row

`lib/queries.ts` has the working query patterns (`getTopPlayers`, `getTopProspects`, `getTopProspectsDetailed`, `getTopDraftees`, `getOrgTeams`) plus two small but load-bearing helpers: `levelLabel()` (numeric level code → "AAA"/"AA"/etc.) and `teamLogoUrl()` (constructs StatsPlus's logo image URL from team name — verified working for a few teams, not exhaustively).

## 6. Gotchas already discovered (save yourself the rediscovery time)

1. **No foreign keys between `player_computed`/`player_ratings_snapshots`/stats snapshot tables.** They're sibling tables independently keyed by `player_id` + `refresh_run_id`, not parent/child. Supabase's automatic embedding (`select("*, other_table(...)")`) **will fail** with "no relationship found" between any two of these. Fetch separately and join in JS (see `fetchComputedPlayers` in `lib/queries.ts` for the pattern) or write raw SQL.
2. **Supabase caps a single `.select()` at 1000 rows by default.** Always paginate with `.range(from, to)` in a loop when you might have more than 1000 matching rows (players table alone is ~45,000 rows). See `fetchAll()` in `lib/queries.ts`.
3. **Import extensions matter and differ by context.** Files under `scripts/` run via `tsx`/Node's ESM loader and **require** explicit `.js` extensions on relative imports (`from "./foo.js"` even though the file is `foo.ts`). Files under `app/` and anything only consumed by Next.js's webpack bundler (like `lib/queries.ts`) **must not** have the extension (`from "./foo"`) or the build fails with "Module not found." This split is intentional, not a mistake to "fix" — don't add `.js` back to `lib/queries.ts`'s imports.
4. **Next.js dev server caches Supabase responses across external database changes.** If the backend session runs a refresh/recompute script while your dev server is running, the page will keep showing old data. `rm -rf .next` and restart `npm run dev` to see fresh data. There's no code fix for this yet — just a routine to remember.
5. **League level codes need decoding, and it's not obvious from the number alone.** Confirmed empirically: `0`=unassigned, `1`=MLB, `2`=AAA, `3`=AA, `4`=A+, `5`=A-, `6`=Rookie. Use `levelLabel()` rather than showing the raw integer.
6. **A "prospect" is not simply "anyone with `prospect_rank` set who has no org."** Free agents only belong in prospect rankings if they have a real `last_team_id` (previously rostered — a "true" free agent). Free agents with no `last_team_id` are almost always amateur draft-pool players who've never been rostered, and the *vast majority* of those are years away from being relevant (future draft classes). This filter already lives in `compute-ratings.ts` (backend), so `player_computed.prospect_rank` is already correct — just don't re-derive "is this a prospect" from raw `players` fields yourself; trust `prospect_rank is not null`.
7. **Stats endpoints are split by league/level — a season can have multiple rows per player.** See §4. `getTopProspectsDetailed`'s `seasonStints` array is the pattern to follow if you need per-level season stats anywhere else.

## 7. Running it locally

```bash
cd platform
npm install
cp .env.example .env   # fill in SUPABASE_SERVICE_ROLE_KEY
npm run dev
```
Opens on `localhost:3000`. The `refresh`/`compute-ratings`/`compute-team-ratings`/`import-draft-pool` npm scripts are backend-only — you shouldn't need to run them, but if data looks stale or missing, that's more likely "ask the backend session to run a refresh" than a front-end bug.

## 8. Coordination going forward

- Schema changes will show up in `lib/database.types.ts` (regenerate it, or ask, whenever something looks off) and get a line added to §4 above.
- If front-end work surfaces a data need that doesn't exist yet (a new computed field, a report needing data we haven't ingested), flag it back rather than trying to derive it client-side from raw tables — there's likely a reason it's not there yet (either not built, or a genuine open methodology question, like team financials).
- Both of us are committing to the same `main` branch on `github.com/rmviersen/DSA` — small, frequent commits with clear messages reduce collision risk given no branching strategy exists yet.
