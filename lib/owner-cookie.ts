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
