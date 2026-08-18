import { getOrgTeams, getTopProspects } from "../../lib/queries";
import { TeamFilter } from "../_components/TeamFilter";
import { PlayerTable } from "../_components/PlayerTable";

export const dynamic = "force-dynamic";

export default async function ProspectsPage({ searchParams }: { searchParams: { team?: string } }) {
  const orgId = searchParams.team ? Number(searchParams.team) : undefined;
  const [teams, rows] = await Promise.all([getOrgTeams(), getTopProspects(orgId)]);

  return (
    <div>
      <h1>Top Prospects {orgId ? "" : "(league-wide, top 100 by Prospect Potential)"}</h1>
      <TeamFilter teams={teams} selectedOrgId={orgId} action="/prospects" />
      <PlayerTable rows={rows} showTeam={!orgId} showProspectCols={true} />
    </div>
  );
}
