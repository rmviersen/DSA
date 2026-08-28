import { getOrgTeams, getTopProspectsDetailed, getProspectSnapshotOptions, getTeamRankings, TOP_PROSPECTS_LIMIT } from "../../lib/queries";
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
  title,
  basePath,
  orgId,
  baselineRefreshRunId,
  showRankings = true,
}: {
  title: string;
  // "/prospects" or "/TBL/prospects" -- both ProspectFilters' form action
  // and TeamRankingsTable's team-name links need the CURRENT route, not a
  // hardcoded one, or they'd silently bounce a visitor over to the wrong
  // page (2026-08-20 bug, caught before the public page first shipped).
  basePath: string;
  orgId?: number;
  baselineRefreshRunId?: number;
  showRankings?: boolean;
}) {
  const [teams, allSnapshots, rows, teamRankings] = await Promise.all([
    getOrgTeams(),
    getProspectSnapshotOptions(),
    getTopProspectsDetailed(orgId, baselineRefreshRunId),
    showRankings ? getTeamRankings() : Promise.resolve([]),
  ]);
  // Comparing the current snapshot to itself is meaningless (always zero) --
  // drop it from the picker. The current snapshot is whichever one is newest.
  const snapshots = allSnapshots.length > 1 ? allSnapshots.slice(1) : [];

  return (
    <>
      <header className="page-header">
        <h1>{title}</h1>
        <p>{orgId ? "Organization rankings by Prospect Potential" : `League-wide top ${TOP_PROSPECTS_LIMIT} by Prospect Potential`}</p>
        {/* Subtle prospect-eligibility disclaimer (2026-08-27, Rees's spec) --
            added alongside the age <= 25 prospect-pool requirement in
            compute-ratings.ts, so a reader isn't left guessing why a given
            player (e.g. a rookie-eligible 27-year-old) doesn't show up here. */}
        <p style={{ color: "var(--color-text-muted, #888)", fontSize: 12, marginTop: -6 }}>
          Eligible players: under 45 days of MLB service time and age 25 or younger.
        </p>
      </header>
      <ProspectFilters teams={teams} selectedOrgId={orgId} snapshots={snapshots} selectedBaselineId={baselineRefreshRunId} action={basePath} />
      {showRankings ? (
        // Side-by-side layout (2026-08-20) -- each table keeps its own
        // horizontal scroll (via .table-wrap) so neither one forces the
        // page itself to scroll sideways if the viewport is narrow.
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          <div>
            <h2 style={sectionTitleStyle}>Top Prospects</h2>
            <ProspectTable rows={rows} />
          </div>
          <div>
            <h2 style={sectionTitleStyle}>System Rankings</h2>
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
        <ProspectTable rows={rows} />
      )}
    </>
  );
}
