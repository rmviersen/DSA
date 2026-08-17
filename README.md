# OOTP Analysis — Platform (Phase 3)

The web platform that replaces the Power BI dashboard: prospect rankings, player ratings, team rankings, draft board, and (later) richer game-log-driven stats — reading from the StatsPlus API instead of manual OOTP CSV exports.

## Reference docs (parent directory)

Before touching this codebase, read these — they're the accumulated research this build is based on:

- `../power-bi-rating-system-analysis.md` — full breakdown of the existing Power BI rating engine (Overall/Potential/Prospect Potential formulas, weighting coefficients, team/org rankings) and the agreed target-spec changes for the rebuild.
- `../statsplus-api-inventory.md` — what data is actually available from the StatsPlus API: public endpoints (players, teams, contracts, draft, season stats), the session-auth-gated ratings export, and the separately-discovered HTML box score / game log / play-by-play reports.
- `../rebuild-action-plan.md` — architecture (Supabase + Vercel, own database refreshed manually via StatsPlus pulls, not a live connection) and build order.

## Status

Not yet started. Current priority: reach full parity with the existing Power BI reports before adding the deferred game-log/box-score scraping work.
