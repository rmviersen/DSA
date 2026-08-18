> Paste the section below into Cursor to kick off a session. Keep this file itself short — the
> real detail lives in `HANDOFF.md`, which gets updated as backend work progresses. Update *this*
> file only if the ownership boundaries themselves change; update `HANDOFF.md` for everything else
> (new tables, new gotchas, newly-fixed data, etc.).

---

You're joining an existing project called **DSA** — a web platform that replaces a Power BI dashboard for an OOTP Baseball online league. It pulls live data from a third-party site (StatsPlus) into a Supabase Postgres database, computes a proprietary player-rating system (ported from the old Power BI model), and serves it through a Next.js front end headed for Vercel.

**A separate Claude Code session is actively building and maintaining the backend in parallel with you** — data ingestion scripts, the database schema, and the rating engine. This is an ongoing, evolving project, not a one-shot handoff.

**Before writing any code, read `platform/HANDOFF.md` in full.** It's the living contract between the backend and front-end work. It covers:
- What's already built and why
- The exact current database schema — also see `platform/lib/database.types.ts` (auto-generated from the live database; trust it over any hand-written schema doc if they ever disagree)
- A critical security note: **Row Level Security is OFF on every Supabase table right now.** Don't ship client-side Supabase calls, and don't deploy this publicly, until that's resolved.
- Specific gotchas already discovered the hard way (multi-level season stats, a Next.js dev-server caching quirk, an import-extension convention that differs between `scripts/` and `app/`, Supabase's 1000-row pagination cap, and more) — read these before spending time rediscovering them.

**What you own:** everything under `platform/app/` (pages, layouts, components), and any front-end-only tooling/config you add. Nothing about styling or component libraries is locked in — the three pages that exist today (`/players`, `/prospects`, `/draft`) were built as a bare, deliberately unpolished first pass just to view the data. Redesign freely; the data-access patterns are worth learning from, the visuals are not worth preserving.

**What you must NOT touch:** `platform/scripts/*.ts`, `platform/lib/statsplus-client.ts`, `platform/lib/mappers.ts`, `platform/lib/rating-engine.ts`, `platform/lib/supabase-client.ts`, and any Supabase migrations or schema changes. These are being actively developed elsewhere at the same time as you — editing them risks silent conflicts with work you can't see.

**Gray area — coordinate before major changes:** `platform/lib/queries.ts` is the current data-access layer. Use it freely as-is. If you want to substantially rewrite or replace it, flag that with Rees first rather than just doing it.

**The database is read-only from the front end.** All writes happen through the backend's own scripts — never insert/update/delete from front-end code.

**This is a living arrangement.** `HANDOFF.md` will keep changing as backend work lands. Re-read it at the start of each new session, not just once.
