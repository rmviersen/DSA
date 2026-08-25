import { FarmSystemReportBody } from "../_components/FarmSystemReportBody";

export const dynamic = "force-dynamic";

// The standalone, external-facing version of /prospects (2026-08-20) -- same
// content, but no site nav (see ConditionalNav.tsx, which specifically hides
// SiteNav for any /report route) and a title that reflects it covers both
// prospect rankings and system rankings, not just prospects. This is the
// page whose URL is meant to actually go out to the league.
export default async function ReportPage({ searchParams }: { searchParams: { team?: string; since?: string } }) {
  const orgId = searchParams.team ? Number(searchParams.team) : undefined;
  const baselineRefreshRunId = searchParams.since ? Number(searchParams.since) : undefined;
  return <FarmSystemReportBody title="Farm System Report" basePath="/report" orgId={orgId} baselineRefreshRunId={baselineRefreshRunId} />;
}
