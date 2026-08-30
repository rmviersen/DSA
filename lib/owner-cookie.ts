// Owner/guest access gate (2026-08-24, Rees's spec -- ship Top Prospects +
// System Rankings publicly tonight, keep everything else hidden from
// anyone without the owner cookie). Deliberately NOT full Supabase Auth:
// there's exactly one privileged user (Rees) and an undifferentiated
// "anyone with the link" guest tier that needs zero login step at all --
// real accounts/sessions would be meaningfully more to build and maintain
// for a capability nobody's asking for yet (telling individual guests
// apart). The real data layer is already fully locked down regardless
// (RLS default-deny, service-role key server-side only) -- this is purely
// gating which PAGES Next.js serves to whom, not a data-security boundary.
//
// Mechanism: a long-lived cookie holds an HMAC-SHA256 signature (keyed by
// OWNER_COOKIE_SECRET, a random value only Vercel's env config knows) over
// a fixed payload. `/api/login` computes and sets it after checking the
// human-facing password (OWNER_PASSWORD, a separate env var -- so the
// actual password is never itself stored in the cookie or committed
// anywhere). `middleware.ts` recomputes the same signature on every
// request and compares. Uses Web Crypto (`crypto.subtle`), not Node's
// `crypto` module, so the same code runs unchanged in both the Edge
// middleware and the Node.js route handler -- Buffer is deliberately
// avoided too (not reliably available in the Edge runtime), hence the
// manual hex-encoding helper below instead of `Buffer.from(...).toString
// ("hex")`.
export const OWNER_COOKIE_NAME = "dsa_owner";
const SIGNED_PAYLOAD = "dsa-owner-v1";

// "Preview as Guest" toggle (2026-08-25) -- lets an already-logged-in owner
// see exactly what a guest sees without logging out. Deliberately a plain,
// unsigned flag cookie, not HMAC-signed like OWNER_COOKIE_NAME: it can only
// ever narrow access, never grant it. It's read only inside the branch
// where OWNER_COOKIE_NAME has already been verified valid (see
// middleware.ts) -- someone forging this cookie on their own browser with
// no valid owner cookie has nothing to gain, since the check that matters
// (the real owner cookie) never passes for them in the first place, and
// this cookie has no effect until it does.
export const PREVIEW_GUEST_COOKIE_NAME = "dsa_preview_guest";

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function expectedOwnerCookieValue(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(SIGNED_PAYLOAD));
  return bufToHex(sig);
}

// Server Component-only convenience wrapper (2026-08-30) -- pulled out of
// layout.tsx (which had this exact function inline) so /prospects and
// /TBL/prospects's page.tsx files can compute the same isRealOwner/
// isPreviewingGuest pair without duplicating the cookie-reading logic a
// third time. Deliberately NOT used by middleware.ts, which reads cookies
// via NextRequest.cookies (an Edge-compatible API) instead of this
// function's next/headers cookies() -- that's a Server Components/Route
// Handlers API, not something the Edge runtime middleware.ts runs in can
// use. This is display-only either way, same as layout.tsx's original
// comment: middleware.ts remains the only thing that actually enforces
// access; a stale/missing cookie here just changes what UI renders.
export async function checkOwnerState(): Promise<{ isRealOwner: boolean; isPreviewingGuest: boolean }> {
  const { cookies } = await import("next/headers");
  const secret = process.env.OWNER_COOKIE_SECRET;
  const cookieStore = cookies();
  const cookieVal = cookieStore.get(OWNER_COOKIE_NAME)?.value;
  const isPreviewingGuest = cookieStore.get(PREVIEW_GUEST_COOKIE_NAME)?.value === "1";
  if (!secret || !cookieVal) return { isRealOwner: false, isPreviewingGuest: false };
  const expected = await expectedOwnerCookieValue(secret);
  return { isRealOwner: cookieVal === expected, isPreviewingGuest };
}
