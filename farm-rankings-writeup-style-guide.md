# Farm Rankings Write-Up Style Guide

**Purpose:** rulebook for the per-organization write-ups shown when a card is expanded on Farm Rankings (`/TBL/prospects/farms`, `SystemRankingsCards.tsx`; stored in `org_system_bios`). Established 2026-09-18 with Rees. Read this before writing or refreshing a batch. Companion to `prospect-bio-style-guide.md` (individual prospects) -- the hard rules there about words-not-numbers carry over unchanged.

## 1. Style reference

Structure and voice are modeled on MLB Pipeline's in-season farm system rankings article (<https://www.mlb.com/news/in-season-farm-system-rankings-2026>, Sam Dykstra, Aug 2026). It was read for *structure and tone only* -- **never reuse its sentences or phrasing**; original composition from our own data. What it does that we copy:

- One tight paragraph per org (theirs run ~100-160 words; ours **80-140**).
- **Opens with the story of the ranking**, not a list: where the system moved and *why* (a rise/fall vs. the last edition, a graduation, a draft class, a top prospect carrying the group).
- **Names the top prospects** with their league-wide rank in parentheses -- `Name (No. 26)` -- and says what makes each one notable in one clause.
- **Balances strengths and weaknesses** honestly (a thin pitching side, a hitter whose power lags, an org light on depth). A weak system gets a plain, respectful read on what's missing and where the pipeline could come from -- no mockery, no filler.
- **Closes with the takeaway**: the overall shape of the system (top-heavy vs. deep, near-ready vs. years away, bat-first vs. arm-first).
- Voice: confident, declarative, scout-literate, not hype. Vary the first sentence across orgs so 32 paragraphs don't read as one template.

## 2. Hard rules

