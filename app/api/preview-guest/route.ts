import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { OWNER_COOKIE_NAME, PREVIEW_GUEST_COOKIE_NAME, expectedOwnerCookieValue } from "@/lib/owner-cookie";

// "Preview as Guest" toggle (2026-08-25). Plain GET, triggered by ordinary
// <a href> links (not next/link's <Link>, which prefetches -- an
// accidental prefetch of a state-changing GET would silently flip the
// toggle nobody clicked; see SiteNav.tsx/ReportHeader.tsx). Redirects back
// to wherever the click came from (the Referer header) so exiting preview
// lands you back on the same page, now with full access -- and if
// "entering" preview from a page a guest can't see, middleware.ts's own
// gating immediately bounces that follow-up request to /TBL/prospects
// anyway, so there's no need to duplicate that logic here.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action"); // "enter" | "exit"
  const referer = req.headers.get("referer");
  const fallback = new URL(action === "enter" ? "/TBL/prospects" : "/players", req.url);
  let target = fallback;
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.origin === url.origin) target = refererUrl;
    } catch {
      // Malformed Referer -- ignore, fall back.
    }
  }

  const secret = process.env.OWNER_COOKIE_SECRET;
  const ownerCookieVal = cookies().get(OWNER_COOKIE_NAME)?.value;
  const isRealOwner = !!(secret && ownerCookieVal && ownerCookieVal === (await expectedOwnerCookieValue(secret)));

  const res = NextResponse.redirect(target);
  // Not actually the owner -- nothing meaningful to toggle either
  // direction (see the "why unsigned" note on PREVIEW_GUEST_COOKIE_NAME in
  // lib/owner-cookie.ts). Just redirect, don't touch any cookie.
  if (!isRealOwner) return res;

  if (action === "enter") {
    res.cookies.set(PREVIEW_GUEST_COOKIE_NAME, "1", { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  } else {
    res.cookies.set(PREVIEW_GUEST_COOKIE_NAME, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  }
  return res;
}
