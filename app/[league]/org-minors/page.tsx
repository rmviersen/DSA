import { getOrgMinorsPlayers } from "@/lib/org-minors-query";
import { resolveLeagueId } from "@/lib/league";
import MinorsTable from "./MinorsTable";

// Oklahoma City Outlaws, org id 15 -- confirmed via StatsPlus header ("OKC")
// and CLAUDE.md's team-directory note (parent team id 15, 6 affiliates).
const DEFAULT_ORG_ID = 15;

export const dynamic = "force-dynamic";

export default async function OrgMinorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ league: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const { league } = await params;
  const search = await searchParams;
  const orgId = search.org ? Number(search.org) : DEFAULT_ORG_ID;
  const leagueId = await resolveLeagueId(league);
  const { rows, teamCounts, roleHealth } = await getOrgMinorsPlayers(leagueId, orgId);
  return <MinorsTable rows={rows} teamCounts={teamCounts} roleHealth={roleHealth} />;
}
