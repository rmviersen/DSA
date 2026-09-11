import { makeSupabaseClient } from "./supabase-client";

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
export const DEFAULT_LEAGUE_SLUG = "TBL";

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

// Convenience for page.tsx files (2026-09-10) -- pages don't hold a Supabase
// client of their own (that stays inside lib/, by design), so this spares
// every page from also having to import makeSupabaseClient just to resolve
// which league it's rendering. TEMPORARY: once routing (multi-league plan
// §4, app/[league]/...) exists, every one of these call sites becomes
// `resolveLeagueId(params.league)` instead of this hardcoded-to-TBL default
// -- that's the one-line swap Step 3 makes at each site, not a redesign.
export async function getDefaultLeagueId(): Promise<number> {
  return getLeagueId(makeSupabaseClient());
}
