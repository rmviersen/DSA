import { Libre_Franklin } from "next/font/google";
import { cookies } from "next/headers";
import { ConditionalNav } from "./_components/ConditionalNav";
import { getLatestGameDate } from "../lib/queries";
import { OWNER_COOKIE_NAME, expectedOwnerCookieValue } from "../lib/owner-cookie";
import "./globals.css";
import { cn } from "@/lib/utils";

// Same check middleware.ts does to gate access -- this one's for display
// only (which header/login-link state to render), not enforcement, so a
// stale/missing cookie here just means the UI shows "Owner Login" instead
// of "Full Site" -- middleware.ts remains the only thing that actually
// blocks a route.
async function checkIsOwner(): Promise<boolean> {
  const secret = process.env.OWNER_COOKIE_SECRET;
  const cookieVal = cookies().get(OWNER_COOKIE_NAME)?.value;
  if (!secret || !cookieVal) return false;
  const expected = await expectedOwnerCookieValue(secret);
  return cookieVal === expected;
}

const libreFranklin = Libre_Franklin({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
});

const bodyFont = Libre_Franklin({
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
  const [latestGameDate, isOwner] = await Promise.all([getLatestGameDate(), checkIsOwner()]);

  return (
    <html lang="en" className={cn(libreFranklin.variable, bodyFont.variable)}>
      <body>
        <ConditionalNav latestGameDate={latestGameDate} isOwner={isOwner} />
        <main className="site-main">{children}</main>
      </body>
    </html>
  );
}
