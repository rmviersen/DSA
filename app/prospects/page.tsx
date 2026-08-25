import { FarmSystemReportBody } from "../_components/FarmSystemReportBody";

export const dynamic = "force-dynamic";

export default async function ProspectsPage({ searchParams }: { searchParams: { team?: string; since?: string } }) {
  const orgId = searchParams.team ? Number(searchParams.team) : undefined;
  const baselineRefreshRunId = searchParams.since ? Number(searchParams.since) : undefined;
  return <FarmSystemReportBody title="Top Prospects" basePath="/prospects" orgId={orgId} baselineRefreshRunId={baselineRefreshRunId} />;
}
