import { NextResponse, type NextRequest } from "next/server";
import { makeStatsPlusClient } from "../../../lib/statsplus-client";
import { makeSupabaseClient } from "../../../lib/supabase-client";
import { getLeagueId, DEFAULT_LEAGUE_SLUG } from "../../../lib/league";
import { syncDraftPicks } from "../../../lib/draft-picks-sync";

// Auto-refresh target for /draft (2026-09-13, Rees's ask: "set it up to auto-refresh every few minutes"). The same pull-and-store as the main
// refresh, via the SHARED lib/draft-picks-sync.ts, reachable over HTTP so DraftAutoRefresh.tsx can call it on a timer. (Until 2026-10-20 this
// route kept its own copy that stamped the CURRENT season year on every row of the feed -- which contains every past draft too -- instead of
// each player's real draft_year.)
//
// No owner-cookie check here: this path isn't in middleware.ts's GUEST_ALLOWED_PATHS, so a guest request never reaches this handler at all
// (middleware redirects it before Next resolves the route) -- same reliance on middleware as every other owner-only page/action in this codebase.
export async function GET(req: NextRequest) {
  try {
    // StatsPlus began requiring credentials on this feed on 2026-10-19 (401 otherwise). The token must be an environment variable of the Vercel
    // project (Production), not only a GitHub Actions secret -- say so plainly rather than surface a bare 401.
    if (!process.env.STATSPLUS_API_TOKEN) {
      throw new Error("STATSPLUS_API_TOKEN is not set in this deployment's environment (Vercel project tbl-dsa > Settings > Environment Variables > Production), or the site was not rebuilt after it was added.");
    }
    const supabase = makeSupabaseClient();
    // ?league=TBL (the URL segment DraftAutoRefresh already knows) -- defaults to TBL like every other no-slug-given call here.
    const leagueSlug = req.nextUrl.searchParams.get("league") ?? DEFAULT_LEAGUE_SLUG;
    const leagueId = await getLeagueId(supabase, leagueSlug);
    const sp = makeStatsPlusClient({ baseUrl: process.env.STATSPLUS_BASE_URL!, apiToken: process.env.STATSPLUS_API_TOKEN });
    const { totalPicks, liveClassPicks } = await syncDraftPicks(supabase, sp, leagueId);
    return NextResponse.json({ ok: true, totalPicks, liveClassPicks, checkedAt: new Date().toISOString() });
  } catch (err) {
    console.error("draft-picks-refresh failed:", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
