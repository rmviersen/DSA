"use client";

import { usePathname } from "next/navigation";
import { SiteNav } from "./SiteNav";

// The /report route is the standalone, no-nav version of the site meant to
// be shared outside the team (2026-08-20) -- everything else (Top Players,
// Top Prospects, Top Draftees, Minor League System) keeps the full nav as
// before. This has to be a small client component, not a change to
// SiteNav/layout.tsx directly, because layout.tsx is a Server Component and
// can't call usePathname() itself.
export function ConditionalNav({ latestGameDate }: { latestGameDate: string | null }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/report")) return null;
  return <SiteNav latestGameDate={latestGameDate} />;
}
