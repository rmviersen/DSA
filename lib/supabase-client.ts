import { createClient } from "@supabase/supabase-js";

// Every data page in this app (Top Players, Glossary, and everything else --
// this is the ONLY place a Supabase client gets constructed anywhere in the
// codebase) kept showing stale data until a manual browser refresh, even
// after the site-wide Router Cache fix (next.config.mjs's staleTimes.dynamic:
// 0, 2026-09-02). Root cause, found 2026-09-03: a SEPARATE, server-side
// cache -- Next.js's Data Cache, which memoizes individual fetch() calls,
// not the page render. supabase-js makes its requests with plain fetch() and
// never sets a `cache` option itself, so inside a Next.js server component
// those requests inherit Next's patched global fetch and its caching
// heuristics. `export const dynamic = "force-dynamic"` (already present on
// every page here) forces the ROUTE to render per-request, but does not
// reliably force every underlying fetch to skip the Data Cache too --
// exactly the gap that let stale Supabase responses keep being served.
//
// Fix: force `cache: "no-store"` on every request this client makes,
// explicitly, at the one place they all originate -- removes the ambiguity
// entirely instead of relying on route-level config to propagate correctly,
// and covers every current AND future page automatically.
function noStoreFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, cache: "no-store" });
}

export function makeSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example)");
  }
  // service_role bypasses Row Level Security — appropriate here since this script
  // is the trusted ingestion path, not a client the public site would ever ship.
  return createClient(url, key, { auth: { persistSession: false }, global: { fetch: noStoreFetch } });
}
