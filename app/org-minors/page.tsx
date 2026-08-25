import { getOrgMinorsPlayers } from "@/lib/org-minors-query";
import MinorsTable from "./MinorsTable";

// Oklahoma City Outlaws, org id 15 -- confirmed via StatsPlus header ("OKC")
// and CLAUDE.md's team-directory note (parent team id 15, 6 affiliates).
const DEFAULT_ORG_ID = 15;

export const dynamic = "force-dynamic";

export default async function OrgMinorsPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const params = await searchParams;
  const orgId = params.org ? Number(params.org) : DEFAULT_ORG_ID;
  const { rows, teamCounts } = await getOrgMinorsPlayers(orgId);
  return <MinorsTable rows={rows} teamCounts={teamCounts} />;
}
