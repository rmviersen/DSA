import { getRule5DraftBoard } from "../../../lib/rule5-draft-query";
import { resolveLeagueId, resolveDefaultOrgId } from "../../../lib/league";
import { getRosterFreshness } from "../../../lib/roster-freshness";
import { PlayerTable } from "../../_components/PlayerTable";

export const dynamic = "force-dynamic";

// Rule 5 Draft board (2026-09-07, Rees's ask) -- two lists: our own exposed,
// eligible players worth deciding whether to protect (add to the 40-man
// before the draft), and every other org's exposed, eligible players worth
// targeting. Full eligibility-rule writeup lives in rule5-draft-query.ts and
// HANDOFF.md's transaction-analysis section.

export default async function Rule5DraftPage({ params }: { params: Promise<{ league: string }> }) {
  const { league } = await params;
  const leagueId = await resolveLeagueId(league);
  const orgId = await resolveDefaultOrgId(leagueId);
  const [{ toProtect, toDraft }, freshness] = await Promise.all([getRule5DraftBoard(leagueId, orgId), getRosterFreshness(leagueId)]);
  const asOfText = freshness.asOf
    ? new Date(freshness.asOf).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" })
    : "an unknown time";

  return (
    <>
      <header className="page-header">
        <h1>Rule 5 Draft</h1>
        <p>
          A player is exposed to the Rule 5 draft once he&apos;s completed enough professional seasons for his
          signing age (the game&apos;s own <code>years_protected_from_rule_5</code>, 4 or 5 — his draft year counts
          as season 1), is at a real minor-league level (not the majors, not the international academy), and
          isn&apos;t already on a Secondary (40-man) or active roster or holding a current Major League contract (a
          fresh free-agent signing still waiting on its roster paperwork isn&apos;t a real Rule 5 case). Matches the
          league&apos;s own published Rule 5 rules exactly — the same &quot;Age &gt; 22, Org is not yours, League
          Level is not Major League&quot; filter the game&apos;s own Draft Pool screen uses. This league&apos;s own
          added rule: a player must be <strong>23 or older</strong> to actually be selected — real, not redundant
          with the service-time math (79 players leaguewide are otherwise eligible but under 23).{" "}
          <strong>Players to Protect</strong> is your organization&apos;s own exposed, eligible players — sorted by
          Overall and capped to the top 20 of your current filters/sort, so the ones most worth adding to the 40-man
          are the ones actually shown, not buried in a long list. <strong>Rule 5 Draft Board</strong> is every other
          org&apos;s exposed, eligible players, worth targeting to draft — capped to the top 100 of whatever your
          current filters/sort produce (same pattern) since the real leaguewide pool runs over 1,800. Sort by
          Potential (not just Overall) to surface high-upside arms/bats whose current numbers don&apos;t yet reflect
          it.
        </p>
        <p style={{ color: "var(--color-text-muted, #888)", fontSize: "0.8125rem", marginTop: 6 }}>
          Roster status (who is on the 40-man, org, level) as of {asOfText}, from the last {freshness.source === "sync" ? "roster sync" : "full data refresh"}.
          Moves made in the game since then — protecting a player, a release — aren&apos;t reflected until the next sync or
          refresh (<code>npm run sync-roster-flags</code> updates just this, in seconds).
        </p>
      </header>

      <h2 style={{ margin: "0 0 0.5rem" }}>Players to Protect</h2>
      <PlayerTable rows={toProtect} showTeam showProspectCols renderLimit={20} showNameSearch />

      <h2 style={{ margin: "2rem 0 0.5rem" }}>Rule 5 Draft Board</h2>
      <PlayerTable rows={toDraft} showTeam showProspectCols renderLimit={100} showNameSearch />
    </>
  );
}
