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
