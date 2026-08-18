import { getOrgTeams, getTopPlayers } from "../../lib/queries";
import { TeamFilter } from "../_components/TeamFilter";
import { PlayerTable } from "../_components/PlayerTable";

export const dynamic = "force-dynamic";

export default async function PlayersPage({ searchParams }: { searchParams: { team?: string } }) {
  const orgId = searchParams.team ? Number(searchParams.team) : undefined;
  const [teams, rows] = await Promise.all([getOrgTeams(), getTopPlayers(orgId)]);

  return (
    <div>
      <h1>Top Players {orgId ? "" : "(league-wide, top 100 by Overall)"}</h1>
      <TeamFilter teams={teams} selectedOrgId={orgId} action="/players" />
      <PlayerTable rows={rows} showTeam={!orgId} showProspectCols={false} />
    </div>
  );
}
