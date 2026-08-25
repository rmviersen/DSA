// Pure, client-safe display helpers -- deliberately kept in their own module
// with NO Supabase import (2026-08-20). These used to live in lib/queries.ts,
// which is fine for server components but breaks the moment a "use client"
// component imports a *value* (not just a type) from queries.ts: Next.js
// then bundles queries.ts's module-level `makeSupabaseClient()` call into the
// browser, where it throws "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must
// be set" because those are server-only secrets never sent to the browser.
// Confirmed the hard way when ProspectTable.tsx became a client component
// for its H/P/Role filters and crashed on every load. Any new pure
// display-only helper that a client component might need should go here,
// not in queries.ts, even if queries.ts also re-exports it for convenience.

// Public-facing display rule (2026-08-18): never show Overall/Potential/
// Prospect Potential at full precision anywhere a reader outside this org
// could see it (Slack reports, eventually the public site) — that precision
// is effectively the scout ratings underneath, which we don't want other
// GMs reverse-engineering. The underlying grades (Cntct/Pow/Stf/etc.) stay
// visible for now but are planned for removal later; this only covers the
// three composite grades. Internal/db values stay full-precision — this is
// a display-time rounding, not a change to what's computed or stored, so
// ranking still uses the precise numbers underneath.
export function roundGrade(n: number | null): number | null {
  return n === null || n === undefined ? null : Math.round(n / 5) * 5;
}

// Confirmed 2026-08-18 by cross-referencing team pages' displayed level labels
// (e.g. "BELLEVILLE BULLS (AAA)", "COBOURG COUGARS (U28, AA)") against the
// players.level codes on their rosters.
const LEVEL_LABELS: Record<number, string> = {
  0: "—", 1: "MLB", 2: "AAA", 3: "AA", 4: "A+", 5: "A-", 6: "Rookie",
  // Not a real players.level value -- a synthetic tier used where
  // international/complex signees need their own rung below Rookie (see
  // isInternational in org-minors-query.ts and getRoleLevelBenchmarks in
  // queries.ts). Those players are actually stored at level=1 with a
  // negative league_id, not a distinct level code of their own.
  7: "International",
};
export function levelLabel(level: number | null): string {
  return level === null ? "—" : (LEVEL_LABELS[level] ?? `Lvl ${level}`);
}

// StatsPlus serves team logos at a predictable slug of "{name}_{nickname}",
// lowercased with non-alphanumerics collapsed to underscores. Not verified
// for every team (only spot-checked a handful) — a mismatched slug just
// means a broken image, not a crash, so left as a best-effort helper rather
// than something scraped for all ~240 teams up front.
export function teamLogoUrl(name: string | null, nickname: string | null): string | null {
  if (!name || !nickname) return null;
  const slug = `${name}_${nickname}`.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `https://atl-02.statsplus.net/thebigleague/reports/news/html/images/team_logos/${slug}.png`;
}
