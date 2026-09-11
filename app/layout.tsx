import { Fraunces, Inter } from "next/font/google";
import { ConditionalNav } from "./_components/ConditionalNav";
import { getLatestGameDate } from "../lib/queries";
import { checkOwnerState } from "../lib/owner-cookie";
import { getDefaultLeagueId } from "../lib/league";
import "./globals.css";
import { cn } from "@/lib/utils";

// checkOwnerState moved to lib/owner-cookie.ts (2026-08-30) so /prospects
// and /TBL/prospects's page.tsx files can reuse the exact same check
// (needed there now too, to decide whether to show internal player-detail
// links) instead of a third copy of this cookie-reading logic. Still
// display-only, not enforcement -- see that function's own comment.

// Step 4 of the visual refresh (2026-08-25): Fraunces + Inter, the pairing
// from the approved "DSA Visual Refresh" plan -- a characterful serif for
// headings/wordmarks (sports-editorial feel, not a neutral default sans),
// paired with a quiet, highly legible body face for everything data-dense.
// Replaces Libre Franklin, which served both roles before this. Variable
// names (--font-display / --font-body) are unchanged, so no component
// needs to know a font swap happened -- they all already read from these.
const displayFont = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
});

const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500"],
});

export const metadata = {
  title: "DSA — Drunk Scouting Association",
  description: "Player ratings, prospect rankings, and draft boards for TheBigLeague",
};

// Step 7 of the visual refresh (2026-08-25): applies the saved dark-mode
// preference (see ThemeToggle.tsx) to <html> before the page paints.
// Runs as a plain inline <script>, not next/script -- this one specifically
// needs to execute synchronously during initial HTML parsing, before any
// paint, or every dark-mode visitor would see a flash of the light theme
// on load. Wrapped in try/catch since localStorage can throw (private
// browsing, storage blocked) -- worst case it silently falls back to
// light, never a broken page.
//
// Guest pages (/TBL/prospects*) are forced dark unconditionally as of
// 2026-08-30 (Rees's call: this is now the permanent guest-facing look,
// not a per-visitor preference) -- checked by raw location.pathname since
// this plain script runs before React/ConditionalNav ever mounts. The
// admin side is unaffected: it still reads the localStorage toggle exactly
// as before. Checked by prefix, matching ConditionalNav.tsx's own
// startsWith("/TBL/prospects") test for which header renders where.
const THEME_INIT_SCRIPT = `(function(){try{if(location.pathname.indexOf("/TBL/prospects")===0){document.documentElement.classList.add("dark");}else if(localStorage.getItem("dsa-theme")==="dark"){document.documentElement.classList.add("dark");}}catch(e){}})();`;

// Matches every page under app/** -- without this the game-date badge below
// could get cached from an earlier render and go stale across refreshes.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Fetched here (a Server Component) and passed down as a plain string prop
  // -- ConditionalNav is a "use client" component and can't safely import
  // lib/queries.ts itself (see gotcha 16 in HANDOFF.md: a client component
  // importing a *value* from queries.ts crashes in the browser, since that
  // module creates a Supabase client using server-only secrets at import
  // time). A string prop passed down from a Server Component parent has no
  // such restriction.
  //
  // KNOWN GAP, accepted deliberately (2026-09-10, Step 3 of the multi-league
  // migration): this is the ROOT layout, which also wraps routes outside
  // the app/[league]/... segment (/, /login, /report) -- it has no real
  // params.league to read, so this always resolves to TBL's own game date
  // regardless of which league is actually being viewed. Zero user-visible
  // impact today (Duud doesn't exist yet), but once it does, this "Data as
  // of" badge will show TBL's date even on a /Duud/* page. Fixing it
  // properly means moving ConditionalNav's rendering into a new
  // app/[league]/layout.tsx (which does get real params), at the cost of
  // /login and the two redirect-only pages losing the nav entirely --
  // deferred rather than done speculatively for a league that isn't real
  // yet; revisit when Duud actually ships.
  const leagueId = await getDefaultLeagueId();
  const [latestGameDate, ownerState] = await Promise.all([getLatestGameDate(leagueId), checkOwnerState()]);

  return (
    <html lang="en" className={cn(displayFont.variable, bodyFont.variable)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ConditionalNav
          latestGameDate={latestGameDate}
          isRealOwner={ownerState.isRealOwner}
          isPreviewingGuest={ownerState.isPreviewingGuest}
        />
        <main className="site-main">{children}</main>
      </body>
    </html>
  );
}
