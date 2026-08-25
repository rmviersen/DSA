import { NextResponse, type NextRequest } from "next/server";
import { OWNER_COOKIE_NAME, expectedOwnerCookieValue } from "./lib/owner-cookie";

// Pages a GUEST (no valid owner cookie) can reach without being redirected.
// Everything else -- including "/", which app/page.tsx immediately redirects
// to /players -- bounces to /report instead. Expand this array as more pages
// get approved for public release; no other code changes needed (2026-08-24,
// Rees's spec). "/login" itself must stay reachable or nobody could ever log
// in.
const GUEST_ALLOWED_PATHS = ["/report", "/login"];

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
  return NextResponse.redirect(new URL("/report", req.url));
}

// Excludes Next's own static/image asset routes and the favicon -- these
// aren't "pages," and blocking them would break the app for owner and guest
// alike. Everything else (including API routes other than /api/login,
// handled above) goes through the gate.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
