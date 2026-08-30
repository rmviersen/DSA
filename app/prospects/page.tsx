import { FarmSystemReportBody } from "../_components/FarmSystemReportBody";

export const dynamic = "force-dynamic";

export default async function ProspectsPage({ searchParams }: { searchParams: { team?: string; since?: string } }) {
  const orgId = searchParams.team ? Number(searchParams.team) : undefined;
  const baselineRefreshRunId = searchParams.since ? Number(searchParams.since) : undefined;
  // showInternalLinks hardcoded true (2026-08-30) -- unlike /TBL/prospects,
  // this page is never guest-reachable at all (not in middleware.ts's
  // GUEST_ALLOWED_PATHS), so anyone who actually loads it is already a
  // confirmed real owner; no need to re-check the owner cookie here too.
  return <FarmSystemReportBody title="Top Prospects" basePath="/prospects" orgId={orgId} baselineRefreshRunId={baselineRefreshRunId} showInternalLinks />;
}
