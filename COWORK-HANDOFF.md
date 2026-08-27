# Cowork Orientation — automating DSA operations

**Who this is for:** Cowork (or any similar automation agent) taking on operational tasks for DSA — refreshing data, publishing reports, posting to Slack, monitoring the site. This is not a coding handoff (see `HANDOFF.md`/`DATA-MODEL-HANDOFF.md` for that) — it's the facts an automation agent needs to act safely and correctly, without re-deriving them or guessing.

## 1. What DSA is

A prospect/player-ranking site for an OOTP Baseball online league ("TheBigLeague"), live at `dsa-reports.com`. It replaced a Power BI dashboard. Data flows: StatsPlus (a third-party web platform the league runs through) → a Supabase Postgres database → a rating engine that computes Overall/Potential/Prospect Potential/ranks → a Next.js site on Vercel.

## 2. How data actually gets in — and the one real manual bottleneck

**Not a file/export workflow.** `scripts/refresh.ts` pulls live from StatsPlus's API directly. There is no OOTP export folder to watch.

**The bottleneck is StatsPlus session auth, not the data pull itself.** Two cookies are required: `csrftoken` (readable via normal browser JS — not `httpOnly`) and `sessionid` (**`httpOnly`** — cannot be read via `document.cookie` or a standard page script; only visible via browser DevTools by a logged-in human, or possibly via a browser tool that reads cookies at the network/DevTools-protocol level rather than in-page JS). If your browser tooling can read `httpOnly` cookies through such a mechanism, that's the single highest-value thing to verify — it would close the last manual step in refreshing data entirely.

**How you'd know a refresh is needed:** the league's Slack workspace (`thebigleaguegroup.slack.com`) has a channel, **`#commish_announcements`**, where three bot messages post after every sim, in order:
1. "File Watcher" — "TBL League File has been updated... Game date is X"
2. "File Watcher" — "TBL Reports are updated"
3. **"StatsPlus Bot" — "TBL StatsPlus website has been updated. Game date is X, see sim recap"**

**Only message 3 means the actual data source (StatsPlus) is ready to pull from.** Messages 1-2 are about the raw OOTP save file and its own HTML reports — not what this site reads. Watching for message 3 specifically (not just "any sim announcement") avoids pulling stale/incomplete data.

**Already built, worth knowing about before duplicating it:** a scheduled routine already polls this channel hourly and DMs the site owner when a new sim's game date is ahead of the database's last-refreshed game date — but it does **not** run the refresh itself, because there was no way found to store the database write credential (`SUPABASE_SERVICE_ROLE_KEY`) safely inside that kind of scheduled task. If your platform supports real secret storage for scheduled/background jobs, running the actual refresh (not just detecting that one's needed) is the natural next step — check this capability directly before assuming either way.

## 3. The database — access, and the rule that matters most

Supabase Postgres, Row Level Security **on, default-deny, every table** — only a `service_role` key (a real secret, server-side only) can read or write anything; the public key gets nothing. This is permanent by design, not a placeholder.

**Why it matters for you specifically:** the site hides exact scout ratings from public view by *rounding* Overall/Potential/Prospect Potential to the nearest 5 in the display layer — not by restricting what the database returns. **Any content you generate that could reach a public audience (a public Slack channel, a published report, anything outside a private conversation with the owner) must apply that same rounding to those three fields.** Posting raw/unrounded values anywhere public defeats the reason this rounding rule exists in the first place — other league GMs aren't supposed to be able to reverse-engineer your exact scouting grades from a report you publish.

Writing to the database (running a refresh, updating rankings) requires the real `service_role` key. There is no safe, limited-access key to use instead — handing this over is a real trust decision, worth sequencing deliberately (see §6).

## 4. What's already computed and ready to report on — don't rebuild this

- **Week-over-week (or any-snapshot-over-any-snapshot) deltas already exist.** Every refresh is tagged with a `refresh_run_id`; the rating engine's output table (`player_computed`) can be compared between any two runs to get real Overall/Potential/Prospect Potential/rank changes — this is exactly the "biggest movers" data a weekly report needs, and it's already the mechanism the site's own "Change from" baseline picker uses. No new computation needed to build a "top risers/fallers this week" report — just a query comparing two `refresh_run_id`s.
- **A scouting-blurb style guide already exists**, worked out with the site owner against real examples — tone, structure, what data sources are allowed to inform a blurb. Any automated write-up of a player (not just raw stat changes) should follow it rather than inventing a new voice.
- **Team-level rankings are already computed too**: farm system power rankings (prospect strength, pitching/batting depth, MLB-readiness), not just individual players — useful for a "farm system report" instead of only player-level content.

## 5. Site & deployment

- Hosted on Vercel, project connected directly to the GitHub repo (`main` branch) — **pushes to `main` auto-deploy**, no manual redeploy step needed for routine changes.
- Worth monitoring: build failures. These aren't surfaced anywhere automatically today — checking deployment status/build logs after a change and flagging a failure is a real, currently-unfilled gap.
- The site's owner-vs-guest access split is a lightweight signed-cookie gate (not full user accounts) — not something automation needs to interact with directly unless a task specifically requires acting as the owner in a browser.
- Database schema-hygiene check: Supabase has an advisor tool that flags real issues (e.g., a new table accidentally shipped without Row Level Security turned on — this happened once already and went unnoticed for days). Running this after any schema change, on a schedule, catches that class of problem automatically instead of by luck.

## 6. Suggested sequencing

Start with **read-only, report-generation work** (weekly movers write-ups, Slack posts summarizing existing computed data) before being handed the `service_role` key for write access to production data. Prove out the reporting/posting loop first; treat wiring up the actual data-refresh pipeline (which requires real production write credentials) as its own, separately-approved step once that's working.
