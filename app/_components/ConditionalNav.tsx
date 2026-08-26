"use client";

import { usePathname } from "next/navigation";
import { SiteNav } from "./SiteNav";
import { ReportHeader } from "./ReportHeader";

// The /report route is the standalone version of the site meant to be
// shared outside the team (2026-08-20) -- everything else (Top Players,
// Top Prospects, Top Draftees, Minor League System) keeps the full nav as
// before. This has to be a small client component, not a change to
// SiteNav/layout.tsx directly, because layout.tsx is a Server Component and
// can't call usePathname() itself.
//
// As of 2026-08-25 (Step 3 of the visual refresh), /report no longer goes
// nav-less -- it gets its own slim ReportHeader (logo + a login/full-site
// link) instead of nothing at all. `isOwner` is computed server-side in
// layout.tsx and passed down, since this client component can't safely
// read the httpOnly auth cookie itself.
export function ConditionalNav({ latestGameDate, isOwner }: { latestGameDate: string | null; isOwner: boolean }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/report")) return <ReportHeader isOwner={isOwner} />;
  return <SiteNav latestGameDate={latestGameDate} />;
}
