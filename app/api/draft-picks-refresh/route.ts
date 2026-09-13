import { NextResponse, type NextRequest } from "next/server";
import { makeStatsPlusClient } from "../../../lib/statsplus-client";
import { makeSupabaseClient } from "../../../lib/supabase-client";
import { getLeagueId, getCurrentSeasonYear, DEFAULT_LEAGUE_SLUG } from "../../../lib/league";
import * as map from "../../../lib/mappers";

// Auto-refresh target for /draft (2026-09-13, Rees's ask, same live-draft
// afternoon as check-draft-picks.ts -- "set it up to auto-refresh every few
// minutes" instead of him having to run that script by hand). Same exact
// logic as that script (pull StatsPlus's public, no-auth draftv2 feed, upsert
// into draft_picks), just reachable over HTTP so a client component on the
// page itself can call it on a timer -- see DraftAutoRefresh.tsx.
//
// No owner-cookie check here: this path isn't in middleware.ts's
// GUEST_ALLOWED_PATHS, so a guest request never reaches this handler at all
// (middleware redirects it before Next resolves the route) -- same reliance
// on middleware as every other owner-only page/action in this codebase (see
// lib/owner-cookie.ts's own comment on this).
//
// draft_year is resolved automatically via getCurrentSeasonYear (the
// league's real in-game calendar year) rather than requiring an argument
// like the CLI script does -- there's no human here to pass --year=, and the
// draft class in progress is always the current season's, by definition.
export async function GET(req: NextRequest) {
  try {
    const supabase = makeSupabaseClient();
    // ?league=TBL (matches the URL segment DraftAutoRefresh already knows,
    // via useParams) -- defaults to TBL for a bare hit, same as every other
    // no-slug-given call in this codebase, but a future Duud draft can pass
    // its own slug without any code change here.
    const leagueSlug = req.nextUrl.searchParams.get("league") ?? DEFAULT_LEAGUE_SLUG;
    const leagueId = await getLeagueId(supabase, leagueSlug);
    const draftYear = await getCurrentSeasonYear(supabase, leagueId);
    const sp = makeStatsPlusClient({ baseUrl: process.env.STATSPLUS_BASE_URL! });

    const draftRows = await sp.draft();
    const mapped = draftRows.map((r) => map.mapDraftPick(r, draftYear));

    const BATCH_SIZE = 500;
    for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
      const batch = mapped.slice(i, i + BATCH_SIZE).map((r) => ({ ...r, dsa_league_id: leagueId }));
      const { error } = await supabase.from("draft_picks").upsert(batch as never[], { onConflict: "dsa_league_id,player_id" });
      if (error) throw new Error(`draft_picks upsert failed: ${error.message}`);
    }

    return NextResponse.json({ ok: true, draftYear, totalPicks: mapped.length, checkedAt: new Date().toISOString() });
  } catch (err) {
    console.error("draft-picks-refresh failed:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
