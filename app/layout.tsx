import { Libre_Franklin } from "next/font/google";
import { ConditionalNav } from "./_components/ConditionalNav";
import { getLatestGameDate } from "../lib/queries";
import "./globals.css";

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
  const latestGameDate = await getLatestGameDate();

  return (
    <html lang="en" className={`${libreFranklin.variable} ${bodyFont.variable}`}>
      <body>
        <ConditionalNav latestGameDate={latestGameDate} />
        <main className="site-main">{children}</main>
      </body>
    </html>
  );
}
