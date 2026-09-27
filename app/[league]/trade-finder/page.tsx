import { getPositionSlots, getTradeBlockMatches, getBroaderTargets, getTradeBlockMeta } from "@/lib/trade-finder-query";
import { fetchComputedPlayers } from "@/lib/queries";
import { resolveLeagueId, resolveDefaultOrgId } from "@/lib/league";
import NeedCards from "./NeedCards";
import { PlayerTable } from "../../_components/PlayerTable";

export const dynamic = "force-dynamic";

// Trade Finder (2026-09-14, Rees's ask). Step 4 of the approved plan
// (splendid-spinning-wigderson.md) -- the page itself, pulling together the
// three data-layer steps built earlier the same day: getPositionSlots()
// (role-rank + exact-2B/3B slots, injury-adjusted -- every slot now, not
// just the weak ones; see that function's own comment, 2026-09-27),
// getTradeBlockMatches() (who on the live trade block would actually be a
// starter/depth upgrade), and getBroaderTargets() (a leaguewide scan for
// plausibly-available players not on the block -- last year of contract
// control, or a seller team's weak roster). Owner-only by directory
// convention, same as /lineup and /my-roster -- not in middleware.ts's
// GUEST_ALLOWED_PATHS.
//
// 2026-09-27 redesign (Rees: "instead of just finding positions where we are
// below league avg, I want to display the best available upgrades at each
// position... emphasize trade block listed players, and then show any
// players on the last year of their contract"): every position/role slot is
// fetched and matched now, not just the ones ranked bottom-third leaguewide;
// NeedCards.tsx filters down to slots with a real candidate and sorts
// trade-block hits first. A slot that's ALSO one of our bottom-third weak
// spots still gets a "Need" badge for context (need.isNeed).
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

  const needs = await getPositionSlots(leagueId, orgId);
  const [blockMatches, broaderMatches, blockMetaById] = await Promise.all([
    getTradeBlockMatches(leagueId, orgId, needs),
    getBroaderTargets(leagueId, orgId, needs),
    getTradeBlockMeta(leagueId),
  ]);

  // Full trade-block table (2026-09-14, Rees's ask, plus same-day follow-ups
  // for the listing note and contract info) -- every listed player, not
  // just those matching a flagged need. fetchComputedPlayers already gives
  // real ratings/stats/sort/filter (including the role filter) via
  // PlayerTable -- potential positions, the note, and the contract are the
  // three things merged in here (see getTradeBlockMeta), since none of that
  // is part of fetchComputedPlayers' own select.
  const blockPlayerIds = [...blockMetaById.keys()];
  const fullBlockRows = blockPlayerIds.length > 0
    ? (await fetchComputedPlayers({ leagueId, playerIds: blockPlayerIds, limit: blockPlayerIds.length + 50 }))
        .map((r) => {
          const meta = blockMetaById.get(r.player_id);
          return {
            ...r,
            eligiblePositions: meta?.eligiblePositions ?? [],
            tradeBlockNote: meta?.note ?? null,
            contractAav: meta?.contractAav ?? null,
            controlYears: meta?.yearsOfControl ?? null,
          };
        })
    : [];

  return (
    <>
      <header className="page-header">
        <h1>Trade Finder</h1>
        <p>
          The best real upgrade available at every role and position (SP, RP, C, 1B, 2B, 3B, SS, LF, CF, RF, DH) -- a
          candidate only appears if he'd genuinely clear real position/role eligibility AND beat what we can actually field
          today (injury-adjusted: a 30+ day injury doesn't count toward what we can field). Trade-block listings are
          emphasized first; below them, a broader leaguewide scan surfaces players not on the block who are plausibly
          available anyway -- either they're in the last year of their contract, or their team's overall roster talent is
          bottom-third leaguewide. Positions that are ALSO one of our bottom-third weak spots get a "Need" badge for
          context, but every position with a real upgrade shows up here now, not just the weak ones.
        </p>
      </header>
      <NeedCards needs={needs} blockMatches={blockMatches} broaderMatches={broaderMatches} />

      <h2 style={{ marginTop: 24 }}>Full Trade Block ({fullBlockRows.length})</h2>
      <p style={{ color: "var(--color-text-muted, #888)", fontSize: 12, marginTop: -6 }}>
        Every player currently listed on the trade block, regardless of whether he matches a flagged need above -- sort any
        column, filter by role, age, or Overall. "Potential Pos" is every real field position his eligibility clears (same
        rule as the Lineup optimizer: potential grade, plus arm/range for SS/3B), not just his nominal Pos. "Trade Block
        Note" is the listing GM's own free-text asking price, when they gave one.
      </p>
      <PlayerTable rows={fullBlockRows} showTeam={true} showProspectCols={false} showEligiblePositions={true} showTradeBlockInfo={true} showTeamFilter={true} />
    </>
  );
}
