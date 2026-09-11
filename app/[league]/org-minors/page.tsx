import { getOrgMinorsPlayers } from "@/lib/org-minors-query";
import { resolveLeagueId, resolveDefaultOrgId } from "@/lib/league";
import MinorsTable from "./MinorsTable";

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
  const leagueId = await resolveLeagueId(league);
  const orgId = search.org ? Number(search.org) : await resolveDefaultOrgId(leagueId);
  const { rows, teamCounts, roleHealth } = await getOrgMinorsPlayers(leagueId, orgId);
  return <MinorsTable rows={rows} teamCounts={teamCounts} roleHealth={roleHealth} />;
}
