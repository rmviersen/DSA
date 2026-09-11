import { makeSupabaseClient } from "./supabase-client";
import { DEFAULT_LEAGUE_SLUG } from "./league-slug";

type SupabaseClient = ReturnType<typeof makeSupabaseClient>;

// Every table now carries `dsa_league_id` (2026-09-10, multi-league
// architecture plan -- see multi-league-architecture-plan.md). Named
// `dsa_league_id`, deliberately NOT `league_id` -- that name was already
// taken on 11 tables by OOTP's own sub-league/level field before this work
// started, and conflating the two caused a real data-loss incident (see
// HANDOFF.md gotcha 35). Never reuse the bare name `league_id` for this
// concept anywhere in new code.
//
// Until Duud (the second league) is actually wired up, every script and
// query defaults to TBL. Resolved by slug via this lookup, not a hardcoded
// numeric id -- per the Supabase migration tool's own guidance, never
// hardcode a generated id in code that has to keep working if the table is
// ever rebuilt. Cached per-process (a script run or a single Next.js
// server lifetime) since `leagues` changes essentially never.
//
// DEFAULT_LEAGUE_SLUG itself lives in lib/league-slug.ts, not here -- see
// that file's comment for why (a "use client" component needs the bare
// constant without pulling in this file's Supabase import). Re-exported here
// so every existing server-side caller can keep importing it from this file.
export { DEFAULT_LEAGUE_SLUG };

const cache = new Map<string, number>();

export async function getLeagueId(supabase: SupabaseClient, slug: string = DEFAULT_LEAGUE_SLUG): Promise<number> {
  const cached = cache.get(slug);
  if (cached !== undefined) return cached;
  const { data, error } = await supabase.from("leagues").select("id").eq("slug", slug).single();
  if (error || !data) throw new Error(`No league found with slug "${slug}": ${error?.message}`);
  const id = (data as { id: number }).id;
  cache.set(slug, id);
  return id;
}

// Convenience for page.tsx files not under app/[league]/... (pages don't
// hold a Supabase client of their own, that stays inside lib/ by design).
// Only ever used by the handful of routes deliberately OUTSIDE the league
// segment (/, /login, /report -- redirect stubs and auth, which have no
// real "which league" concept of their own).
export async function getDefaultLeagueId(): Promise<number> {
  return getLeagueId(makeSupabaseClient());
}

// CLI helper (2026-09-11) for scripts/*.ts -- reads a `--league=<slug>`
// argument off process.argv, defaulting to TBL so every script's existing
// automation (GitHub Actions, cron, a bare `npm run compute-ratings`)
// keeps working completely unchanged unless someone explicitly asks for
// Duud. Added while auditing every regression/weight-tuning script for the
// "each league needs its own separately-computed weights, not one shared
// set" scoping pass -- see multi-league-architecture-plan.md and HANDOFF.md
// gotcha 39 for the full story of what this closes.
export function leagueSlugFromArgv(defaultSlug: string = DEFAULT_LEAGUE_SLUG): string {
  const arg = process.argv.find((a) => a.startsWith("--league="));
  return arg ? arg.slice("--league=".length) : defaultSlug;
}

// Resolves "what season is this league's own current in-game year," sourced
// from that league's own latest refresh_runs.game_date -- NOT a hardcoded
// literal year. Added alongside leagueSlugFromArgv() for the same reason:
// several regression scripts had "2031" hardcoded as "the current season,"
// which only ever meant TBL's current season at the moment that code was
// written, and would silently return zero rows for any other league (Duud's
// current season is 2027) -- and will eventually go stale for TBL itself
// once it moves past 2031 too.
export async function getCurrentSeasonYear(supabase: SupabaseClient, leagueId: number): Promise<number> {
  const { data, error } = await supabase
    .from("refresh_runs").select("game_date").eq("dsa_league_id", leagueId).eq("status", "succeeded")
    .not("game_date", "is", null).order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Could not resolve current season year: ${error.message}`);
  const gameDate = (data as { game_date: string | null } | null)?.game_date;
  if (!gameDate) throw new Error(`No succeeded refresh_runs with a game_date found for league ${leagueId} -- can't determine the current season year.`);
  return Number(gameDate.slice(0, 4));
}

