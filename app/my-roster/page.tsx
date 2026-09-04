import { getMyRosterAnalysis } from "@/lib/my-roster-query";
import RoleCards from "./RoleCards";

// Oklahoma City Outlaws, org id 15 -- same convention/source as /org-minors.
const DEFAULT_ORG_ID = 15;

export const dynamic = "force-dynamic";

// My Roster (2026-09-04, Rees's ask) -- structural first pass. Full writeup
// of the Current/Future definitions and open calibration questions lives in
// HANDOFF.md's transaction-analysis section; this page and lib/my-roster-
// query.ts are the "lay out the overall vision" skeleton, not a finished,
// fully-tuned system yet.

export default async function MyRosterPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const params = await searchParams;
  const orgId = params.org ? Number(params.org) : DEFAULT_ORG_ID;
  const cards = await getMyRosterAnalysis(orgId);

  return (
    <>
      <header className="page-header">
        <h1>My Roster</h1>
        <p>
          Role-by-role team analysis. <strong>Current</strong> is today&apos;s active MLB roster (same numbers as the
          Minor League System page&apos;s Role Health table, at the MLB level). <strong>Future</strong> is the org&apos;s
          pipeline (minors + international academy) narrowed to players with 3+ years of remaining team control —
          basically a view into the roster three years out — ranked by Potential. Future RP only counts players
          actually scouted as relievers (Current RP still credits rotation-quality arms the team is really using in
          relief today). Rating is a top-N average (N = expected playing-time slots at that role, same N both sides);
          Rank is where Oklahoma City lands among all 32 orgs on that same number. The list under each number is the
          actual players it&apos;s built from. This is a first structural pass — the underlying calculations are
          expected to be refined.
        </p>
      </header>
      <RoleCards cards={cards} />
    </>
  );
}
