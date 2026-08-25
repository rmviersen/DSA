import Image from "next/image";
import Link from "next/link";

const NAV_ITEMS = [
  { href: "/players", label: "Top Players" },
  { href: "/prospects", label: "Top Prospects" },
  { href: "/draft", label: "Top Draftees" },
  { href: "/org-minors", label: "Minor League System" },
  { href: "/glossary", label: "Glossary" },
] as const;

export function SiteNav({ latestGameDate }: { latestGameDate: string | null }) {
  return (
    <header className="site-header">
      <nav className="site-nav" aria-label="Main">
        <Link href="/players" className="site-brand">
          <Image src="/logo.png" alt="DSA logo" width={96} height={96} className="site-logo" priority />
          <span className="site-brand-text">
            <span className="site-brand-acronym">DSA</span>
            <span className="site-brand-tagline">Drunk Scouting Association</span>
          </span>
        </Link>
        <div className="site-nav-links">
          {NAV_ITEMS.map(({ href, label }) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </div>
        {/* Last-refreshed indicator (2026-08-24) -- the league's in-game date
            as of the most recent successful data refresh, not real-world
            capture time. A third flex child here (site-nav uses
            justify-content: space-between) lands at the far right on its
            own, no layout changes needed elsewhere. Omitted entirely if no
            successful refresh has ever recorded a game date, rather than
            showing a misleading placeholder. */}
        {latestGameDate && (
          <span className="site-game-date" title="League's in-game date as of the most recent data refresh">
            Data as of {latestGameDate}
          </span>
        )}
      </nav>
    </header>
  );
}
