"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DataStatus } from "./DataStatus";
import type { DataFreshness } from "../../lib/display-helpers";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// "System Rankings" renamed to "Farm Rankings" 2026-08-31 (Rees's ask,
// after the card rebuild -- "which is what I want to rebrand it as") --
// URL/route (/TBL/prospects/farms) and every internal name (getTeamRankings,
// TeamRankingRow, SystemRankingsCards, system_rank_weights, etc.) are
// UNCHANGED, this is a display-label-only rename. Historical comments
// elsewhere that describe past events using the old name are left as-is --
// that's accurately what it was called at the time, not something to
// retroactively rewrite.
// League-relative, same convention as SiteNav's own NAV_ITEMS -- prefixed
// with `/${league}` at render time (2026-09-10). In practice this header
// only ever renders for TBL (ConditionalNav's own route check is still the
// literal "/TBL/prospects" -- Duud has no guest tier at all per Rees's
// spec), but taking `league` as a real prop rather than hardcoding "TBL" a
// second time here avoids a second hardcoded literal to find if that ever
// changes.
const PUBLIC_NAV_ITEMS = [
  { href: "/prospects", label: "Top Prospects" },
  { href: "/prospects/farms", label: "Farm Rankings" },
] as const;

// Colors come from .report-header-action in globals.css, not Tailwind's
// text-primary-foreground utility (2026-08-30 fix) -- that token flips to
// near-black in dark mode while this header's navy background never
// changes with the theme, which made the button unreadable once guest
// pages started forcing dark mode. See that class's comment for the full
// story.
const loginButtonClass = cn(buttonVariants({ variant: "ghost", size: "sm" }), "report-header-action border no-underline");

// The slim public-facing header for the /TBL/prospects pages -- Step 3 of
// the visual refresh (2026-08-25), the first change guests actually see.
// Deliberately NOT the full SiteNav: no links to Top Players/Top
// Draftees/Minor League System/Glossary, since those pages stay hidden
// from guests and a link to them would just bounce back via middleware.ts
// anyway. Grew a real two-item nav the same day System Rankings split off
// into its own page (was a single logo+login bar before that, when there
// was only one public page to link to). Reuses SiteNav's proven
// .site-header/.site-brand*/.site-nav-links CSS classes for the
// logo/wordmark/nav so every header on the site shares identical
// branding -- the genuinely new part is the login button on the right,
// this project's first real use of a shadcn/ui component (Button, via
// buttonVariants).
//
// Three states on the right, not two, as of the same day's "Preview as
// Guest" toggle: a real guest gets "Login" (shortened from "Owner Login"
// 2026-08-30, Rees's ask -- the destination page still says "Owner Login"
// as its own heading, this is just the nav button label); the owner
// browsing normally gets "Full Site →"; the owner currently previewing
// gets "Exit Guest Preview" instead of either -- they don't need to log in
// again, just to clear the preview cookie, and they shouldn't see "Full
// Site" while the whole point is that they're seeing the restricted view.
// Redesigned 2026-09-18 (Rees: "a bit bland... I don't like the amount of blank space, specifically by having the navbar below the logo"). The shared .site-nav-links rule forces the link row onto its OWN full-width line (that fix was for the owner nav's 7 items); with only 2 public links it just left a wide empty band under the logo. The .site-nav--report modifier puts brand, links and actions on ONE row, shrinks the logo, highlights the active page, and adds the "Data as of" / refresh-status badge (DataStatus) so guests can see how fresh the numbers are.
export function ReportHeader({ league, freshness, isRealOwner, isPreviewingGuest }: { league: string; freshness: DataFreshness; isRealOwner: boolean; isPreviewingGuest: boolean }) {
  const pathname = usePathname() ?? "";
  return (
    <header className="site-header site-header--report">
      <nav className="site-nav site-nav--report" aria-label="Site">
        <Link href={`/${league}/prospects`} className="site-brand">
          <Image src="/logo.png" alt="DSA logo" width={96} height={96} className="site-logo" priority />
          <span className="site-brand-text">
            <span className="site-brand-acronym">DSA</span>
            <span className="site-brand-tagline">Drunk Scouting Association</span>
          </span>
        </Link>
        <div className="site-nav-links">
          {PUBLIC_NAV_ITEMS.map(({ href, label }) => {
            const full = `/${league}${href}`;
            // Top Prospects also owns nothing under /prospects/farms, so an exact-or-child match with the farms page winning is enough.
            const active = href === "/prospects" ? pathname === full : pathname.startsWith(full);
            return (
            <Link key={href} href={full} aria-current={active ? "page" : undefined}>
              {label}
            </Link>
            );
          })}
        </div>
        {/* Right-side action cluster -- just the login/preview link now.
            No dark-mode toggle here (2026-08-30): guest pages are forced
            dark unconditionally (see THEME_INIT_SCRIPT in layout.tsx), so
            there's nothing for a toggle to do on this header. Still a div
            wrapper (not a bare Link) to match SiteNav.tsx's structure and
            leave room if this cluster grows a second item again later. */}
        <div className="site-nav-actions">
          <DataStatus freshness={freshness} />
          {isRealOwner && isPreviewingGuest ? (
            // Plain <a>, not <Link> -- this is a state-changing GET, and
            // <Link> prefetches links in view by default, which would risk
            // silently flipping the toggle before anyone clicked it.
            <a href="/api/preview-guest?action=exit" className={loginButtonClass}>
              Exit Guest Preview
            </a>
          ) : isRealOwner ? (
            <Link href={`/${league}/players`} className={loginButtonClass}>
              Full Site →
            </Link>
          ) : (
            <Link href="/login" className={loginButtonClass}>
              Login
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
