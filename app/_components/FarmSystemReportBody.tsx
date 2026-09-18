import { getOrgTeams, getTopProspectsDetailed, getProspectSnapshotOptions, getTeamRankings, TOP_PROSPECTS_LIMIT, TOP_PROSPECTS_ORG_LIMIT } from "../../lib/queries";
import { ProspectFilters } from "./ProspectFilters";
import { ProspectTable } from "./ProspectTable";
import { TeamRankingsTable } from "./TeamRankingsTable";

const sectionTitleStyle = {
  fontFamily: "var(--font-display), system-ui, sans-serif",
  fontSize: "1.0625rem",
  fontWeight: 700,
  margin: "0 0 0.5rem",
  color: "var(--color-heading)",
} as const;

// Shared by /prospects (internal working page, full site nav, always shows
// both tables) and /TBL/prospects (the standalone public page -- see
// ConditionalNav.tsx) so the two never drift apart in practice (2026-08-20).
// The public System Rankings table moved to its own page,
// /TBL/prospects/farms, as of 2026-08-25 -- `showRankings={false}` on the
// /TBL/prospects caller skips it here rather than duplicating this
// component's prospects-fetching logic in a second place.
export async function FarmSystemReportBody({
  leagueId,
  title,
  basePath,
  orgId,
  baselineRefreshRunId,
  showRankings = true,
  showInternalLinks,
}: {
  // Resolved by the caller (app/[league]/prospects/page.tsx) via
  // resolveLeagueId(params.league) -- 2026-09-10, Step 3 of the multi-league
  // migration. Deliberately NOT re-resolved in here with a default: this
  // component has no route params of its own to read, so it has to trust
  // whatever the page above it already resolved for the real URL being
  // rendered, or every league except TBL would silently show TBL's data.
  leagueId: number;
  title: string;
  // "/TBL/prospects" (or /Duud/prospects, etc.) -- ProspectFilters' form
  // action and TeamRankingsTable's team-name links need the CURRENT route,
  // not a hardcoded one, or they'd silently bounce a visitor over to the
  // wrong page (2026-08-20 bug, caught before the public page first shipped).
  basePath: string;
  orgId?: number;
  baselineRefreshRunId?: number;
  showRankings?: boolean;
  // Whether ProspectTable's player names link to our internal /players/[id]
  // pages (2026-08-30) -- true for a real, non-previewing owner (computed by
  // the caller via checkOwnerState()); false for a real guest or an owner
  // currently previewing as one, who only get the external StatsPlus link.
  showInternalLinks: boolean;
}) {
  const [teams, allSnapshots, rows, teamRankings] = await Promise.all([
    getOrgTeams(leagueId),
    getProspectSnapshotOptions(leagueId),
    getTopProspectsDetailed(leagueId, orgId, baselineRefreshRunId),
    showRankings ? getTeamRankings(leagueId) : Promise.resolve([]),
  ]);
  // Comparing the current snapshot to itself is meaningless (always zero) --
  // drop it from the picker. The current snapshot is whichever one is newest.
  const snapshots = allSnapshots.length > 1 ? allSnapshots.slice(1) : [];

  return (
    // "prospects-report-page" marker class (2026-08-30, Rees's ask) --
    // picked up by a `.site-main:has(...)` rule in globals.css that
    // narrows just this shared component's pages (both /prospects and
    // /TBL/prospects) from the site's normal 1200px content width. No
    // effect on any other page, same pattern already used to WIDEN
    // /org-minors -- this is the same mechanism in the other direction.
    <div className="prospects-report-page">
      <header className="page-header">
        <h1>{title}</h1>
        <p>{orgId ? `Organization top ${TOP_PROSPECTS_ORG_LIMIT} by Prospect Potential` : `League-wide top ${TOP_PROSPECTS_LIMIT} by Prospect Potential`}</p>
        {/* Subtle prospect-eligibility disclaimer (2026-08-27, Rees's spec) --
            added alongside the age <= 25 prospect-pool requirement in
            compute-ratings.ts, so a reader isn't left guessing why a given
            player (e.g. a rookie-eligible 27-year-old) doesn't show up here. */}
        <p style={{ color: "var(--color-text-muted, #888)", fontSize: 12, marginTop: -6 }}>
          Eligible players: under 45 days of MLB service time and age 25 or younger.
        </p>
      </header>
      {/* Intro write-up (2026-09-14, Rees's ask; text rewritten by Rees himself 2026-09-18, and the "About the Rankings" heading dropped the same day -- edit the wording in place, keep apostrophes as &apos;) -- a high-level,
          official-reading description of the rating system for anyone
          landing on this report (this component is shared by the internal
          /prospects page and the public /TBL/prospects one). Deliberately
          stays at the level of WHAT the model weighs, not the exact
          formulas/coefficients behind it -- Rees's own spec: "without going
          into too much detail." */}
      <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "12px 16px", background: "var(--color-surface)", marginBottom: 16, fontSize: "0.875rem", lineHeight: 1.5 }}>
        <p style={{ margin: "0 0 8px" }}>
          Welcome to the Drunk Scouting Association, where sometimes we get things right! I&apos;ve built this system over a number of versions and with the help of some extreme water usage, have been able to create the best version of it yet. We are called the DSA because I consider this to be an inexact science. OOTP is intentionally difficult to quantify from scouted ratings, so I consider this like having my own army of inebriated scouts sending half-assed reports that I try and make sense of.
        </p>
        <p style={{ margin: "0 0 8px" }}>
          Player grades are generated by a self-training evaluation engine, no longer hard-coded weights, which runs entirely independent of the game&apos;s own overall and potential ratings. It works from raw tools only — hitting, fielding, baserunning, and pitching — and builds every grade from scratch, calibrated against actual outcomes across the league rather than scouting intuition alone. Positional scarcity is factored into every grade directly, weighting value by how difficult each position is to fill at a high level.
        </p>
        <p style={{ margin: 0 }}>
          Grades also account for development timeline, injury history, and character traits, and hitters are evaluated against the league&apos;s real left/right pitching mix rather than a generic split, projecting prospects R/L splits out to development. Each prospect is paired with the closest current MLB comparable as a reference point, and the model is retrained as new performance data comes in — rankings move with the season, not just each spring.
        </p>
      </div>
      <ProspectFilters teams={teams} selectedOrgId={orgId} snapshots={snapshots} selectedBaselineId={baselineRefreshRunId} action={basePath} />
      {showRankings ? (
        // Side-by-side layout (2026-08-20) -- each table keeps its own
        // horizontal scroll (via .table-wrap) so neither one forces the
        // page itself to scroll sideways if the viewport is narrow.
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          <div>
            <h2 style={sectionTitleStyle}>Top Prospects</h2>
            <ProspectTable rows={rows} showInternalLinks={showInternalLinks} />
          </div>
          <div>
            {/* Renamed "Farm Rankings" 2026-08-31 (Rees's ask) -- this
                compact side-by-side column still reads from
                getTeamRankings()/TeamRankingsTable.tsx, unchanged; only the
                label changed, same as the dedicated /TBL/prospects/farms
                page's heading. */}
            <h2 style={sectionTitleStyle}>Farm Rankings</h2>
            {/* Spacer matching the height of ProspectTable's own internal
                filter bar (H/P + Role buttons), which pushes its <table>
                down but has no equivalent on this side -- without this the
                two tables' actual rows start at different heights even
                though both outer columns are top-aligned. Value confirmed
                2026-08-20 by measuring the real rendered filter-bar
                height. */}
            <div style={{ height: 32 }} />
            <TeamRankingsTable rows={teamRankings} baselineRefreshRunId={baselineRefreshRunId} basePath={basePath} />
          </div>
        </div>
      ) : (
        <ProspectTable rows={rows} showInternalLinks={showInternalLinks} />
      )}
    </div>
  );
}
