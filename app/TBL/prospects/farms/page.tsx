import { getTeamRankings } from "@/lib/queries";
import { TeamRankingsTable } from "@/app/_components/TeamRankingsTable";

export const dynamic = "force-dynamic";

// System Rankings, split out into its own public page (2026-08-25) --
// previously the right-hand column of the combined report at /report (now
// /TBL/prospects). Lives at /TBL/prospects/farms specifically so it falls
// under the existing /TBL/prospects guest-access rule in middleware.ts
// (which allows anything starting with "/TBL/prospects/") with zero
// changes needed there. No team/date filter UI here -- this table isn't
// itself scoped to one org (it's always the full league board), and it
// never showed baseline-comparison deltas even on the combined page, so
// there's nothing for a filter bar to control yet. Team names link back to
// /TBL/prospects?team=... via the basePath prop, same as before the split.
export default async function SystemRankingsPage() {
  const teamRankings = await getTeamRankings();
  return (
    <>
      <header className="page-header">
        <h1>System Rankings</h1>
        <p>Minor league system strength, org by org</p>
      </header>
      <TeamRankingsTable rows={teamRankings} basePath="/TBL/prospects" />
    </>
  );
}
