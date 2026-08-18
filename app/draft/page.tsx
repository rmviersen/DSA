import { getTopDraftees } from "../../lib/queries";
import { PlayerTable } from "../_components/PlayerTable";

export const dynamic = "force-dynamic";

export default async function DraftPage() {
  const { draftYear, rows } = await getTopDraftees();

  return (
    <div>
      <h1>Top Potential Draftees {draftYear ? `— ${draftYear} class` : ""}</h1>
      {!draftYear && <p>No draft class has been imported yet (run <code>npm run import-draft-pool -- --year=YYYY</code>).</p>}
      <PlayerTable rows={rows} showTeam={false} showProspectCols={true} />
    </div>
  );
}
