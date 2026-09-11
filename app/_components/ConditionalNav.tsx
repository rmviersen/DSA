"use client";

import { usePathname } from "next/navigation";
import { SiteNav } from "./SiteNav";
import { ReportHeader } from "./ReportHeader";
import { DEFAULT_LEAGUE_SLUG } from "@/lib/league-slug";

// Anything under /TBL/prospects (the public Top Prospects + System
// Rankings pages, split 2026-08-25 -- was one page at /report before that)
// is the standalone version of the site meant to be shared outside the
// team; everything else (Top Players, Top Draftees, Minor League System)
// keeps the full nav as before. This has to be a small client component,
// not a change to SiteNav/layout.tsx directly, because layout.tsx is a
// Server Component and can't call usePathname() itself.
//
// As of 2026-08-25 (Step 3 of the visual refresh), the public pages don't
// go nav-less -- they get their own slim ReportHeader (logo + Top
// Prospects/System Rankings links + a login/full-site link) instead of
// nothing at all. `isRealOwner`/`isPreviewingGuest` are computed
// server-side in layout.tsx and passed down, since this client component
// can't safely read the httpOnly auth cookies itself. SiteNav only ever
// renders for a real, non-previewing owner in practice -- middleware.ts
// would already have redirected anyone else away from a non-/TBL/prospects
// page before this component ever runs -- but it still needs
// `isRealOwner` to decide whether to show the "Preview as Guest" toggle.
//
// Multi-league routing (2026-09-10, Step 3): both SiteNav and ReportHeader
// need to know which league to build their links against. Derived here
// from the URL's own first path segment via usePathname() -- deliberately
// NOT useParams(), since this component also renders on routes with no
// [league] segment at all (/, /login, /report), where useParams() would
// return nothing; those routes fall back to DEFAULT_LEAGUE_SLUG (TBL is the
// only real destination any of them ever actually redirect to today).
export function ConditionalNav({
  latestGameDate,
  isRealOwner,
  isPreviewingGuest,
}: {
  latestGameDate: string | null;
  isRealOwner: boolean;
  isPreviewingGuest: boolean;
}) {
  const pathname = usePathname();
  const firstSegment = pathname?.split("/")[1];
  const league = firstSegment || DEFAULT_LEAGUE_SLUG;
  if (pathname?.startsWith("/TBL/prospects")) {
    return <ReportHeader league={league} isRealOwner={isRealOwner} isPreviewingGuest={isPreviewingGuest} />;
  }
  return <SiteNav league={league} latestGameDate={latestGameDate} isRealOwner={isRealOwner} />;
}
