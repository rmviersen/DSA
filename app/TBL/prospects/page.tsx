import { FarmSystemReportBody } from "@/app/_components/FarmSystemReportBody";
import { checkOwnerState } from "@/lib/owner-cookie";

export const dynamic = "force-dynamic";

// The public-facing Top Prospects page (2026-08-25), moved here from
// /report per Rees's URL scheme -- "TBL" (TheBigLeague, the league this
// whole site covers) as a prefix leaves room for other leagues under this
// same domain later without a URL collision. System Rankings, which used
// to sit side-by-side with this table on the same page, now lives at its
// own page, /TBL/prospects/farms (showRankings={false} below) -- see that
// page and ReportHeader.tsx for the rest of the split.
export default async function TblProspectsPage({ searchParams }: { searchParams: { team?: string; since?: string } }) {
  const orgId = searchParams.team ? Number(searchParams.team) : undefined;
  const baselineRefreshRunId = searchParams.since ? Number(searchParams.since) : undefined;
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
      title="Top Prospects"
      basePath="/TBL/prospects"
      orgId={orgId}
      baselineRefreshRunId={baselineRefreshRunId}
      showRankings={false}
      showInternalLinks={showInternalLinks}
    />
  );
}
