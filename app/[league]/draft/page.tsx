import { getTopDraftees } from "../../../lib/queries";
import { resolveLeagueId } from "../../../lib/league";
import { PlayerTable } from "../../_components/PlayerTable";
import { DraftAutoRefresh } from "./DraftAutoRefresh";

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
            Con/Stf, Pow/Mov, and Eye/Ctrl show each player's POTENTIAL grade here, not current -- an amateur's current tools are close to meaningless next to a rostered player's.
            Draft Value differs from Prospect Potential -- same shape, but a smaller boost for a fully-developed current Overall, plus Work Ethic/Intelligence
            makeup adjustments. Hyp. Rank is where a player's real Prospect Potential would land in the actual current prospect rankings.
            "Export CSV" downloads whatever's currently sorted/filtered below, Player ID first -- ready to upload straight into StatsPlus's own draft list Upload feature.
          </p>
        )}
      </header>
      {draftYear && <DraftAutoRefresh league={league} />}
      <PlayerTable rows={rows} showTeam={false} showProspectCols={true} showDraftStatus={true} showPotentialTools={true} showDraftMetrics={true} hideStatColumns={true} showExport={true} exportFilename={`draft-list${draftYear ? `-${draftYear}` : ""}.csv`} />
    </>
  );
}
