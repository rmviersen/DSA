# Prospect Bio Style Guide

**Purpose:** reference for writing the short scouting-style blurbs on the Top Prospects report (`/prospects`, `ProspectTable.tsx`'s detail row). Established 2026-08-19 through a back-and-forth with Rees testing on the system's real top 10 prospects. Read this before writing or regenerating any batch of bios — it's the accumulated rulebook, not a one-off note.

## 1. Research basis

Style and conventions were reverse-engineered from real MLB Pipeline scouting content, read directly (not guessed at):
- [Jesús Made scouting report](https://www.mlb.com/milb/prospects/brewers/jesus-made-815908) — hitter bio example
- [Kade Anderson scouting report](https://www.mlb.com/milb/prospects/mariners/kade-anderson-807739) — pitcher bio example
- [MLB.com Scouting Grades glossary](https://www.mlb.com/glossary/miscellaneous/scouting-grades) — the official 20-80 scale definition

**Never copy their actual sentences.** The point of reading them was to learn the *structure and vocabulary* of how scouts talk about tools — original composition only, using our own data. Reproducing their prose would be a copyright problem, not just a style one.

## 2. Hard rules (non-negotiable, confirmed explicitly by Rees)

1. **No numeric grades, ever.** Words only ("plus," "elite," "below average"). This is the same rationale as the existing Overall/Potential rounding rule elsewhere on this page (gotcha 9 in `HANDOFF.md`) — a blurb that says "70 stuff" is just as much a leaked scout grade as an unrounded number in a column, and this page is headed for the shared league Slack where other GMs can see it.
2. **Grade off POTENTIAL, not current, for anything that has a potential grade.** Current tool grades tell you how far along a prospect is; *potential* is what actually drives prospect rank and what the bio should be selling. Only fall back to the current-value field for tools that have no potential counterpart at all (see §3 — speed, stamina, and all fielding sub-grades have no `pot_*` equivalent in this data; that's a real gap in what OOTP tracks, not an oversight to fix here).
3. **One concise sentence per player, 140 characters max**, for the in-table version (the detail row underneath each player's main row). This is *not* the place for the longer 3-4 sentence MLB-Pipeline-style paragraph — that fuller form is a separate, optional format for an actual published report, not the compact list view. The 140-char cap is a hard rule, not a suggestion (2026-08-20) — a long unbroken bio was inflating the table's auto column-width calculation and stretching other columns wider than their own content needed, even though the text itself wraps fine visually. `ProspectTable.tsx`'s `capBio()` enforces this as a backstop (ellipsis-truncates anything over the limit), but write to the limit in the first place rather than relying on that — a hard truncation mid-thought reads worse than a tighter original sentence.
4. **Call out premium-position defense explicitly** (SS, CF, C) when defense is a real carrying trait — matches real scouting convention (Made's own bio closes on exactly this: "could be a franchise player at a premium position"). Don't bother calling out non-premium defense (1B, corner OF) as a selling point.
5. **Mention injury risk only when it adds real information.** `prone` (a real makeup grade already in our data — values like `"Normal"` / `"Durable"` seen so far) is worth a callout when it's favorable/notable (e.g. "graded durable on makeup, a real plus given how much of his value is speed and defense"). Don't pad every blurb with a boilerplate "no injury concerns" when the value is just the default `"Normal"` — that's noise, not signal.
6. **Work in a relevant current-level stat when it's natural and backed by real signal** (2026-08-20) — e.g. a power hitter's slugging line, an elite defender's ZR, a swing-and-miss pitcher's strikeout rate, or a standout current-production WAR. **Only when it fits and the sample is real** — don't force a stat mention onto a player whose tools don't point that way, and don't cite a number from a tiny sample (under ~20 AB or ~10 IP) even if it looks flashy; it's not reliable enough to hang a sentence on. A player with no AB/IP at their current level gets no stat mention at all — that's what the "No Stats" stat-line label (not the bio itself) already communicates.

**Character-count lesson (2026-08-20):** hand-counting characters while drafting is unreliable at any real scale — on the full 100-player batch, roughly 94 of 100 first drafts came in over the 140 cap despite each one "feeling" short enough while writing. Draft freely, then run every batch through an actual `len()` check (not eyeballing) before it goes anywhere near the database, and re-check again after any find-and-replace trimming pass — mechanical trims (stripping "already"/"real"/etc.) can silently break grammar (e.g. leave "a everyday" instead of "an everyday," or collide two edits into "building at in") in ways a length check alone won't catch. Grep for the specific patterns you introduced, not just the count.

## 3. Which tool maps to which database field

All from `player_ratings_snapshots` (latest `refresh_run_id`) unless noted. **Potential fields exist for these and should be preferred:**

| Bio concept | Batters | Pitchers |
|---|---|---|
| Contact / Command | `pot_cntct` | — |
| Power | `pot_pow` | — |
| Gap power | `pot_gap` | — |
| Eye / plate discipline | `pot_eye` | — |
| Stuff | — | `pot_stf` |
| Movement | — | `pot_mov` |
| Control / command | — | `pot_ctrl` |
| Individual pitches | — | `pot_fst`, `pot_crv`, `pot_sld`, `pot_chg`, `pot_cutt`, `pot_splt`, `pot_frk`, `pot_circhg`, `pot_knbl`, `pot_kncrv` (0 = doesn't throw that pitch; worth a mention when a specific pitch is a standout or a notable gap in the repertoire — see the Blum example in §5) |

**No potential grade exists for these — current value is genuinely the only data available, not a choice to simplify:**

| Bio concept | Field(s) |
|---|---|
| Speed | `speed` |
| Stamina (pitchers) | `stm` |
| Infield defense | `ifr` (range) / `ife` (error/hands) / `ifa` (arm) |
| Outfield defense | `ofr` (range) / `ofe` (error) / `ofa` (arm) |
| Catcher defense | `cfrm` (framing) / `carm` (arm) / `cblk` (blocking) |
| Injury/makeup risk | `prone` (`player_ratings_snapshots`), `injury_is_injured` / `injury_dl_left` (`players`) |

`player_computed.role` (SP/RP/INF/OF/C/UTIL — see gotcha in `HANDOFF.md`) is a good positional/defensive-grouping anchor for the bio's framing, distinct from `players`/ratings-snapshot `pos`.

## 4. Grade-to-word calibration

Recalibrated 2026-08-19 from Rees's own usage ("R.J. Blum's *70 potential grade stuff*" = **elite**) — this runs one tier hotter than the literal MLB.com glossary wording (which calls 70-80 "well above average," not "elite"). Use this table, not the glossary's literal bands:

| Grade range | Word |
|---|---|
| ≤30 | well below average |
| 35–40 | below average |
| 45–55 | average |
| 60–65 | plus |
| 70–80 | elite |

(The `gradeWord()`/`prospectSummary()` auto-generated one-liner this table used to fall back to for players without a stored bio was removed entirely on 2026-08-20 — see §7's note below. This calibration table now only matters for hand/AI-written bios.)

## 5. Worked examples (approved 2026-08-19 — treat as the calibration reference)

> **R.J. Blum, SP** — Blum's stuff projects to elite, with plus movement and command to match and a workhorse's stamina; the lack of a real breaking ball is a lesser concern than the ceiling on his fastball-splitter combo.
>
> **J.P. Schall, CF** — Schall's glove is already elite in center, and the bat is trending that way too, with elite raw power and gap pop backed by a plus eye and plus speed.
>
> **Carlos Navarro, CF (19)** — Navarro's hit tool and gap power both project to elite, though over-the-fence pop lags; elite speed and a plus glove in center give him a real floor either way.

Full set of 10 (all approved) lives in this session's transcript, not duplicated here — regenerate fresh against current data rather than copy-pasting old ones forward, since the underlying grades will have moved by the next publish.

## 6. Tone

Technical and declarative, not hype-y. Say what the tool *is* and, briefly, what it *means* for the profile (mid-rotation vs. frontline, everyday vs. bench, premium-position floor) — don't just list adjectives. Rees's own sentence is the model: *"[tool] projects to be elite, [secondary detail] is less important than [the carrying trait]."* Lead with whatever's actually the carrying trait for that specific player, not a fixed field order.

## 7a. Expanded format (2026-08-30) — supersedes rule §2.3's length cap

Bios are no longer always-visible: `/prospects`' cards now expand on click (whole card, not a small toggle), so the old 140-char-per-blurb constraint (written when the bio sat permanently in the card's collapsed layout) no longer applies. **Rule §2.3 (one sentence, 140 chars) is retired.** Every other hard rule in §2 stays in force unchanged — no numeric grades ever, grade off potential not current, premium-position defense called out, injury/makeup mentioned only when notable, a current-level stat only when it's backed by real signal.

The new target is a real 3-5 sentence scouting paragraph, MLB-Pipeline-style (the format §2.3 originally called out as "a separate, optional format for an actual published report" — that's now this page). Structure, in roughly this order, using whichever pieces are actually true and notable for that player (skip anything that doesn't apply — never invent a fact to fill a slot):

1. **Draft/acquisition background** — round, pick, drafting org, year (from `players.draft_year/draft_round/draft_overall_pick` and `draft_picks.team_name`, or "signed as an international free agent" / "undrafted" when there's no draft record at all).
2. **Development trajectory** — the real shape of a player's minor-league climb, grounded in actual year-by-year stats history (`player_batting_stats_snapshots`/`player_pitching_stats_snapshots`, **not scoped to one refresh_run_id** — see the 2026-08-30 gotcha in `lib/player-detail-query.ts`: a player's early-career years only exist under the old one-time 2001-2031 backfill run, not the latest refresh, so querying just the latest run silently truncates history to the current season only). Call out a real signal when one exists — a multi-year workload streak (e.g. three straight 150+ IP seasons), a level jump, a breakout year — not a generic "has progressed nicely."
3. **Tool-by-tool observations**, potential-graded, in words only, same calibration table as §4 — lead with whichever tool is the actual carrying trait for that player, not a fixed order. Individual pitch grades are fair game here the same as §3 always allowed (a specific plus-or-better weapon, or a notably lagging pitch, is worth naming).
4. **Team/org fit and projection** — what the profile means concretely (mid-rotation vs. frontline, everyday regular vs. bench, a premium-position floor), framed against the player's own organization by name.
5. **A current-level stat callout**, same real-signal-only rule as §2.6, now allowed to cite more than one number if the sample supports it (a full slash line, a IP/WAR pairing) rather than being squeezed to whatever fits in 140 characters.
6. **ETA / timeline expectation** when `eta` or the player's current level make a concrete, honest read possible (e.g. already at the top level and performing = "a big-league look in short order"). Don't force a timeline claim that isn't backed by the data.
7. **Trade history**, only when a player has actually been traded (not yet wired into any query as of 2026-08-30 -- there's no trade-log table this guide's authors have found in the schema; treat as a gap to flag to Rees if a bio subject's real trade history is known some other way, not something to fabricate or leave a placeholder for).

**Grounding discipline, non-negotiable:** every specific fact in a bio -- the draft slot, the org, the workload numbers, the current stat line -- must come from a real query result checked against the actual data for that player, never inferred from a hypothetical/example bio's specifics (even one that reads as highly plausible). The style-guide examples in this file (and in any prompt asking for bios) are templates for *structure and tone*, never a source of facts for a real player's bio unless independently verified.

## 7. Scaling beyond the top 10 — built 2026-08-20

Discussed 2026-08-19, built the next day. The one-line-per-player style above does **not** scale as an always-live template function the way the page's other auto-generated content does — writing something this specific for 100 players is real writing, not something a JS template can produce without becoming repetitive.

What *does* scale, and is now live: doing this as an **occasional, assisted batch pass** — someone (Rees, or an AI session working from this guide) generates all ~100 bios at once, grounded in the rules above, and the results get **stored**, not recomputed on every page load. Displayed statically until the next publish regenerates them.

Infrastructure: `prospect_bios` table (`player_id` primary key — upserted, latest generation wins; `refresh_run_id` the bio was written against; `bio_text`; `generated_at`). `getTopProspectsDetailed()` in `lib/queries.ts` fetches and attaches these; `ProspectTable.tsx` shows the stored bio when one exists, and shows a small ⚠ (with a hover explanation) if a stored bio's `refresh_run_id` is older than the current snapshot's.

**No fallback text for uncovered players (changed 2026-08-20).** Originally, anyone without a stored bio fell back to an auto-generated `gradeWord()`/`prospectSummary()` one-liner — that function has been deleted entirely. This mattered in practice: `/prospects` scoped to one org (`?team=`) re-ranks *within that org*, pulling in players who never made the leaguewide top 100 and so never got a written bio — those rows now show only the stat line, nothing after it. Don't reintroduce an auto-generated substitute without checking with Rees first; showing *no* bio for an uncovered player is the deliberate, current design, not a gap to quietly patch over.

**Regenerating a full batch, practically:** pull rich per-player data (potential grades, individual pitches, injury signal, *and* current-level stats per rule 6 above) in one query for everyone with `prospect_rank <= 100` against the latest `player_computed` snapshot, draft against §5's calibration, run the length/grammar checks from the character-count lesson above, then upsert. Took roughly 2 SQL batches of 50 rows each on the one time this has been done at full scale (2026-08-20) — a single `insert ... on conflict` easily handles 50 rows without hitting response-size limits; 100 in one shot may not fit depending on average bio length.
