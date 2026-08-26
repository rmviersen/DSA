import Image from "next/image";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PUBLIC_NAV_ITEMS = [
  { href: "/TBL/prospects", label: "Top Prospects" },
  { href: "/TBL/prospects/farms", label: "System Rankings" },
] as const;

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
export function ReportHeader({ isOwner }: { isOwner: boolean }) {
  return (
    <header className="site-header">
      <nav className="site-nav" aria-label="Site">
        <Link href="/TBL/prospects" className="site-brand">
          <Image src="/logo.png" alt="DSA logo" width={96} height={96} className="site-logo" priority />
          <span className="site-brand-text">
            <span className="site-brand-acronym">DSA</span>
            <span className="site-brand-tagline">Drunk Scouting Association</span>
          </span>
        </Link>
        <div className="site-nav-links">
          {PUBLIC_NAV_ITEMS.map(({ href, label }) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </div>
        <Link
          href={isOwner ? "/players" : "/login"}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "border border-primary-foreground/25 text-primary-foreground no-underline hover:bg-primary-foreground/10 hover:text-primary-foreground"
          )}
        >
          {isOwner ? "Full Site →" : "Owner Login"}
        </Link>
      </nav>
    </header>
  );
}
