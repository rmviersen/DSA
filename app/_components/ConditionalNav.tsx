"use client";

import { usePathname } from "next/navigation";
import { SiteNav } from "./SiteNav";
import { ReportHeader } from "./ReportHeader";

// Anything under /TBL/prospects (the public Top Prospects + System
// Rankings pages, split 2026-08-25 -- was one page at /report before that)
// is the standalone version of the site meant to be shared outside the
// team; everything else (Top Players, the internal /prospects, Top
// Draftees, Minor League System) keeps the full nav as before. This has to
// be a small client component, not a change to SiteNav/layout.tsx
// directly, because layout.tsx is a Server Component and can't call
// usePathname() itself.
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
  if (pathname?.startsWith("/TBL/prospects")) {
    return <ReportHeader isRealOwner={isRealOwner} isPreviewingGuest={isPreviewingGuest} />;
  }
  return <SiteNav latestGameDate={latestGameDate} isRealOwner={isRealOwner} />;
}
