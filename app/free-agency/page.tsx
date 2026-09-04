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
          . &quot;Team&quot; shows each player&apos;s last team, not a current roster (free agents have none). &quot;Level&quot;
          shows which level the AB/IP/WAR line was actually earned at — the same WAR number means something very
          different at MLB vs. AAA. &quot;Demand&quot; is each player&apos;s real AAV ask (manually imported from the
          game&apos;s own export — run <code>npm run import-free-agent-demands</code> after a fresh export to update
          it); &quot;Fair Value&quot; is what the market-rate curve says that talent level is actually worth; &quot;Value
          Gap&quot; is the difference as a % of fair value — positive (green) means he&apos;s asking for less than
          he&apos;s worth, negative (red) means he&apos;s asking for more. Blank Demand means no ask has been
          generated yet for that player.
        </p>
      </header>
      <PlayerTable rows={rows} showTeam showProspectCols={false} showStatLevel showValueVsDemand />
    </>
  );
}
