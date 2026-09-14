import { getPositionalNeeds, getTradeBlockMatches, getBroaderTargets, getTradeBlockEligiblePositions } from "@/lib/trade-finder-query";
import { fetchComputedPlayers } from "@/lib/queries";
import { resolveLeagueId, resolveDefaultOrgId } from "@/lib/league";
import NeedCards from "./NeedCards";
import { PlayerTable } from "../../_components/PlayerTable";

export const dynamic = "force-dynamic";

// Trade Finder (2026-09-14, Rees's ask). Step 4 of the approved plan
// (splendid-spinning-wigderson.md) -- the page itself, pulling together the
// three data-layer steps built earlier the same day: getPositionalNeeds()
// (role-rank + exact-2B/3B needs, injury-adjusted), getTradeBlockMatches()
// (who on the live trade block would actually be a starter/depth upgrade),
// and getBroaderTargets() (a leaguewide scan for plausibly-available players
// not on the block -- short contract control, or a seller team's weak
// roster). Owner-only by directory convention, same as /lineup and
// /my-roster -- not in middleware.ts's GUEST_ALLOWED_PATHS.
export default async function TradeFinderPage({
  params,
  searchParams,
}: {
  params: Promise<{ league: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const { league } = await params;
  const search = await searchParams;
  const leagueId = await resolveLeagueId(league);
  const orgId = search.org ? Number(search.org) : await resolveDefaultOrgId(leagueId);

  const needs = await getPositionalNeeds(leagueId, orgId);
  const [blockMatches, broaderMatches, eligiblePositionsById] = await Promise.all([
    getTradeBlockMatches(leagueId, orgId, needs),
    getBroaderTargets(leagueId, orgId, needs),
    getTradeBlockEligiblePositions(leagueId),
  ]);

  // Full trade-block table (2026-09-14, Rees's ask) -- every listed player,
  // not just those matching a flagged need. fetchComputedPlayers already
  // gives real ratings/stats/sort/filter (including the role filter) via
  // PlayerTable -- "potential positions" is the one thing merged in here,
  // computed separately (see getTradeBlockEligiblePositions) since that
  // data isn't part of fetchComputedPlayers' own select.
  const blockPlayerIds = [...eligiblePositionsById.keys()];
  const fullBlockRows = blockPlayerIds.length > 0
    ? (await fetchComputedPlayers({ leagueId, playerIds: blockPlayerIds, limit: blockPlayerIds.length + 50 }))
        .map((r) => ({ ...r, eligiblePositions: eligiblePositionsById.get(r.player_id) ?? [] }))
    : [];

  return (
    <>
      <header className="page-header">
        <h1>Trade Finder</h1>
        <p>
          Positional needs found automatically -- any role or exact position in the bottom third leaguewide (accounting for
          injuries: a role only counts as a need if it's still weak once any 30+ day injury is excluded from the comparison,
          for every team, not just ours). Each need below is matched against the real trade block and a broader leaguewide
          scan of plausibly-available players (short contract control, or a team whose overall roster talent is bottom-third
          leaguewide) -- a candidate only appears if he'd genuinely clear real position/role eligibility AND beat what we can
          actually field today.
        </p>
      </header>
      {needs.length === 0 ? (
        <p>No positional needs currently flagged -- every role and position clears the bottom-third bar league-wide.</p>
      ) : (
        <NeedCards needs={needs} blockMatches={blockMatches} broaderMatches={broaderMatches} />
      )}

      <h2 style={{ marginTop: 24 }}>Full Trade Block ({fullBlockRows.length})</h2>
      <p style={{ color: "var(--color-text-muted, #888)", fontSize: 12, marginTop: -6 }}>
        Every player currently listed on the trade block, regardless of whether he matches a flagged need above -- sort any
        column, filter by role, age, or Overall. "Potential Pos" is every real field position his eligibility clears (same
        rule as the Lineup optimizer: potential grade, plus arm/range for SS/3B), not just his nominal Pos.
      </p>
      <PlayerTable rows={fullBlockRows} showTeam={true} showProspectCols={false} showEligiblePositions={true} />
    </>
  );
}
