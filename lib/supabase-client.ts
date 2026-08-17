import { createClient } from "@supabase/supabase-js";

export function makeSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example)");
  }
  // service_role bypasses Row Level Security — appropriate here since this script
  // is the trusted ingestion path, not a client the public site would ever ship.
  return createClient(url, key, { auth: { persistSession: false } });
}
