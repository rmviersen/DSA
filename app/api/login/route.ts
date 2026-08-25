import { NextResponse } from "next/server";
import { OWNER_COOKIE_NAME, expectedOwnerCookieValue } from "../../../lib/owner-cookie";

// See lib/owner-cookie.ts for the full mechanism writeup (2026-08-24).
export async function POST(req: Request) {
  const form = await req.formData();
  const password = form.get("password");

  const expectedPassword = process.env.OWNER_PASSWORD;
  const secret = process.env.OWNER_COOKIE_SECRET;

  if (!expectedPassword || !secret || password !== expectedPassword) {
    return NextResponse.redirect(new URL("/login?error=1", req.url));
  }

  const cookieValue = await expectedOwnerCookieValue(secret);
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(OWNER_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    // 1 year -- "automatically logged in" thereafter, per Rees's spec, until
    // the browser's cookies are cleared or this changes on a new device.
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return res;
}
