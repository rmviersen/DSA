# Development Lab — notes for a future page

**Status: not built. This is a captured note for a future feature, per Rees's
2026-09-02 ask** ("save this on the site somewhere to remember and turn into
a page in the future") — no code exists yet. First real use was an ad hoc
manual analysis (same session) picking OKC candidates for the in-game lab
submission; see git history / conversation log for that specific list if it's
ever needed again — it's a one-off recommendation, not stored data.

## What the Development Lab is

An in-game mechanic (separate from anything StatsPlus/this platform ingests
automatically): each sim, an org can submit **up to 12 players** to a
development lab to work on **one specific tool** each. Candidates should be
**young (Rees's cutoff: under 29)** and **either already at the MLB level or
a year or two of ETA away** — the lab is for polishing a near-ready or
established player's one real hole, not developing a raw prospect broadly.

## Success-rate difficulty tiers (Rees's estimates, 2026-09-02 — not official
StatsPlus/OOTP-documented numbers, just his read on it)

| Tool / skill | Difficulty | Rees's note |
|---|---|---|
| Baserunning (general instincts — `run`) | Very Easy | |
| Base Stealing (`steal`/`stlrt`) | Very Easy | |
| Learn New Position | Easy | |
| Running Mechanics (Speed — `speed`) | Medium | |
| Plate Discipline (Eye — `eye`) | Medium | |
| Gap Power (`gap`) | Medium | |
| Strength and Conditioning (Injury proneness — `prone`) | Hard | "feels like it's 50/50" |
| All fielding ratings (`cblk`/`cfrm`/`carm`, `ifr`/`ife`/`ifa`/`tdp`, `ofr`/`ofe`/`ofa`) | Hard | "feels like it's 50/50" |
| Contact (`cntct`) | Hard | "feels like it's 50/50" |
| Power (`pow`) | Hard | "feels like it's 50/50" |

**Notable gap**: no pitching-specific tool (Stuff/Movement/Control/Stamina)
appears anywhere in Rees's list. Working assumption for the one-off analysis
this note came from: **the lab is hitting/fielding/baserunning-only** —
pitchers may only be eligible via the universal Injury/Conditioning and
Learn New Position categories, not for their actual pitch-quality grades.
**Not confirmed** — worth confirming with Rees directly before this becomes
a real feature, since it changes whether pitchers are lab-eligible at all.

## What a real page would need (sketch, not scoped)

- A per-player "best lab target" suggestion: the single tool with the
  biggest gap between current grade and where the player's *other* tools
  (or Role/Overall) suggest it "should" be, weighted by how much that
  specific tool actually moves Overall/Batting/Pitching in `rating_weights`
  (a Very Easy tool with a tiny formula weight, like `run`/`steal`/`stlrt`
  feeding only Baserunning's small `w.baserunning` blend weight, is a safe
  pick but a small payoff; a Hard tool like Contact/Power is the opposite —
  high risk, high payoff).
- A concrete "expected value" framing: difficulty tier as a rough success
  probability (Very Easy/Easy ≈ near-certain, Medium ≈ good odds, Hard ≈
  Rees's own "50/50" estimate) × the real Overall/value swing if it lands,
  using the same formula weights `lib/rating-engine.ts` already computes
  with — no new rating logic needed, just a new lens on existing output.
- Org-scoped (like `/org-minors`), age/level-eligibility filter built in
  (age < 29, MLB or ETA within ~2 years) rather than left to manual judgment
  each time.
- A real place to record which 12 were actually submitted and the outcome
  (tool grade before/after next refresh) — this is the part that would make
  the "50/50 feels right" estimate above into something real: an
  automatically-improving prior instead of a permanently-guessed number,
  the same philosophy as every regression-tuned weight elsewhere in this
  project.
