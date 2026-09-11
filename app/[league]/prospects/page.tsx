import { FarmSystemReportBody } from "@/app/_components/FarmSystemReportBody";
import { checkOwnerState } from "@/lib/owner-cookie";
import { resolveLeagueId } from "@/lib/league";

export const dynamic = "force-dynamic";

// The public-facing Top Prospects page (2026-08-25), originally moved here
// from /report per Rees's URL scheme -- "TBL" (TheBigLeague, the league
// this whole site covers) as a prefix specifically to leave room for other
// leagues under this same domain later without a URL collision (see this
// comment's own history -- that anticipated need is exactly what Step 3 of
// the multi-league migration, 2026-09-10, built). Now one shared route
// under app/[league]/..., same as every other page -- only TBL actually
// exposes it publicly today (middleware.ts's GUEST_ALLOWED_PATHS only lists
// "/TBL/prospects"; Duud has no guest tier per Rees's own spec, so
// /Duud/prospects would 404 a real guest the same way any other /Duud/*
// page does). System Rankings, which used to sit side-by-side with this
// table on the same page, now lives at its own page, /TBL/prospects/farms
// (showRankings={false} below) -- see that page and ReportHeader.tsx for
// the rest of the split. Also absorbs the old standalone /prospects page
// (retired, now just a redirect here) -- that page was already unlinked
// from the nav (2026-08-27, "match the guest view for now") and would
// otherwise have collided with this exact URL once both moved under the
// same [league] segment.
export default async function ProspectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ league: string }>;
  searchParams: Promise<{ team?: string; since?: string }>;
}) {
  const { league } = await params;
  const leagueId = await resolveLeagueId(league);
  const search = await searchParams;
  const orgId = search.team ? Number(search.team) : undefined;
  const baselineRefreshRunId = search.since ? Number(search.since) : undefined;
  // Player names link to our internal /players/[id] pages only for a real
  // owner who ISN'T currently previewing as a guest (2026-08-30, Rees's
  // ask) -- a real guest, and an owner previewing what a guest sees,
  // should only ever get the external StatsPlus link. This is a display
  // choice, not the actual access boundary: /players/[id] is already
  // owner-only at the middleware level regardless of what any page links
  // to, so a guest typing the URL directly still gets redirected.
  const { isRealOwner, isPreviewingGuest } = await checkOwnerState();
  const showInternalLinks = isRealOwner && !isPreviewingGuest;
  return (
    <FarmSystemReportBody
      leagueId={leagueId}
      title="Top Prospects"
      basePath={`/${league}/prospects`}
      orgId={orgId}
      baselineRefreshRunId={baselineRefreshRunId}
      showRankings={false}
      showInternalLinks={showInternalLinks}
    />
  );
}
