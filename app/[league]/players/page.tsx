import { getOrgTeams, getTopPlayers } from "../../../lib/queries";
import { resolveLeagueId } from "../../../lib/league";
import { TeamFilter } from "../../_components/TeamFilter";
import { PlayerTable } from "../../_components/PlayerTable";

export const dynamic = "force-dynamic";

export default async function PlayersPage({
  params,
  searchParams,
}: {
  params: Promise<{ league: string }>;
  searchParams: { team?: string };
}) {
  const { league } = await params;
  const leagueId = await resolveLeagueId(league);
  const orgId = searchParams.team ? Number(searchParams.team) : undefined;
  const [teams, rows] = await Promise.all([getOrgTeams(leagueId), getTopPlayers(leagueId, orgId)]);

  return (
    <>
      <header className="page-header">
        <h1>Top Players</h1>
        <p>{orgId ? "Organization rankings by Overall" : "League-wide top 100 by Overall"}</p>
      </header>
      <TeamFilter teams={teams} selectedOrgId={orgId} action={`/${league}/players`} />
      <PlayerTable rows={rows} showTeam={!orgId} showProspectCols={false} />
    </>
  );
}
