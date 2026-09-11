// Pure, client-safe constant -- deliberately split out of lib/league.ts
// (2026-09-10), which imports makeSupabaseClient at module scope. A "use
// client" component (ConditionalNav.tsx, for routes with no [league] segment
// in the URL -- /login, /, /report) importing DEFAULT_LEAGUE_SLUG straight
// from lib/league.ts would bundle that whole Supabase-client chain into the
// browser and crash it, same bug class as display-helpers.ts's own top
// comment describes (gotcha 16) -- this file exists so that can't happen.
// lib/league.ts re-exports this same constant for every server-side caller,
// so there's still exactly one place this value is ever written.
export const DEFAULT_LEAGUE_SLUG = "TBL";
