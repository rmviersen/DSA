import { resolveLeagueId } from "../../../lib/league";
import { getTradeRelationshipData } from "../../../lib/trade-relationships-query";
import TradeRelationshipsExplorer from "./TradeRelationshipsExplorer";

export const dynamic = "force-dynamic";

// Trade Relationships (2026-10-14, Rees's ask): how often every team has traded with every other team, as a living chord
// diagram (with a season scrubber / Play), a matrix heatmap, a team spotlight, and sortable team and pair tables. Owner-only by
// directory convention (not in middleware.ts's GUEST_ALLOWED_PATHS), like the other analysis pages.

export default async function TradeRelationshipsPage({ params }: { params: Promise<{ league: string }> }) {
  const { league } = await params;
  const leagueId = await resolveLeagueId(league);
  const data = await getTradeRelationshipData(leagueId);

  return (
    <>
      <header className="page-header">
        <h1>Trade Relationships</h1>
        <p>
          Who trades with whom. Each franchise is a node on the ring (colored by division); the thicker the ribbon between two
          teams, the more trades they have made. Use the season sliders — or press Play — to watch the partnerships form over the
          league&apos;s history. Based on {data.trades.length.toLocaleString()} completed trades from {data.minYear} to {data.maxYear}.
        </p>
      </header>
      {data.trades.length === 0 ? (
        <p>No completed trades on file for this league yet.</p>
      ) : (
        <TradeRelationshipsExplorer data={data} />
      )}
    </>
  );
}