// Resolves this league's own OOTP-native `players.league_id` value for the
// real MLB level -- NOT the same number across leagues (TBL=200, Duud=203,
// confirmed via real data). Several regression scripts hardcoded `=== 200`
// as "is this a real MLB roster player," found while auditing them for
// per-league correctness (2026-09-11) -- that would have silently excluded
// every one of Duud's real MLB players (wrong league_id), not blended data
// across leagues, but still a real bug once those scripts ever run for
// anything but TBL. `leagues.mlb_league_id` is the source of truth now.
export async function getMlbLeagueId(supabase: SupabaseClient, leagueId: number): Promise<number> {
  const { data, error } = await supabase.from("leagues").select("mlb_league_id").eq("id", leagueId).single();
  if (error || !data) throw new Error(`Could not resolve mlb_league_id for league ${leagueId}: ${error?.message}`);
  const mlbLeagueId = (data as { mlb_league_id: number | null }).mlb_league_id;
  if (mlbLeagueId == null) throw new Error(`League ${leagueId} has no mlb_league_id set on the leagues table.`);
  return mlbLeagueId;
}

// Resolves this league's own "my organization" for the owner-perspective
// pages (My Roster, Lineup, Rule 5 Draft, Org Minors) -- was a hardcoded
// `const DEFAULT_ORG_ID = 15` (Oklahoma City, TBL's org) copy-pasted into
// each of those 4 page.tsx files, found 2026-09-11 while bringing up Duud
// (Step 7): every one of those pages would have shown TBL's own org
// (or nothing meaningful) as Duud's default, not the White Sox -- confirmed
// with Rees back when Step 5 started ("my org is the Chicago White Sox").
// Self-contained (own Supabase client) to match resolveLeagueId()'s own
// page-convenience style -- these 4 call sites are all page.tsx files,
// which don't hold a Supabase client of their own by design.
export async function resolveDefaultOrgId(leagueId: number): Promise<number> {
  const supabase = makeSupabaseClient();
  const { data, error } = await supabase.from("leagues").select("default_org_id").eq("id", leagueId).single();
  if (error || !data) throw new Error(`Could not resolve default_org_id for league ${leagueId}: ${error?.message}`);
  const defaultOrgId = (data as { default_org_id: number | null }).default_org_id;
  if (defaultOrgId == null) throw new Error(`League ${leagueId} has no default_org_id set on the leagues table.`);
  return defaultOrgId;
}

// The real per-request resolver for every page under app/[league]/... --
// Step 3 of the multi-league plan (2026-09-10). Turns the URL's league slug
// into a real id, or 404s if it's not a real league (a typo'd URL, or a
// league slug that doesn't exist) rather than silently falling back to TBL,
// which would leak one league's data onto another league's URL.
export async function resolveLeagueId(slug: string): Promise<number> {
  try {
    return await getLeagueId(makeSupabaseClient(), slug);
  } catch {
    // Deferred import -- next/navigation's notFound() throws a special
    // NEXT_HTTP_ERROR_FALLBACK control-flow error that Next's own router
    // catches; importing it at module scope would pull a next/navigation
    // dependency into every script that imports lib/league.ts (scripts/
    // *.ts, which never run inside Next at all). notFound() is typed
    // `never` when imported normally, but TS can't see that through a
    // dynamically-destructured import -- the trailing throw is genuinely
    // unreachable at runtime, it's here only so this function's own
    // Promise<number> return type still type-checks.
    const { notFound } = await import("next/navigation");
    notFound();
    throw new Error("unreachable");
  }
}
