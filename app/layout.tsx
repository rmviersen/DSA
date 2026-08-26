import { Fraunces, Inter } from "next/font/google";
import { cookies } from "next/headers";
import { ConditionalNav } from "./_components/ConditionalNav";
import { getLatestGameDate } from "../lib/queries";
import { OWNER_COOKIE_NAME, PREVIEW_GUEST_COOKIE_NAME, expectedOwnerCookieValue } from "../lib/owner-cookie";
import "./globals.css";
import { cn } from "@/lib/utils";

// Same check middleware.ts does to gate access -- this one's for display
// only (which header/nav state to render), not enforcement, so a
// stale/missing cookie here just means the UI shows the guest-facing
// header instead of the full one -- middleware.ts remains the only thing
// that actually blocks a route. Returns isRealOwner separately from
// isPreviewingGuest (2026-08-25's "Preview as Guest" toggle) because the
// two need different UI: a genuine owner currently previewing still needs
// an "Exit Guest Preview" affordance a real guest never sees, even though
// both see the same restricted set of pages.
async function checkOwnerState(): Promise<{ isRealOwner: boolean; isPreviewingGuest: boolean }> {
  const secret = process.env.OWNER_COOKIE_SECRET;
  const cookieStore = cookies();
  const cookieVal = cookieStore.get(OWNER_COOKIE_NAME)?.value;
  const isPreviewingGuest = cookieStore.get(PREVIEW_GUEST_COOKIE_NAME)?.value === "1";
  if (!secret || !cookieVal) return { isRealOwner: false, isPreviewingGuest: false };
  const expected = await expectedOwnerCookieValue(secret);
  return { isRealOwner: cookieVal === expected, isPreviewingGuest };
}

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
  const [latestGameDate, ownerState] = await Promise.all([getLatestGameDate(), checkOwnerState()]);

  return (
    <html lang="en" className={cn(displayFont.variable, bodyFont.variable)}>
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
