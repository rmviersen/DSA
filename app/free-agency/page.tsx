import { getFreeAgents } from "../../lib/free-agency-query";
import { PlayerTable } from "../_components/PlayerTable";

export const dynamic = "force-dynamic";

// Free Agency page (2026-09-04, Rees's ask) -- Phase 1: the sortable table
// of every real, actionable free agent. Positional-needs tracking and
// upgrade highlighting (MLB roster + org depth) are planned follow-ups, not
// built yet -- see HANDOFF.md's transaction-analysis section.

export default async function FreeAgencyPage() {
  const { rows, totalRealFreeAgents, totalWithRatings } = await getFreeAgents();
  const missingRatings = totalRealFreeAgents - totalWithRatings;

  return (
    <>
      <header className="page-header">
        <h1>Free Agency</h1>
        <p>
          Shows up to 100 players at a time, always the top 100 of whatever your current filters and sort produce —
          use the filters below to narrow in on fewer, more specific results rather than scrolling. {totalWithRatings.toLocaleString()}{" "}
          real free agents have ratings this refresh, out of {totalRealFreeAgents.toLocaleString()} total real free
          agents
          {missingRatings > 0
            ? ` (${missingRatings} more are between team assignments this refresh and don't have ratings yet)`
            : ""}
          . &quot;Team&quot; shows each player&apos;s last team, not a current roster (free agents have none). &quot;Level&quot;
          shows which level the AB/IP/WAR line was actually earned at — the same WAR number means something very
          different at MLB vs. AAA. &quot;Sign&quot; flags (✓, green) a player who&apos;d improve OKC&apos;s own
          minor-league system: young for his level (vs. the leaguewide age-at-level average, by hitter/pitcher) AND
          his Overall and Potential both beat OKC&apos;s own average at that same role and level. The level shown next
          to the flag (or in that column when unflagged) is where his Overall best fits on the role&apos;s own
          level-benchmark ladder — where to actually sign and assign him. Blank/dash means there&apos;s no real
          stat-based level on file to evaluate him against yet. &quot;Demand&quot; is each player&apos;s real AAV ask
          (manually imported from the game&apos;s own export — run <code>npm run import-free-agent-demands</code>{" "}
          after a fresh export to update it); &quot;Fair Value&quot; is what the market-rate curve says that talent
          level is actually worth; &quot;Value Gap&quot; is the difference as a % of fair value — positive (green)
          means he&apos;s asking for less than he&apos;s worth, negative (red) means he&apos;s asking for more. Blank
          Demand means no ask has been generated yet for that player.
        </p>
      </header>
      <PlayerTable rows={rows} showTeam showProspectCols={false} showStatLevel showSign showValueVsDemand renderLimit={100} />
    </>
  );
}
