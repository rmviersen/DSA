import { NextResponse, type NextRequest } from "next/server";
import { OWNER_COOKIE_NAME, expectedOwnerCookieValue } from "./lib/owner-cookie";

// Pages a GUEST (no valid owner cookie) can reach without being redirected.
// Everything else -- including "/", which app/page.tsx immediately redirects
// to /players -- bounces to /TBL/prospects instead. Expand this array as
// more pages get approved for public release; no other code changes needed
// (2026-08-24, Rees's spec). "/login" itself must stay reachable or nobody
// could ever log in. As of 2026-08-25, /TBL/prospects (not /report, which
// now just redirects here -- see app/report/page.tsx) is the base guest
// page; the prefix match below (`startsWith(p + "/")`) already covers
// /TBL/prospects/farms (System Rankings) with no separate entry needed.
const GUEST_ALLOWED_PATHS = ["/TBL/prospects", "/login"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // /api/login is the login form's own POST target -- has to be reachable
  // pre-auth for the same reason /login itself does.
  if (pathname.startsWith("/api/login")) {
    return NextResponse.next();
  }

  const secret = process.env.OWNER_COOKIE_SECRET;
  const cookieVal = req.cookies.get(OWNER_COOKIE_NAME)?.value;
  if (secret && cookieVal) {
    const expected = await expectedOwnerCookieValue(secret);
    // Plain string comparison, not constant-time -- accepted tradeoff for
    // tonight (2026-08-24). This gate protects page *visibility* timing,
    // not real data (RLS already locks that down independently), so a
    // timing side-channel here is low-stakes; revisit if that ever changes.
    if (cookieVal === expected) {
      return NextResponse.next(); // owner: full access, every route
    }
  }

  // Guest path.
  const isAllowed = GUEST_ALLOWED_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (isAllowed) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/TBL/prospects", req.url));
}

// Excludes Next's own static/image asset routes, the favicon, and -- as of
// 2026-08-25 -- any request for a file with an extension (logo.png, future
// fonts/CSS/robots.txt/etc. under public/). That last piece was missing
// originally and caused a real, previously-invisible bug: a GUEST
// requesting /logo.png directly (e.g. via next/image's optimizer) got
// silently redirected to /report's HTML instead of the actual image, since
// /logo.png isn't a page in GUEST_ALLOWED_PATHS. Never noticed before
// because no guest-visible page rendered the logo until Step 3 of the
// visual refresh added one -- caught via a live 400 from next/image's
// optimizer ("not a valid image") during that work, traced to this
// matcher, not anything wrong with the image itself. `.*\..*` matches any
// path containing a dot -- i.e. "has a file extension" -- which is more
// robust than enumerating extensions one by one.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
