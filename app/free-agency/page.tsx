import { getFreeAgents } from "../../lib/free-agency-query";
import { PlayerTable } from "../_components/PlayerTable";

export const dynamic = "force-dynamic";

// Free Agency page (2026-09-04, Rees's ask) -- Phase 1: the sortable table
// of every real, actionable free agent. Positional-needs tracking and
// upgrade highlighting (MLB roster + org depth) are planned follow-ups, not
// built yet -- see HANDOFF.md's transaction-analysis section.

export default async function FreeAgencyPage() {
  const { rows, totalRealFreeAgents } = await getFreeAgents();
  const missingRatings = totalRealFreeAgents - rows.length;

  return (
    <>
      <header className="page-header">
        <h1>Free Agency</h1>
        <p>
          {rows.length.toLocaleString()} of {totalRealFreeAgents.toLocaleString()} real free agents shown, sorted by
          Overall
          {missingRatings > 0
            ? ` (${missingRatings} more are between team assignments this refresh and don't have ratings yet)`
            : ""}
          . &quot;Team&quot; shows each player&apos;s last team, not a current roster (free agents have none).
        </p>
      </header>
      <PlayerTable rows={rows} showTeam showProspectCols={false} />
    </>
  );
}
