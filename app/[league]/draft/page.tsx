import { getTopDraftees } from "../../../lib/queries";
import { resolveLeagueId } from "../../../lib/league";
import { PlayerTable } from "../../_components/PlayerTable";

export const dynamic = "force-dynamic";

export default async function DraftPage({ params }: { params: Promise<{ league: string }> }) {
  const { league } = await params;
  const leagueId = await resolveLeagueId(league);
  const { draftYear, rows } = await getTopDraftees(leagueId);

  return (
    <>
      <header className="page-header">
        <h1>Top Potential Draftees{draftYear ? ` — ${draftYear} class` : ""}</h1>
        {!draftYear && (
          <p>No draft class has been imported yet (run <code>npm run import-draft-pool -- --year=YYYY</code>).</p>
        )}
      </header>
      <PlayerTable rows={rows} showTeam={false} showProspectCols={true} />
    </>
  );
}
