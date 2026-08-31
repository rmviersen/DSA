import { getSystemRankingsDetailed } from "@/lib/system-rankings-query";
import { SystemRankingsCards } from "@/app/_components/SystemRankingsCards";
import { checkOwnerState } from "@/lib/owner-cookie";

export const dynamic = "force-dynamic";

// System Rankings, split out into its own public page (2026-08-25) --
// previously the right-hand column of the combined report at /report (now
// /TBL/prospects). Lives at /TBL/prospects/farms specifically so it falls
// under the existing /TBL/prospects guest-access rule in middleware.ts
// (which allows anything starting with "/TBL/prospects/") with zero
// changes needed there.
//
// Rebuilt 2026-08-31 (Rees's spec) from a plain table into the same
// card-based language as Top Prospects: getSystemRankingsDetailed() (new
// query module, lib/system-rankings-query.ts) replaces getTeamRankings()
// here specifically -- getTeamRankings/TeamRankingsTable are UNCHANGED and
// still power /prospects' compact side-by-side rankings column, which
// doesn't have room for these much taller cards.
export default async function SystemRankingsPage() {
  const [rankings, { isRealOwner, isPreviewingGuest }] = await Promise.all([
    getSystemRankingsDetailed(),
    checkOwnerState(),
  ]);
  // Same owner/guest link semantics as /TBL/prospects's own page.tsx --
  // display-only (the internal /players/[id] pages are already owner-only
  // at the middleware level regardless of what this page links to).
  const showInternalLinks = isRealOwner && !isPreviewingGuest;
  return (
    <>
      <header className="page-header">
        {/* Renamed "Farm Rankings" 2026-08-31 (Rees's ask, after the card
            rebuild) -- route/URL, function/component names, and the
            database stay "system rank"/"System Rankings" throughout; this
            is a display-label-only rename. */}
        <h1>Farm Rankings</h1>
        <p>Minor league system strength, org by org</p>
      </header>
      <SystemRankingsCards rows={rankings} showInternalLinks={showInternalLinks} />
    </>
  );
}
