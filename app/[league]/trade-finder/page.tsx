import { getPositionalNeeds, getTradeBlockMatches, getBroaderTargets } from "@/lib/trade-finder-query";
import { resolveLeagueId, resolveDefaultOrgId } from "@/lib/league";
import NeedCards from "./NeedCards";

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
  const [blockMatches, broaderMatches] = await Promise.all([
    getTradeBlockMatches(leagueId, orgId, needs),
    getBroaderTargets(leagueId, orgId, needs),
  ]);

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
    </>
  );
}
