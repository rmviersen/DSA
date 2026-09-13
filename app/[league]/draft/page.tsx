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
        <h1>Draft Board{draftYear ? ` — ${draftYear} class` : ""}</h1>
        {!draftYear && (
          <p>No draft class has been imported yet (run <code>npm run import-draft-pool -- --year=YYYY</code>).</p>
        )}
        {draftYear && (
          <p style={{ color: "var(--color-text-muted, #888)", fontSize: 12 }}>
            Full {rows.length}-player pool -- sort/filter freely (e.g. click "Potential" or set Age's max to see the high-school demographic).
            "Drafted By" reflects the last <code>npm run check-draft-picks -- --year={draftYear}</code> run, not live-live -- re-run it to refresh who's off the board.
          </p>
        )}
      </header>
      <PlayerTable rows={rows} showTeam={false} showProspectCols={true} showDraftStatus={true} />
    </>
  );
}
