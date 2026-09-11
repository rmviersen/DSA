import { getOrgTeams, getTopPlayers } from "../../lib/queries";
import { getDefaultLeagueId } from "../../lib/league";
import { TeamFilter } from "../_components/TeamFilter";
import { PlayerTable } from "../_components/PlayerTable";

export const dynamic = "force-dynamic";

export default async function PlayersPage({ searchParams }: { searchParams: { team?: string } }) {
  const orgId = searchParams.team ? Number(searchParams.team) : undefined;
  const leagueId = await getDefaultLeagueId();
  const [teams, rows] = await Promise.all([getOrgTeams(leagueId), getTopPlayers(leagueId, orgId)]);

  return (
    <>
      <header className="page-header">
        <h1>Top Players</h1>
        <p>{orgId ? "Organization rankings by Overall" : "League-wide top 100 by Overall"}</p>
      </header>
      <TeamFilter teams={teams} selectedOrgId={orgId} action="/players" />
      <PlayerTable rows={rows} showTeam={!orgId} showProspectCols={false} />
    </>
  );
}
