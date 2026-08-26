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
// nothing at all. `isOwner` is computed server-side in layout.tsx and
// passed down, since this client component can't safely read the httpOnly
// auth cookie itself.
export function ConditionalNav({ latestGameDate, isOwner }: { latestGameDate: string | null; isOwner: boolean }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/TBL/prospects")) return <ReportHeader isOwner={isOwner} />;
  return <SiteNav latestGameDate={latestGameDate} />;
}