1. **Every fact comes from the fact sheet** (`scripts/farm-writeup-facts.ts`, §4). Never from memory, never inferred from another org's write-up or an example. Draft slot, round, age, level, stat line, ETA, rank movement -- all read off the sheet. If the sheet doesn't say it (e.g. trade history, injuries beyond the durability word, an org's "recent trades"), **don't write it**.
2. **No numeric tool grades, ever.** Words only, using the same calibration as `prospect-bio-style-guide.md` §4: elite (70-80), plus (60-65), average (45-55), below average (35-40), well below average (30 and under). The fact sheet already emits words, never numbers -- copy the words. (Ranks like "No. 26" and stat lines are fine; those are already public.)
3. **Prospect rank = league-wide `prospect_rank`**, and org/system ranks are the current Farm Rankings order. Movement ("up two spots", "the largest fall of any system") is measured **against the baseline run named at the top of the fact sheet** (default: the earliest run within ~70 days before the latest, i.e. roughly a preseason snapshot). Say "since mid-March" or similar -- match the baseline date, don't claim a season boundary the data doesn't establish. Only call something "the largest"/"tied for the most" after checking the whole sheet.
4. **Grade off POTENTIAL where a potential grade exists** (hit, power, gap power, discipline, stuff, movement, control, each pitch); speed, stamina and defense have only current values -- the sheet handles this. A tool listed with "below average" is a fair, useful caveat.
5. **Stats: only when the sheet gives a line.** The sheet prints "no meaningful current-season sample -- do not cite stats" under 60 AB / 20 IP; obey it. Don't quote flashy tiny samples.
6. **Don't restate things the card already shows and that change every sim**: MLB record and division standing, live top-100/200 counts as the *lead* fact are on the card. (Counts can appear in prose as supporting color -- they were at write time -- but the write-up will be marked stale once data moves.)
7. **Draft class:** the fact sheet names who was drafted by which org in the last completed draft. Say "the Nth overall pick in the 2031 Draft" using the sheet's round/pick; only claim an org "drafted" a player if the sheet says `drafted by <that org>`.
8. **Durability:** mention only when the sheet lists it (durable/fragile/injury-prone) *and* it adds information.
9. **Levels:** write Triple-A / Double-A / A+ / A / A- / Rookie ball / "the international complex" / "in the big leagues" to match the sheet's `currently at` label.
10. **No fabricated specifics** to fill a slot. A three-prospect farm gets a short paragraph, not padding. (The 2026-09-18 batch's own review caught overstated claims -- e.g. calling a two-draftee bump "the draft class", "one Top 100" for an org that had three -- before shipping; re-check every count against the sheet.)

## 3. Paragraph shape (a menu, not a template)

Use whichever of these are true and interesting for that org, roughly in this order:

1. **Movement + the reason** ("Toronto jumps four spots, powered by the league's third-best pitching group.").
2. **The headliner(s)**: name, rank, position, the carrying tools in words, current level, and a stat line if the sample is real.
3. **Supporting names** that show depth or a specific strength/weakness (a group of hitters, a bullpen arm with an elite pitch, a catcher who's a step from the majors).
4. **Draft/acquisition color** if the sheet has it (the 2031 first-rounder, several draftees in the top 200).
5. **Readiness**: names with an ETA of this year or sooner, or "readiness ranks 32nd, none of it is close."
6. **The system's shape**: bat-first vs. arm-first (sub-ranks), Blue-Chip/Depth/Balance in words, top-heavy vs. deep. The three grade words (`Elite/Plus/Average/Below Average/Well Below Average`) come straight from the card.

Bottom-of-the-table orgs (a handful of top-200 names) get the shorter end of the range and an honest "what would change this" close.

## 4. Data source -- the fact sheet

```
npx tsx scripts/farm-writeup-facts.ts --out=farm-facts.md [--baseline=<refresh_run_id>]
```

(Requires `.env` from `~/secrets/dsa-platform.env` -- copy in, run, delete, per the standing credential rule.) Read-only. Per org, in current system-rank order, it prints: rank + movement vs. baseline, batting/pitching/readiness sub-ranks, Blue-Chip/Depth/Balance words, MLB record/standing, top-100/200 counts, hitter/pitcher split, draft-class and near-ready counts, and up to 7 top-200 prospects each with rank, role, age, ETA, draft slot (if from the last draft), tools in words, current-season stat line (if the sample is real), and current level. It is the **only** source a write-up may use.

## 5. Storing and refreshing

- Write-ups live in **`farm-writeups/<game-date>.json`** (`{ "<organization_id>": "text", ... }`, keys starting with `_` ignored). Commit each batch -- it's the history of what was said and against which data.
- Upload: `npx tsx scripts/upsert-org-bios.ts farm-writeups/<file>.json [--run=<refresh_run_id>]`. Upserts one row per org into `org_system_bios` (latest wins), tagged with the run the facts came from (default: latest `player_computed` run).
- **Stale messaging is automatic** (same mechanism as prospect bios): the card shows "stale since <game date>" once a write-up's `refresh_run_id` is older than the current snapshot. Nothing to wire up.
- **When to refresh:** the writing pass is manual (same reasoning as `prospect-bio-style-guide.md` §7-8: finding what changed is automatable, writing is not). A reasonable cadence is monthly / after a draft / after a big trade window; refresh sooner if several orgs move 5+ spots. Regenerate the whole batch rather than patching one paragraph -- rankings are relative, so one org's move changes the story for others.
- **Process for a batch:** (1) pull the fact sheet; (2) draft all 32 against §2-3; (3) **audit every count, rank and "largest/most" claim against the sheet** (do this as a separate pass -- the first draft of the 2026-09-18 batch needed ten corrections); (4) save the JSON; (5) upsert; (6) commit the JSON and add a HANDOFF.md note.

## 6. Worked example (structure only -- 2026-09-18, Fort Collins, No. 1)

> Opens with the move and the reason ("climbs two spots since mid-March to reach No. 1... the best collection of arms in the league"), names the headliner with rank and tools in words plus an honest caveat about his current results, adds three supporting names at different levels, and closes on the system-shape grades (Top 100 count, elite blue-chip and depth, fifth-best readiness).

Full batch: `farm-writeups/2032-05-24.json`. Don't copy sentences forward -- regenerate against fresh data.
