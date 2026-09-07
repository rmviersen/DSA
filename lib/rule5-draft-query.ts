import { makeSupabaseClient } from "./supabase-client";
import { fetchComputedPlayers } from "./queries";
import type { PlayerRow } from "./queries";
import { effectiveLevel } from "./display-helpers";
import { fetchAll } from "./org-minors-query";

// Rule 5 Draft board (2026-09-07, Rees's ask). Two lists: OKC's own exposed,
// eligible players worth deciding whether to protect (add to the Secondary/
// 40-man roster before they can be taken), and every OTHER org's exposed,
// eligible players worth targeting to draft. Kept in its own file, same
// reasoning as every other page-specific query module this session.
//
// Eligibility mechanics -- inferred from real data, not documented anywhere
// in this codebase before now, confirmed carefully before building on it:
// - `players.is_on_secondary` is OOTP's own field name for being on the
//   Secondary (40-man) roster -- confirmed via lib/mappers.ts's raw pass-
//   through naming (same name StatsPlus/OOTP itself uses) and cross-checked
//   against real data: every OKC level-1 (MLB) player shows is_on_secondary
//   =true (the active roster is a subset of the 40-man), while level-2/3
//   players NOT on it show false -- exactly the "unprotected minor leaguer"
//   population this page needs to find. A player is PROTECTED if
//   `is_on_secondary` OR `is_active` is true.
// - `players.years_protected_from_rule_5` is a per-player constant (only
//   ever 4 or 5 in this league's real data) -- matches real MLB's actual
//   rule exactly (signed at 18 or younger -> 5 years before eligible; 19+ ->
//   4 years). `players.pro_service_years` (total professional service,
//   distinct from `mlb_service_years`) is what actually accrues against it.
//   A player becomes Rule 5 ELIGIBLE once `pro_service_years >=
//   years_protected_from_rule_5`.
// - Age 23+ (Rees's explicit spec, a real league house rule on top of the
//   above): confirmed this isn't redundant with the service-time math --
//   79 real players leaguewide are otherwise-eligible by service years but
//   under 23 (as young as 21), so this filter genuinely excludes real
//   players who could not actually be selected.
//
// International academy signees (effectiveLevel 8) are excluded defensively
// even though age>=23 alone would almost certainly already rule them out in
// practice (they're 16-19) -- same convention as every other query in this
// codebase that has to distinguish real rostered players from that hidden
// population.
//
// Real bug found and fixed 2026-09-07 (Rees: "The R5 draft board should not
// include players that just signed major league deals, they are just
// waiting to be placed on the active roster"). Confirmed concretely: 34 real
// players currently pass every filter above (unprotected, eligible, 23+)
// purely because `is_on_secondary`/`is_active` haven't caught up yet to a
// real MLB contract they signed this very offseason (`contracts.is_major=
// true`, `season_year` matching the current one -- these are literally the
// same signings visible on /admin/market-rates' "Recent signings" table,
// e.g. Danny Kimball, Aubrey Santomauro, Greg Tarver). A real current MLB
// contract means a player isn't a genuine Rule 5 case regardless of what the
// roster-status flags happen to say yet -- excluded via a real `contracts`
// lookup (`is_major=true`), not a guess at which flag update is lagging.
const MIN_RULE5_AGE = 23;

export interface Rule5DraftResult {
  toProtect: PlayerRow[];
  toDraft: PlayerRow[];
}

export async function getRule5DraftBoard(orgId: number): Promise<Rule5DraftResult> {
  const supabase = makeSupabaseClient();

  const candidates = await fetchAll<{
    id: number; organization_id: number; level: number | null; league_id: number | null;
    is_on_secondary: boolean | null; is_active: boolean | null;
    pro_service_years: number | null; years_protected_from_rule_5: number | null;
  }>((from, to) =>
    supabase.from("players")
      .select("id,organization_id,level,league_id,is_on_secondary,is_active,pro_service_years,years_protected_from_rule_5")
      .not("organization_id", "is", null)
      .eq("retired", false)
      .gte("age", MIN_RULE5_AGE)
      .range(from, to) as never
  );

  // Every player with a CURRENT real MLB contract on file -- `contracts` is
  // current-state (one row per player, not a time-series snapshot), so
  // "has an is_major=true row at all" already means "right now," no extra
  // season_year check needed.
  const majorContractPlayerIds = new Set(
    (await fetchAll<{ player_id: number }>((from, to) =>
      supabase.from("contracts").select("player_id").eq("is_major", true).range(from, to) as never
    )).map((c) => c.player_id)
  );

  const eligible = candidates.filter((p) => {
    const effLvl = effectiveLevel(p.level, p.league_id);
    if (effLvl === null || effLvl < 1 || effLvl > 7) return false; // real MLB-through-Rookie levels only, no international academy
    if (p.is_on_secondary === true || p.is_active === true) return false; // already protected
    if (majorContractPlayerIds.has(p.id)) return false; // real MLB deal on file -- not a genuine Rule 5 case regardless of roster-flag lag
    const protectionYears = p.years_protected_from_rule_5 ?? 0;
    if (protectionYears <= 0) return false; // no real threshold on file -- can't judge eligibility
    return (p.pro_service_years ?? 0) >= protectionYears;
  });

  const toProtectIds = eligible.filter((p) => p.organization_id === orgId).map((p) => p.id);
  const toDraftIds = eligible.filter((p) => p.organization_id !== orgId).map((p) => p.id);

  const [toProtect, toDraft] = await Promise.all([
    fetchComputedPlayers({ playerIds: toProtectIds, limit: toProtectIds.length }),
    fetchComputedPlayers({ playerIds: toDraftIds, limit: toDraftIds.length }),
  ]);

  return { toProtect, toDraft };
}
